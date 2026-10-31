"""Harness behaviour with a scripted fake model and stubbed government feeds (no network)."""

import asyncio
import json
import shutil
import time
from datetime import timedelta

import httpx
import pytest
from fastapi.testclient import TestClient

from app import cache, main
from app.agent.harness import EMERGENCY_LINE, Agent
from app.agent.session import LEDGER_TTL_S, Session
from app.llm.base import Completion, Message, ToolCall
from app.paths import SNAPSHOTS
from app.schemas import TripPlan
from app.tools import agentic, data
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


async def test_scenario_warning_covers_the_coming_days_only():
    provider = ScriptedProvider([
        [ToolCall("c1", "check_closures", {"ids": ["hk_8"]}), ToolCall("c2", "get_weather", {"date": DAY}),
         ToolCall("c3", "get_weather", {"date": LATER})],
        [ToolCall("c4", "refuse", refusal_args("WARNING_T8", ["hk_8"], DAY))],
        "Not this weekend.",
    ])
    agent, session = Agent(provider), Session("s")
    await run(agent, session, {"type": "set_scenario", "scenario": "t8"})
    events = await run(agent, session, {"type": "user_message", "text": "Saturday?"})
    weather = next(e for e in events if e["type"] == "tool_trace" and e.get("call_id") == "c2" and e["status"] == "ok")
    assert weather["summary"] == "WARNING TC8NE"
    assert session.ledger.no_go[DAY] == ["TC8NE"] and LATER not in session.ledger.no_go  # a later date can be the alternative
    refusal = next(e["refusal"] for e in events if e["type"] == "refusal")
    assert refusal["scenario"] == "t8"  # labelled wherever the app shows it


def warnings_now(*codes, **forecast_for):
    """An hko() stub with these warnings in force and a fine forecast for every date in the window."""
    keys = {"TC8NE": "WTCSGNL", "WTS": "WTS", "WRAINR": "WRAIN", "WL": "WL", "WFNTSA": "WFNTSA"}

    async def hko(data_type, **kw):
        if data_type == "warnsum":
            return {keys[c]: {"name": c, "code": c, "actionCode": "ISSUE"} for c in codes}, {}
        if data_type == "flw":
            return {"forecastDesc": forecast_for.get("today", "Mainly fine."), "outlook": forecast_for.get("outlook", "")}, {}
        days = [data.today_hk() + timedelta(days=i) for i in range(1, 10)]
        return {"weatherForecast": [{"forecastDate": d.strftime("%Y%m%d"), "forecastWeather": "Fine"} for d in days]}, {}

    return hko


async def test_live_warnings_do_not_apply_to_later_dates(monkeypatch):
    monkeypatch.setattr(data, "hko", warnings_now("TC8NE"))
    provider = ScriptedProvider([
        [ToolCall("c1", "check_closures", {"ids": ["hk_8"]}), ToolCall("c2", "get_weather", {"date": LATER})],
        [ToolCall("c3", "refuse", refusal_args("WARNING_T8", ["hk_8"], LATER))],
        "ok",
    ])
    events = await run(Agent(provider), Session("s"), {"type": "user_message", "text": "Saturday?"})
    weather = next(e for e in events if e["type"] == "tool_trace" and e["name"] == "get_weather" and e["status"] == "ok")
    assert "WARNING" not in weather["summary"]
    assert "REFUSAL_NOT_SUPPORTED_BY_TOOLS" in results_of(provider, 2)["c3"].content


async def weather_for(date):
    session = Session("s")
    provider = ScriptedProvider([[ToolCall("w", "get_weather", {"date": date})], "ok"])
    await run(Agent(provider), session, {"type": "user_message", "text": "weather?"})
    return json.loads(results_of(provider, 1)["w"].content), session


TOMORROW = (data.today_hk() + timedelta(days=1)).isoformat()
TODAY = data.today_hk().isoformat()


@pytest.mark.parametrize("code, on, no_go", [
    ("WTS", TODAY, ["WTS"]),
    ("WTS", TOMORROW, []),  # a thunderstorm warning is good for hours: the forecast decides tomorrow
    ("WRAINR", TODAY, ["WRAINR"]),
    ("WRAINR", TOMORROW, []),
    ("TC8NE", TOMORROW, ["TC8NE"]),
    ("WL", TODAY, ["WL"]),
    ("WL", TOMORROW, ["WL"]),  # slopes stay saturated
    ("WFNTSA", TODAY, []),  # reported, for the model to act on
])
async def test_each_warning_reaches_as_far_as_it_should(monkeypatch, code, on, no_go):
    monkeypatch.setattr(data, "hko", warnings_now(code))
    content, session = await weather_for(on)
    assert content["no_go_warnings"] == no_go and session.ledger.no_go[on] == no_go
    assert list(content["warnings_in_force"].values())[0]["code"] == code


async def test_todays_outlook_for_later_days_does_not_block_today(monkeypatch):
    monkeypatch.setattr(data, "hko", warnings_now(today="Mainly fine.", outlook="Showers will be heavy at times on Tuesday."))
    _, session = await weather_for(TODAY)
    assert session.ledger.forecast[TODAY] == "Mainly fine."


async def test_a_date_with_no_forecast_is_not_checked(monkeypatch):
    async def stale(data_type, **kw):
        return ({}, {}) if data_type == "warnsum" else ({"weatherForecast": []}, {"stale": True})

    monkeypatch.setattr(data, "hko", stale)
    provider = ScriptedProvider([
        [ToolCall("k1", "check_closures", {"ids": ["hk_8"]}), ToolCall("k2", "get_weather", {"date": DAY}),
         ToolCall("k3", "get_daylight", {"date": DAY})],
        [ToolCall("p1", "present_plan", plan_args())],
        "I can't check the weather right now.",
    ])
    session = Session("s")
    events = await run(Agent(provider), session, {"type": "user_message", "text": "plan"})
    assert DAY not in session.ledger.weather_dates
    assert results_of(provider, 1)["k2"].is_error
    assert not any(e["type"] == "plan" for e in events) and "PRECONDITION_FAILED" in results_of(provider, 2)["p1"].content
    summary = next(e["summary"] for e in events if e["type"] == "tool_trace" and e.get("call_id") == "k2" and e["status"] == "error")
    assert summary == "forecast unavailable"


async def test_clear_scenario_plans_with_no_live_forecast(monkeypatch):
    async def stale(data_type, **kw):
        return ({}, {}) if data_type == "warnsum" else ({"weatherForecast": []}, {"stale": True})

    monkeypatch.setattr(data, "hko", stale)
    session = Session("s")
    session.set_scenario("clear")
    provider = ScriptedProvider([[ToolCall("w", "get_weather", {"date": TOMORROW})], "ok"])
    await run(Agent(provider), session, {"type": "user_message", "text": "weather?"})
    assert TOMORROW in session.ledger.weather_dates and "demo override" in session.ledger.forecast[TOMORROW]


@pytest.mark.parametrize("forecast", [
    "Heavy rain at first.",
    "Rainstorm expected.",
    "Showers will be heavy at times.",
    "Rain will be heavy at times.",
    "Occasional heavy showers and squally thunderstorms.",
    "Heavy showers and a few squally thunderstorms.",
    "Frequent heavy squally showers.",
])
async def test_every_way_of_saying_heavy_rain_blocks_a_plan(monkeypatch, forecast):
    async def wet(data_type, ttl=600, endpoint="weather.php", **params):
        if data_type == "fnd":
            return {"weatherForecast": [{"forecastDate": DAY.replace("-", ""), "forecastWeather": forecast}]}, {}
        if data_type == "SRS":
            return {"fields": ["YYYY-MM-DD", "RISE", "TRAN.", "SET"], "data": [[DAY, "06:13", "12:15", "18:16"]]}, {}
        return {}, {}

    monkeypatch.setattr(data, "hko", wet)
    provider = ScriptedProvider([
        CHECKS,
        [ToolCall("p1", "present_plan", plan_args())],
        [ToolCall("r1", "refuse", refusal_args("RAINSTORM", ["hk_8"]))],
        "Not that day.",
    ])
    events = await run(Agent(provider), Session("s"), {"type": "user_message", "text": "plan"})
    assert "UNSAFE_PLAN" in results_of(provider, 2)["p1"].content
    assert [e["refusal"]["code"] for e in events if e["type"] == "refusal"] == ["RAINSTORM"]  # the code stands up too


@pytest.mark.parametrize("forecast", ["Mainly fine.", "A few showers.", "Cloudy with light rain. Heavy fog offshore."])
def test_ordinary_forecasts_are_not_heavy_rain(forecast):
    assert not agentic.HEAVY_RAIN.search(forecast)


async def test_landslip_warning_means_a_landslip_refusal(monkeypatch):
    monkeypatch.setattr(data, "hko", warnings_now("WL"))
    provider = ScriptedProvider([
        [ToolCall("k1", "check_closures", {"ids": ["hk_8"]}), ToolCall("k2", "get_weather", {"date": TOMORROW})],
        [ToolCall("r1", "refuse", refusal_args("LANDSLIP", ["hk_8"], TOMORROW))],
        "Not tomorrow.",
    ])
    events = await run(Agent(provider), Session("s"), {"type": "user_message", "text": "go?"})
    assert [e["refusal"]["code"] for e in events if e["type"] == "refusal"] == ["LANDSLIP"]


async def test_out_of_scope_cannot_be_used_to_skip_the_gate():
    bad = {**refusal_args("OUT_OF_SCOPE", ["hk_8"], "2026-01-01")}
    provider = ScriptedProvider([[ToolCall("r1", "refuse", bad)], "That date has passed. Which day?"])
    events = await run(Agent(provider), Session("s"), {"type": "user_message", "text": "Dragon's Back last January"})
    assert not any(e["type"] == "refusal" for e in events)
    assert "OUT_OF_SCOPE can't name trails" in results_of(provider, 1)["r1"].content


async def test_real_out_of_scope_needs_no_checks():
    provider = ScriptedProvider([[ToolCall("r1", "refuse", refusal_args("OUT_OF_SCOPE", []))], "Sorry."])
    events = await run(Agent(provider), Session("s"), {"type": "user_message", "text": "best dim sum?"})
    assert [e["refusal"]["code"] for e in events if e["type"] == "refusal"] == ["OUT_OF_SCOPE"]


async def test_past_date_tells_the_model_what_to_do():
    past = (data.today_hk() - timedelta(days=3)).isoformat()
    provider = ScriptedProvider([[ToolCall("w", "get_weather", {"date": past})], "That date has passed."])
    await run(Agent(provider), Session("s"), {"type": "user_message", "text": "hike last week"})
    result = results_of(provider, 1)["w"]
    assert result.is_error and "ask for a new date" in result.content


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
    ({"finish_time": "11:30", "timeline": [{"label": "Hike", "start": "09:30", "end": "11:30"}]}, "shorter than the 2.75 h walking time"),
    ({"finish_time": "13:00"}, "must be the end of the hike step"),
    ({"primary": {"id": "hk_8", "name": "x", "length_km": 8.5, "hours": 2.75, "stars": 1}}, "stars 1 != official 3"),
    ({"primary": {"id": "cty_35", "name": "x", "length_km": 3.5, "hours": 9.0}}, "hours 9.0 != estimated"),
    ({"timeline": [{"label": "Bus 9 to Shek O", "start": "08:30", "end": "09:15"}, {"label": "Hike", "start": "09:30", "end": "12:15"}]}, "names a transport route"),
    ({"why_this": "Take minibus 16 to the start."}, "names a transport route"),
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


async def test_plan_needs_only_its_core_fields_and_the_server_fills_the_rest():
    args = plan_args(why_this="Sea views\\u2014and a ridge.")
    for optional in ("weather_summary", "citations"):
        del args[optional]
    provider = ScriptedProvider([CHECKS, [ToolCall("p1", "present_plan", args)], "Enjoy."])
    events = await run(Agent(provider), Session("s"), {"type": "user_message", "text": "plan"})
    card = next(e["plan"] for e in events if e["type"] == "plan")
    assert card["weather_summary"] == "Fine" and card["provisional"] is False and "scenario" not in card
    assert [c["source"] for c in card["citations"]][1:] == ["HKO forecast", "HKO sunrise/sunset", "AFCD closed trails"]
    assert card["citations"][0]["ref"] == data.trails()["hk_8"]["url"]
    assert card["why_this"] == "Sea views—and a ridge."  # a double-escaped dash doesn't reach the card


def test_a_stopped_plan_needs_no_more_than_the_required_fields():
    # Models have stopped right after why_not: everything from there on has to be optional.
    fields = list(TripPlan.model_fields)
    assert set(TripPlan.model_json_schema()["required"]) == {"date", "primary", "timeline", "finish_time", "sunset", "why_this"}
    assert fields.index("why_this") < fields.index("backup") < fields.index("why_not") < fields.index("citations")


async def test_a_card_sent_twice_in_parallel_shows_once():
    provider = ScriptedProvider([
        CHECKS,
        [ToolCall("p1", "present_plan", plan_args()), ToolCall("p2", "present_plan", plan_args())],
        "Enjoy.",
    ])
    events = await run(Agent(provider), Session("s"), {"type": "user_message", "text": "plan"})
    assert len([e for e in events if e["type"] == "plan"]) == 1
    assert not results_of(provider, 2)["p2"].is_error


async def test_a_rejected_parallel_card_does_not_stop_the_valid_one():
    bad = plan_args(finish_time="13:00")
    provider = ScriptedProvider([CHECKS, [ToolCall("p1", "present_plan", bad), ToolCall("p2", "present_plan", plan_args())], "Enjoy."])
    events = await run(Agent(provider), Session("s"), {"type": "user_message", "text": "plan"})
    assert len([e for e in events if e["type"] == "plan"]) == 1


async def test_plan_beyond_the_forecast_is_provisional():
    far = (data.today_hk() + timedelta(days=20)).isoformat()

    async def srs(data_type, ttl=600, endpoint="weather.php", **params):
        return {"fields": ["YYYY-MM-DD", "RISE", "TRAN.", "SET"], "data": [[far, "06:13", "12:15", "18:16"]]}, {}

    data_hko, data.hko = data.hko, srs
    try:
        provider = ScriptedProvider([
            [ToolCall("k1", "check_closures", {"ids": ["hk_8"]}), ToolCall("k2", "get_weather", {"date": far}),
             ToolCall("k3", "get_daylight", {"date": far})],
            [ToolCall("p1", "present_plan", plan_args(date=far))],
            "Check nearer the date.",
        ])
        events = await run(Agent(provider), Session("s"), {"type": "user_message", "text": "plan"})
    finally:
        data.hko = data_hko
    card = next(e["plan"] for e in events if e["type"] == "plan")
    assert card["provisional"] is True and card["weather_summary"] == "No HKO forecast yet for this date"
    assert "re-checked" in results_of(provider, 2)["p1"].content


async def test_trail_without_official_time_can_be_planned_with_an_estimate():
    t = data.trails()["oth_3"]  # Pak Tam Chung Wheel Chair Trail
    hours, estimated = data.walking_hours(t)
    assert estimated and hours == 0.25
    primary = {"id": "oth_3", "name": t["name"], "length_km": t["length_km"], "hours": hours}
    provider = ScriptedProvider([
        [ToolCall("k1", "check_closures", {"ids": ["oth_3"]}), *CHECKS[1:]],
        [ToolCall("p1", "present_plan", plan_args(primary=primary))],
        "It's a short, step-free loop.",
    ])
    events = await run(Agent(provider), Session("s"), {"type": "user_message", "text": "wheelchair"})
    card = next(e["plan"] for e in events if e["type"] == "plan")
    assert card["primary"]["hours_estimated"] is True and "estimated" in card["citations"][0]["quote"]


async def test_checks_expire_when_a_conversation_is_picked_up_later():
    provider = ScriptedProvider([CHECKS, "Checked.", [ToolCall("p1", "present_plan", plan_args())], "Let me check again."])
    agent, session = Agent(provider), Session("s")
    await run(agent, session, {"type": "user_message", "text": "check"})
    session.last_active -= LEDGER_TTL_S + 1
    events = await run(agent, session, {"type": "user_message", "text": "plan it"})
    assert not any(e["type"] == "plan" for e in events)
    assert "PRECONDITION_FAILED" in results_of(provider, 3)["p1"].content
    assert session.ledger.sunset[DAY] == "18:16"  # sunsets don't change


@pytest.mark.parametrize("text, line", [
    ("My friend fell on Lion Rock and can't move her leg", True),
    ("I think I broke my ankle", True),
    ("Someone is unconscious on the trail!", True),
    ("A half-day hike on Saturday", False),
])
async def test_emergency_line_goes_out_before_the_model_answers(text, line):
    events = await run(Agent(ScriptedProvider(["Call 999."])), Session("s"), {"type": "user_message", "text": text})
    first = events[0]
    assert (first == {"type": "assistant_delta", "text": EMERGENCY_LINE}) is line


async def test_scenario_change_does_not_wait_for_a_running_turn():
    session = Session("s")
    async with session.lock:  # a turn is running
        await asyncio.wait_for(run(Agent(ScriptedProvider([])), session, {"type": "set_scenario", "scenario": "t8"}), 1)
    assert session.scenario == "t8"


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


def test_gpx_nodata_is_not_elevation():
    prof = data.profiles()
    assert prof["oth_30"]["ascent_m"] < 100 and prof["oth_30"]["min_m"] >= -5  # was a 10,025 m climb on a 0.7 km trail
    assert all(-20 <= p["min_m"] and p["max_m"] <= 957 for p in prof.values())


@pytest.mark.parametrize("text, tid", [
    ("Dragon", "hk_8"), ("Sunset Peak", "lt_2"), ("Sharp Peak", "mc_2"), ("Twin Peaks", "ws_1"),
    ("Lion Rock", "mc_5"), ("獅子山", "mc_5"), ("Tai Mo Shan", "mc_8"), ("港島徑", "hk_8"),
])
async def test_trails_can_be_searched_by_landmark_and_in_chinese(text, tid):
    provider = ScriptedProvider([[ToolCall("s", "search_trails", {"text": text, "limit": 25})], "ok"])
    await run(Agent(provider), Session("s"), {"type": "user_message", "text": "find"})
    assert tid in [t["id"] for t in json.loads(results_of(provider, 1)["s"].content)["trails"]]


def test_landmarks_skip_trails_that_only_compare_with_them():
    trails = data.trails()
    assert "Victoria Peak" not in data.landmarks(trails["ws_4"]) and "Victoria Peak" in data.landmarks(trails["hk_1"])
    assert "Sharp Peak" not in data.landmarks(trails["cty_13"])
    assert "High Island Reservoir" not in data.landmarks(trails["cty_31"])


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


def test_a_reconnect_is_told_about_the_turn_and_gets_what_it_missed(monkeypatch):
    class SlowAgent:
        async def handle(self, session, event, emit):
            async with session.lock:
                await asyncio.sleep(0.2)  # the socket goes away here
                await emit({"type": "assistant_delta", "text": "Hello"})
                await emit({"type": "assistant_done"})

    monkeypatch.setattr(main, "agent", SlowAgent())
    with TestClient(main.app) as client:  # one event loop, so the turn outlives the first socket
        with client.websocket_connect("/ws/chat?session=dropped") as ws:
            assert ws.receive_json()["running"] is False
            ws.send_json({"type": "user_message", "text": "hi"})
        time.sleep(0.5)
        with client.websocket_connect("/ws/chat?session=dropped") as ws:
            assert ws.receive_json()["running"] is True
            assert [ws.receive_json()["type"] for _ in range(2)] == ["assistant_delta", "assistant_done"]
        with client.websocket_connect("/ws/chat?session=dropped") as ws:
            assert ws.receive_json()["running"] is False  # delivered once
