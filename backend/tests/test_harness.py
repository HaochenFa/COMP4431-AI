"""Harness behaviour with a scripted fake model and stubbed government feeds (no network)."""

from datetime import timedelta

import pytest

from app.agent.harness import Agent
from app.agent.session import Session
from app.llm.base import Completion, Message, TextDelta, ToolCall
from app.tools import data

DAY = (data.today_hk() + timedelta(days=2)).isoformat()


class ScriptedProvider:
    """Returns pre-written assistant turns in order; records what it was sent."""

    key = "fake"
    model = "fake-1"

    def __init__(self, turns: list[list[ToolCall] | str]):
        self.turns = list(turns)
        self.seen: list[list[Message]] = []

    async def stream(self, system, messages, tools):
        self.seen.append(list(messages))
        turn = self.turns.pop(0)
        if isinstance(turn, str):
            yield TextDelta(turn)
            yield Completion(Message("assistant", text=turn), stop="end")
        else:
            yield Completion(Message("assistant", tool_calls=turn), stop="tool_use")


@pytest.fixture(autouse=True)
def offline(monkeypatch):
    async def fake_hko(data_type, ttl=600, endpoint="weather.php", **params):
        if data_type == "fnd":
            return {"weatherForecast": [{"forecastDate": DAY.replace("-", ""), "forecastWeather": "Fine", "PSR": "Low"}]}, {}
        if data_type == "SRS":
            return {"fields": ["YYYY-MM-DD", "RISE", "TRAN.", "SET"], "data": [[DAY, "06:13", "12:15", "18:16"]]}, {}
        return {}, {}

    async def fake_closures():
        return [{"trail_id": "cty_2", "Name_of_Hiking_Trail": "Nam Chung Country Trail", "Status": "Temporary closed"}], {}

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
