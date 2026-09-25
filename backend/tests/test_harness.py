"""Harness behaviour with a scripted fake model and stubbed government feeds (no network)."""

import asyncio
import json
import shutil
from datetime import timedelta

import httpx
import pytest

from app import cache
from app.agent.harness import Agent
from app.agent.session import Session
from app.llm.base import Completion, Message, ToolCall
from app.paths import SNAPSHOTS
from app.tools import data
from app.tools.base import ToolOutput, obj

from .fakes import ScriptedProvider

DAY = (data.today_hk() + timedelta(days=2)).isoformat()
LATER = (data.today_hk() + timedelta(days=4)).isoformat()  # beyond the reach of live warnings
REAL_HKO = data.hko


@pytest.fixture(autouse=True)
def offline(monkeypatch):
    async def fake_hko(data_type, ttl=600, endpoint="weather.php", **params):
        if data_type == "fnd":
            return {"weatherForecast": [{"forecastDate": DAY.replace("-", ""), "forecastWeather": "Fine", "PSR": "Low"}]}, {}
        if data_type == "SRS":  # a yearly table; the tool picks the row for its date
            days = [(data.today_hk() + timedelta(days=i)).isoformat() for i in range(12)]
            return {"fields": ["YYYY-MM-DD", "RISE", "TRAN.", "SET"], "data": [[d, "06:13", "12:15", "18:16"] for d in days]}, {}
        return {}, {}

    async def fake_closures():
        return [
            {"trail_id": "cty_2", "Name_of_Hiking_Trail": "Nam Chung Country Trail", "Status": "Temporary closed"},
            {"trail_id": "lt_7", "Name_of_Hiking_Trail": "Lantau Trail Section 7 (partial)", "Status": "Temporary diversion"},
            {"trail_id": "lt_7", "Name_of_Hiking_Trail": "Lantau Trail Section 7 (partial)", "Status": "Temporary closed"},
            {"trail_id": "hk_1", "Name_of_Hiking_Trail": "Hong Kong Trail Section 1", "Status": "Temporary diversion"},
        ], {}

    monkeypatch.setattr(data, "hko", fake_hko)
    monkeypatch.setattr(data, "closures", fake_closures)
    monkeypatch.setattr(Session, "trace", lambda self, event: None)


def plan_args(**over):
    t = data.trails()["hk_8"]
    plan = {
        "date": DAY,
        "primary": {"id": "hk_8", "name": t["name"], "length_km": t["length_km"], "hours": t["official_hours"], "stars": t["stars"]},
        "why_this": "Sea views, within a half day.",
        "timeline": [{"label": "Hike", "start": "09:30", "end": "12:15"}],
        "finish_time": "12:15",
        "sunset": "18:16",
        "weather_summary": "Fine",
        "citations": [{"source": "AFCD", "ref": "get_trail", "quote": "2.75 hours"}],
    }
    plan.update(over)
    return plan


async def run(agent, session, event):
    events = []

    async def emit(e):
        events.append(e)

    await agent.handle(session, event, emit)
    return events


async def test_gate_blocks_plan_until_checks_are_done():
    provider = ScriptedProvider([
        [ToolCall("c1", "present_plan", plan_args())],
        [ToolCall("c2", "check_closures", {"ids": ["hk_8"]}), ToolCall("c3", "get_weather", {"date": DAY}),
         ToolCall("c4", "get_daylight", {"date": DAY})],
        [ToolCall("c5", "present_plan", plan_args())],
        "Enjoy Dragon's Back!",
    ])
    events = await run(Agent(provider), Session("s"), {"type": "user_message", "text": "half day hike"})
    traces = [(e["name"], e["status"]) for e in events if e["type"] == "tool_trace" and e["status"] != "start"]
    assert traces[0] == ("present_plan", "blocked")
    assert ("present_plan", "ok") in traces
    assert [e["type"] for e in events if e["type"] in ("plan", "refusal")] == ["plan"]
    blocked_result = provider.seen[1][-1].tool_results[0]
    assert blocked_result.is_error and "PRECONDITION_FAILED" in blocked_result.content


async def test_plan_with_wrong_figures_is_blocked():
    provider = ScriptedProvider([
        [ToolCall("c1", "check_closures", {"ids": ["hk_8"]}), ToolCall("c2", "get_weather", {"date": DAY}),
         ToolCall("c3", "get_daylight", {"date": DAY})],
        [ToolCall("c4", "present_plan", plan_args(sunset="19:00"))],
        "Sorry.",
    ])
    events = await run(Agent(provider), Session("s"), {"type": "user_message", "text": "go"})
    assert not any(e["type"] == "plan" for e in events)
    assert "NUMBERS_DO_NOT_MATCH_TOOLS" in provider.seen[2][-1].tool_results[0].content


async def test_ask_user_pauses_and_resumes_with_answer():
    cards = {"cards": [{"id": "fitness", "type": "single", "prompt": "How fit?", "options": ["Beginner", "Regular"]}]}
    provider = ScriptedProvider([
        [ToolCall("a1", "ask_user", cards), ToolCall("a2", "get_daylight", {"date": DAY})],
        "Great, searching now.",
    ])
    agent, session = Agent(provider), Session("s")
    first = await run(agent, session, {"type": "user_message", "text": "hike saturday"})
    assert any(e["type"] == "ask_user" and e["call_id"] == "a1" for e in first)
    assert first[-1] == {"type": "assistant_done", "waiting_for": "a1"}
    assert session.pending and len(provider.seen) == 1

    second = await run(agent, session, {"type": "card_answer", "call_id": "a1", "answers": [{"id": "fitness", "value": "Beginner"}]})
    assert session.pending is None and second[-1]["type"] == "assistant_done"
    results = {r.call_id: r for r in provider.seen[1][-1].tool_results}
    assert set(results) == {"a1", "a2"} and "Beginner" in results["a1"].content


async def test_closed_trail_and_scenario_override():
    provider = ScriptedProvider([
        [ToolCall("c1", "check_closures", {"ids": ["cty_2", "hk_8"]}), ToolCall("c2", "get_weather", {"date": DAY})],
        [ToolCall("c3", "refuse", {"date": DAY, "trail_ids": ["cty_2"], "code": "CLOSED", "summary": "Closed by AFCD",
                                    "evidence": [{"source": "AFCD", "ref": "check_closures", "quote": "Temporary closed"}]})],
        "It's closed.",
    ])
    session = Session("s")
    events = await run(Agent(provider), session, {"type": "user_message", "text": "Nam Chung?"})
    assert any(e["type"] == "refusal" for e in events)
    closure = next(e for e in events if e["type"] == "tool_trace" and e["name"] == "check_closures" and e["status"] == "ok")
    assert "cty_2" in closure["summary"] and "hk_8" not in closure["summary"]


async def test_invalid_arguments_are_returned_to_model():
    provider = ScriptedProvider([[ToolCall("c1", "get_weather", {"when": "saturday"})], "Let me fix that."])
    await run(Agent(provider), Session("s"), {"type": "user_message", "text": "weather"})
    assert "INVALID_ARGUMENTS" in provider.seen[1][-1].tool_results[0].content


async def test_invalid_arguments_list_every_problem_with_its_path():
    bad = {"cards": [{"id": "date", "title": "Date", "options": ["Today", "Tomorrow"]}]}
    provider = ScriptedProvider([[ToolCall("a1", "ask_user", bad)], "ok"])
    await run(Agent(provider), Session("s"), {"type": "user_message", "text": "hike"})
    msg = results_of(provider, 1)["a1"].content
    assert "cards[0]: 'type' is a required property" in msg and "cards[0]: 'prompt' is a required property" in msg


CHECKS = [ToolCall("k1", "check_closures", {"ids": ["hk_8"]}), ToolCall("k2", "get_weather", {"date": DAY}),
          ToolCall("k3", "get_daylight", {"date": DAY})]


def refusal_args(code, trail_ids, date=DAY):
    return {"date": date, "trail_ids": trail_ids, "code": code, "summary": "No.",
            "evidence": [{"source": "tool", "ref": "check_closures", "quote": "x"}]}


def results_of(provider, turn):
    return {r.call_id: r for r in provider.seen[turn][-1].tool_results}


async def test_disconnect_mid_tool_leaves_every_call_answered():
    started = asyncio.Event()
    provider = ScriptedProvider([[ToolCall("c1", "get_daylight", {"date": DAY}), ToolCall("c2", "slow", {})], "Back again."])
    agent, session = Agent(provider), Session("s")

    @agent.toolbox.register("slow", "never finishes", obj({}))
    async def slow(args, ctx):
        started.set()
        await asyncio.Event().wait()
        return ToolOutput("unreachable")

    task = asyncio.create_task(run(agent, session, {"type": "user_message", "text": "hike"}))
    await started.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    last = session.messages[-1]
    assert last.role == "tool" and [r.call_id for r in last.tool_results] == ["c1", "c2"]
    assert not last.tool_results[0].is_error and last.tool_results[1].is_error

    await run(agent, session, {"type": "user_message", "text": "still there?"})
    assert [m.role for m in provider.seen[1]] == ["user", "assistant", "tool", "user"]


async def test_empty_assistant_turn_is_not_kept():
    class Refuses(ScriptedProvider):
        async def stream(self, system, messages, tools):
            self.seen.append(list(messages))
            yield Completion(Message("assistant"), stop="refusal")

    session = Session("s")
    events = await run(Agent(Refuses([])), session, {"type": "user_message", "text": "hi"})
    assert [m.role for m in session.messages] == ["user"]
    assert [e["type"] for e in events][-2:] == ["error", "assistant_done"]


async def test_stale_card_answer_still_ends_the_turn():
    events = await run(Agent(ScriptedProvider([])), Session("s"), {"type": "card_answer", "call_id": "gone", "answers": []})
    assert [e["type"] for e in events] == ["error", "assistant_done"]


async def test_pending_question_keeps_its_cards():
    cards = {"cards": [{"id": "fitness", "type": "single", "prompt": "How fit?", "options": ["Beginner", "Regular"]}]}
    session = Session("s")
    await run(Agent(ScriptedProvider([[ToolCall("a1", "ask_user", cards)]])), session, {"type": "user_message", "text": "hike"})
    assert session.pending.cards == cards["cards"]


async def test_scenario_warning_applies_to_the_requested_date():
    provider = ScriptedProvider([
        [ToolCall("c1", "check_closures", {"ids": ["hk_8"]}), ToolCall("c2", "get_weather", {"date": LATER})],
        [ToolCall("c3", "refuse", refusal_args("WARNING_T8", ["hk_8"], LATER))],
        "Not this weekend.",
    ])
    agent, session = Agent(provider), Session("s")
    await run(agent, session, {"type": "set_scenario", "scenario": "t8"})
    events = await run(agent, session, {"type": "user_message", "text": "Saturday?"})
    weather = next(e for e in events if e["type"] == "tool_trace" and e["name"] == "get_weather" and e["status"] == "ok")
    assert weather["summary"] == "WARNING TC8NE"
    assert any(e["type"] == "refusal" for e in events)


async def test_live_warnings_do_not_apply_to_later_dates(monkeypatch):
    async def hko_with_t8(data_type, **kw):
        if data_type == "warnsum":
            return {"WTCSGNL": {"name": "Tropical Cyclone Warning Signal", "code": "TC8NE", "actionCode": "ISSUE"}}, {}
        return {"weatherForecast": []}, {}

    monkeypatch.setattr(data, "hko", hko_with_t8)
    provider = ScriptedProvider([
        [ToolCall("c1", "check_closures", {"ids": ["hk_8"]}), ToolCall("c2", "get_weather", {"date": LATER})],
        [ToolCall("c3", "refuse", refusal_args("WARNING_T8", ["hk_8"], LATER))],
        "ok",
    ])
    events = await run(Agent(provider), Session("s"), {"type": "user_message", "text": "Saturday?"})
    weather = next(e for e in events if e["type"] == "tool_trace" and e["name"] == "get_weather" and e["status"] == "ok")
    assert "WARNING" not in weather["summary"]
    assert "REFUSAL_NOT_SUPPORTED_BY_TOOLS" in results_of(provider, 2)["c3"].content


async def test_switching_scenario_invalidates_earlier_checks():
    provider = ScriptedProvider([CHECKS, "Checked.", [ToolCall("c1", "present_plan", plan_args())], "Blocked."])
    agent, session = Agent(provider), Session("s")
    await run(agent, session, {"type": "user_message", "text": "check"})
    await run(agent, session, {"type": "set_scenario", "scenario": "closure:hk_8"})
    events = await run(agent, session, {"type": "user_message", "text": "plan it"})
    assert not any(e["type"] == "plan" for e in events)
    assert "PRECONDITION_FAILED" in results_of(provider, 3)["c1"].content


async def test_closures_distinguish_diversions_from_closures():
    provider = ScriptedProvider([[ToolCall("c1", "check_closures", {"ids": ["lt_7", "hk_1", "hk_8"]})], "ok"])
    session = Session("s")
    await run(Agent(provider), session, {"type": "user_message", "text": "closures?"})
    trails = json.loads(results_of(provider, 1)["c1"].content)["trails"]
    assert trails["lt_7"]["closed"] and trails["lt_7"]["status"] == "Temporary closed" and trails["lt_7"]["partial"]
    assert not trails["hk_1"]["closed"] and trails["hk_1"]["diversion"]["status"] == "Temporary diversion"
    assert trails["hk_8"] == {"closed": False}
    assert session.ledger.closed == {"lt_7"}


@pytest.mark.parametrize("args, problem", [
    (refusal_args("CLOSED", ["hk_8"]), "did not report ['hk_8'] as closed"),
    (refusal_args("CLOSED", []), "list them in trail_ids"),
    (refusal_args("RAINSTORM", ["hk_8"]), "no rainstorm warning"),
])
async def test_refusal_codes_need_evidence(args, problem):
    provider = ScriptedProvider([CHECKS, [ToolCall("r1", "refuse", args)], "ok"])
    events = await run(Agent(provider), Session("s"), {"type": "user_message", "text": "go?"})
    assert not any(e["type"] == "refusal" for e in events)
    assert problem in results_of(provider, 2)["r1"].content


@pytest.mark.parametrize("over, problem", [
    ({"finish_time": "17:50", "timeline": [{"label": "Hike", "start": "15:05", "end": "17:50"}]}, "less than 30 min before sunset"),
    ({"finish_time": "11:30", "timeline": [{"label": "Hike", "start": "09:30", "end": "11:30"}]}, "shorter than the official 2.75 h"),
    ({"finish_time": "13:00"}, "must be the end of the hike step"),
    ({"primary": {"id": "hk_8", "name": "x", "length_km": 8.5, "hours": 2.75, "stars": 1}}, "stars 1 != official 3"),
    ({"primary": {"id": "cty_35", "name": "x", "length_km": 1.0, "hours": 1.0}}, "no official walking time"),
])
async def test_plan_figures_and_timing_are_checked(over, problem):
    ids = [over["primary"]["id"]] if "primary" in over else ["hk_8"]
    provider = ScriptedProvider([
        [ToolCall("k1", "check_closures", {"ids": ids}), *CHECKS[1:]],
        [ToolCall("p1", "present_plan", plan_args(**over))],
        "ok",
    ])
    events = await run(Agent(provider), Session("s"), {"type": "user_message", "text": "plan"})
    assert not any(e["type"] == "plan" for e in events)
    assert problem in results_of(provider, 2)["p1"].content


async def test_plan_card_carries_official_name_and_start():
    provider = ScriptedProvider([CHECKS, [ToolCall("p1", "present_plan", plan_args())], "Enjoy."])
    events = await run(Agent(provider), Session("s"), {"type": "user_message", "text": "plan"})
    card = next(e["plan"] for e in events if e["type"] == "plan")
    t = data.trails()["hk_8"]
    assert card["primary"]["name"] == t["name"] and card["primary"]["start"] == t["start"]
    assert card["primary"]["start_coord"] == data.geometries()["hk_8"][0][0]
    assert card["primary"]["profile"]["ascent_m"] == data.profiles()["hk_8"]["ascent_m"]


async def test_map_keeps_multipart_tracks_as_separate_segments():
    segments = data.geometries()["oth_20"]  # no official GPX; its AFCD geometry has gaps of several km
    assert len(segments) > 1
    provider = ScriptedProvider([[ToolCall("m1", "maps_draw_gpx", {"id": "oth_20"})], "Drawn."])
    events = await run(Agent(provider), Session("s"), {"type": "user_message", "text": "map"})
    payload = next(e["payload"] for e in events if e["type"] == "map")
    assert len(payload["segments"]) == len(segments)
    assert [s[0] for s in payload["segments"]] == [s[0] for s in segments]
    assert [s[-1] for s in payload["segments"]] == [s[-1] for s in segments]
    assert len(data.geometries()["hk_8"]) == 1  # official GPX: one ordered track


async def test_daylight_works_offline_from_the_committed_yearly_snapshot(monkeypatch, tmp_path):
    shutil.copy(SNAPSHOTS / "hko_SRS_json_2026.json", tmp_path)  # only the committed seed, no live copy
    monkeypatch.setattr(cache, "SNAPSHOTS", tmp_path)
    monkeypatch.setattr(cache, "_memory", {})
    monkeypatch.setattr(data, "hko", REAL_HKO)

    async def offline_get(*a, **kw):
        raise httpx.ConnectError("offline")

    monkeypatch.setattr(httpx.AsyncClient, "get", offline_get)
    provider = ScriptedProvider([[ToolCall("d1", "get_daylight", {"date": "2026-11-18"})], "ok"])
    await run(Agent(provider), Session("s"), {"type": "user_message", "text": "sunset?"})
    result = results_of(provider, 1)["d1"]
    assert not result.is_error and '"sunset": "17:39"' in result.content and '"stale": true' in result.content


def test_elevation_profiles_come_from_the_official_gpx():
    prof = data.profiles()
    hk8 = prof["hk_8"]
    assert hk8["d_km"][0] == 0 and all(b >= a for a, b in zip(hk8["d_km"], hk8["d_km"][1:]))
    assert len(hk8["d_km"]) == len(hk8["ele_m"]) <= 130
    assert 250 < hk8["ascent_m"] < 400 and hk8["max_m"] == 284  # Dragon's Back ridge, hysteresis-smoothed
    assert "cty_1" not in prof and "oth_20" not in prof  # GPX without heights; no GPX at all


async def test_trail_tools_carry_elevation():
    provider = ScriptedProvider([
        [ToolCall("s1", "search_trails", {"region": "Hong Kong Island", "max_ascent_m": 300, "limit": 25}),
         ToolCall("g1", "get_trail", {"id": "hk_8"}), ToolCall("m1", "maps_draw_gpx", {"id": "hk_8"})],
        "ok",
    ])
    events = await run(Agent(provider), Session("s"), {"type": "user_message", "text": "flat walk"})
    res = results_of(provider, 1)
    found = {t["id"]: t for t in json.loads(res["s1"].content)["trails"]}
    assert "hk_8" not in found and all(t["ascent_m"] is None or t["ascent_m"] <= 300 for t in found.values())
    assert "cty_1" in found and found["cty_1"]["ascent_m"] is None  # unknown heights are kept, not dropped
    assert json.loads(res["g1"].content)["elevation"]["ascent_m"] == data.profiles()["hk_8"]["ascent_m"]
    payload = next(e["payload"] for e in events if e["type"] == "map")
    assert payload["profile"]["ele_m"] == data.profiles()["hk_8"]["ele_m"]


async def test_unusable_turns_are_retried_with_a_note():
    class Recording(ScriptedProvider):
        async def stream(self, system, messages, tools):
            self.systems = getattr(self, "systems", []) + [system]
            async for ev in super().stream(system, messages, tools):
                yield ev

    provider = Recording(["", "present_plan\n2026-09-26: Dragon's Back", "Here you go."])
    session = Session("s")
    events = await run(Agent(provider), session, {"type": "user_message", "text": "hi"})
    assert len(provider.seen) == 3 and all(len(m) == 1 for m in provider.seen)  # nothing appended between tries
    assert "Harness note" not in provider.systems[0] and "was empty" in provider.systems[1]
    assert "typed `present_plan` as text" in provider.systems[2]
    assert [e["type"] for e in events if e["type"] != "assistant_delta"] == ["assistant_reset", "assistant_done"]
    assert [m.text for m in session.messages if m.role == "assistant"] == ["Here you go."]


async def test_unknown_trail_ids_are_not_reported_open():
    provider = ScriptedProvider([[ToolCall("c1", "check_closures", {"ids": ["NAMCHUNG"]})], "ok"])
    session = Session("s")
    await run(Agent(provider), session, {"type": "user_message", "text": "Nam Chung?"})
    result = results_of(provider, 1)["c1"]
    assert result.is_error and "Unknown trail ids" in result.content and not session.ledger.closures_checked


def _unit(i: int, n: int = 4) -> list[float]:
    return [1.0 if j == i else 0.0 for j in range(n)]


async def test_search_knowledge_ranks_only_the_filtered_trails(monkeypatch):
    chunks = [{"trail_id": "hk_8", "text": "龍脊海景", "vec": _unit(0)}, {"trail_id": "cty_7", "text": "大灘海岸", "vec": [0.9, 0.1, 0, 0]},
              {"trail_id": "oth_24", "text": "戰時遺跡", "vec": _unit(1)}]
    monkeypatch.setattr(data, "knowledge", lambda: chunks)

    async def embed(text):
        return _unit(0) if "sea" in text else _unit(1)

    monkeypatch.setattr(data, "embed_query", embed)
    provider = ScriptedProvider([[
        ToolCall("k1", "search_knowledge", {"query": "sea views"}),
        ToolCall("k2", "search_knowledge", {"query": "sea views", "trail_ids": ["cty_7", "oth_24"], "k": 1}),
        ToolCall("k3", "search_knowledge", {"query": "x", "trail_ids": ["nope"]}),
    ], "ok"])
    await run(Agent(provider), Session("s"), {"type": "user_message", "text": "sea"})
    res = results_of(provider, 1)
    assert [p["trail_id"] for p in json.loads(res["k1"].content)["passages"]] == ["hk_8", "cty_7", "oth_24"]
    only = json.loads(res["k2"].content)["passages"]
    assert [p["trail_id"] for p in only] == ["cty_7"] and only[0]["url"] == data.trails()["cty_7"]["url"]
    assert res["k3"].is_error and "Unknown trail ids" in res["k3"].content


async def test_search_knowledge_degrades_when_the_embedder_is_down(monkeypatch):
    async def down(text):
        raise ConnectionError("refused")

    monkeypatch.setattr(data, "embed_query", down)
    provider = ScriptedProvider([[ToolCall("k1", "search_knowledge", {"query": "waterfall"})], "ok"])
    await run(Agent(provider), Session("s"), {"type": "user_message", "text": "waterfall"})
    result = results_of(provider, 1)["k1"]
    assert result.is_error and "get_trail" in result.content


def test_knowledge_index_covers_the_described_trails():
    chunks = data.knowledge()
    described = {t["id"] for t in data.trails().values() if t.get("description_zh")}
    assert {c["trail_id"] for c in chunks} == described
    assert all(len(c["vec"]) == len(chunks[0]["vec"]) for c in chunks) and "為方便市民" not in "".join(c["text"] for c in chunks)


@pytest.mark.parametrize("scenario, over, problem", [
    ("t8", {}, "no-go warning TC8NE"),
    ("closure:hk_8", {}, "choose another trail, or refuse with code CLOSED"),
    ("live", {"backup": {"id": "cty_2", "name": "x", "length_km": 5.5, "hours": 2.5, "stars": 3}}, "['cty_2'] closed"),
])
async def test_plans_on_no_go_days_or_closed_trails_are_blocked(scenario, over, problem):
    ids = ["hk_8"] + ([over["backup"]["id"]] if "backup" in over else [])
    provider = ScriptedProvider([
        [ToolCall("k1", "check_closures", {"ids": ids}), *CHECKS[1:]],
        [ToolCall("p1", "present_plan", plan_args(**over))],
        "ok",
    ])
    agent, session = Agent(provider), Session("s")
    await run(agent, session, {"type": "set_scenario", "scenario": scenario})
    events = await run(agent, session, {"type": "user_message", "text": "plan"})
    assert not any(e["type"] == "plan" for e in events)
    result = results_of(provider, 2)["p1"].content
    assert "UNSAFE_PLAN" in result and problem in result
