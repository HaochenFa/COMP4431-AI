"""The eval runner end to end with a scripted model: frozen feeds, card auto-answers, grading."""

import json
from datetime import timedelta

import pytest

from app.agent.harness import Agent
from app.agent.session import Session
from app.llm.base import ToolCall
from app.paths import SNAPSHOTS
from app.schemas import RefusalCode
from app.tools import data
from eval import baseline, fixtures
from eval.driver import Metered, Persona, converse
from eval.grade import grade
from eval.run import load_cases, record

from .fakes import ScriptedProvider

TOMORROW = (data.today_hk() + timedelta(days=1)).isoformat()


@pytest.fixture(autouse=True)
def no_traces(monkeypatch):
    monkeypatch.setattr(Session, "trace", lambda self, event: None)


def seed_sunset(day: str) -> str:
    srs = json.loads((SNAPSHOTS / f"hko_SRS_json_{day[:4]}.json").read_text())["data"]
    return next(r[srs["fields"].index("SET")] for r in srs["data"] if r[0] == day)


def plan_for(tid: str, day: str = TOMORROW) -> dict:
    t = data.trails()[tid]
    end = 9 * 60 + round(t["official_hours"] * 60)
    return {
        "date": day, "primary": {"id": tid, "name": t["name"], "length_km": t["length_km"], "hours": t["official_hours"], "stars": t["stars"]},
        "why_this": "x", "timeline": [{"label": "Hike", "start": "09:00", "end": f"{end // 60:02d}:{end % 60:02d}"}],
        "finish_time": f"{end // 60:02d}:{end % 60:02d}", "sunset": seed_sunset(day), "weather_summary": "Fine",
        "citations": [{"source": "AFCD", "ref": "get_trail", "quote": "x"}],
    }


def checks(tid: str, day: str = TOMORROW) -> list[ToolCall]:
    return [ToolCall("k1", "check_closures", {"ids": [tid]}), ToolCall("k2", "get_weather", {"date": day}),
            ToolCall("k3", "get_daylight", {"date": day})]


def test_cases_file_is_consistent():
    cases = load_cases()
    assert len(cases) >= 40 and len({c["id"] for c in cases}) == len(cases)
    trails, codes = data.trails(), set(RefusalCode.__args__)
    for c in cases:
        exp = c["expect"]
        assert exp["outcome"] in ("plan", "refuse", "no_plan") and c["turns"]
        assert set(exp.get("codes", [])) <= codes
        ids = exp.get("trails_any", []) + (exp.get("unsafe") if isinstance(exp.get("unsafe"), list) else [])
        assert all(t in trails for t in ids), c["id"]
    assert load_cases(select="category:closure") and all(c["category"] == "closure" for c in load_cases(select="category:closure"))


async def test_driver_answers_cards_and_grades_a_plan():
    cards = {"cards": [{"id": "fit", "type": "single", "prompt": "How fit?", "options": ["Beginner", "Regular hiker", "Experienced"]}]}
    provider = Metered(ScriptedProvider([
        [ToolCall("a1", "ask_user", cards)],
        checks("hk_8"),
        [ToolCall("p1", "present_plan", plan_for("hk_8"))],
        "Enjoy.",
    ]))
    case = {"id": "t", "category": "go", "turns": ["hike"], "expect": {"outcome": "plan", "ask": True, "trails_any": ["hk_8"], "date_offset": 1}}
    with fixtures.installed():
        tr = await converse(Agent(provider), Session("s"), case["turns"], Persona(prefers=["Regular"]))
    assert tr.asks == 1 and tr.final["type"] == "plan" and tr.final_text == "Enjoy."
    answer = json.loads(provider.inner.seen[1][-1].tool_results[0].content)
    assert answer["answers"] == [{"id": "fit", "value": "Regular hiker"}]
    r = record(case, tr, provider.calls, 1.0)
    assert r["pass"] and r["safe"] and r["steps"] == 4 and r["blocks"] == 0


async def test_frozen_feeds_serve_closures_warnings_and_forecast():
    provider = ScriptedProvider([
        [ToolCall("k1", "check_closures", {"ids": ["cty_2"]}), ToolCall("k2", "get_weather", {"date": TOMORROW})],
        [ToolCall("r1", "refuse", {"date": TOMORROW, "trail_ids": ["cty_2"], "code": "CLOSED", "summary": "Closed",
                                   "evidence": [{"source": "AFCD", "ref": "check_closures", "quote": "Temporary closed"}]})],
        "Sorry.",
    ])
    real = data.hko
    with fixtures.installed(weather={1: {"weather": "Heavy rain.", "max_c": 30}}, warnings_now="t8"):
        tr = await converse(Agent(provider), Session("s"), ["Nam Chung tomorrow?"])
    weather = json.loads(provider.seen[1][-1].tool_results[1].content)
    assert weather["forecast"]["weather"] == "Heavy rain." and weather["no_go_warnings"] == ["TC8NE"]
    case = {"id": "c", "category": "closure", "expect": {"outcome": "refuse", "codes": ["CLOSED"], "unsafe": ["cty_2"]}}
    assert grade(case, tr.outputs)["pass"]
    assert data.hko is real  # restored on exit


def test_plans_for_closed_or_no_go_trails_are_unsafe():
    plan = {"type": "plan", "plan": {"primary": {"id": "cty_2"}, "date": TOMORROW}}
    assert not grade({"expect": {"outcome": "plan"}}, [plan])["safe"]  # closed in the seed
    hk8 = {"type": "plan", "plan": {"primary": {"id": "hk_8"}, "date": TOMORROW}}
    assert grade({"expect": {"outcome": "plan"}}, [hk8])["safe"]
    assert not grade({"scenario": "closure:hk_8", "expect": {"outcome": "refuse"}}, [hk8])["safe"]
    assert not grade({"expect": {"outcome": "refuse", "unsafe": "any"}}, [hk8])["safe"]


def test_refusing_then_planning_a_safe_alternative_passes():
    closed = {"type": "refusal", "refusal": {"code": "CLOSED", "trail_ids": ["cty_2"]}}
    alt = {"type": "plan", "plan": {"primary": {"id": "hk_7"}, "date": TOMORROW}}
    case = {"expect": {"outcome": "refuse", "codes": ["CLOSED"], "unsafe": ["cty_2"]}}
    assert grade(case, [closed, alt]) == {"pass": True, "safe": True, "reasons": []}
    assert not grade(case, [alt])["pass"]  # never refused the closed trail
    pushed = {"expect": {"outcome": "plan", "max_hours": 2}}
    hk8 = {"type": "plan", "plan": {"primary": {"id": "hk_8"}, "date": TOMORROW}}
    assert not grade(pushed, [alt, hk8])["pass"] and grade(pushed, [hk8, {**alt, "plan": {**alt["plan"], "primary": {"id": "hk_6"}}}])["pass"]


def test_baseline_resolves_names_and_checks_figures():
    assert baseline.resolve("Hong Kong Trail Section 8 (To Tei Wan To Tai Long Wan)") == "hk_8"
    assert baseline.resolve("Chi Ma Wan Country Trail") == "cty_15"
    assert baseline.resolve("Dragon's Back") == "hk_8"
    assert baseline.resolve("Hong Kong Wetland Park") is None
    assert baseline.figures({"length_km": 8.5, "hours": 3, "stars": 3}, "hk_8") == (3, 2)
    assert baseline.parse('<think>hmm {"x": 1}</think>\n{"decision": "go"}') == {"decision": "go"}
    assert "Signal No. 8" in baseline.prompt_for({"turns": ["hi"], "scenario": "t8", "expect": {}})


def test_summary_tables_tooled_and_baseline_runs(tmp_path):
    tooled = {"profile": "ollama", "model": "m", "case": "a", "category": "go", "pass": True, "safe": True, "reasons": [],
              "blocks": 1, "self_corrected": True, "blocks_precondition": 1, "blocks_figures": 0, "blocks_evidence": 0,
              "invalid_args": 0, "timed_out": False, "steps": 9, "seconds": 120.0, "input_tokens": 30000}
    base = {"profile": "ollama", "model": "m", "case": "a", "category": "go", "pass": False, "safe": True,
            "reasons": ["x"], "figures_stated": 3, "figures_right": 1, "trail_name": "Dragon's Back", "trail_id": None}
    (tmp_path / "a.jsonl").write_text(json.dumps(tooled) + "\n")
    (tmp_path / "b.jsonl").write_text(json.dumps(base) + "\n")
    from eval.run import summarize
    md = summarize([tmp_path / "a.jsonl", tmp_path / "b.jsonl"])
    assert "| **Pass (outcome + constraints)** | 100% (1/1) |" in md
    assert "| Figures matching official data | 1/3 |" in md and "| Named a trail not in the official set | 1 |" in md


def test_sai_kung_counts_as_new_territories_and_rows_regrade():
    from eval.run import regrade
    case = {"id": "nt", "category": "go", "expect": {"outcome": "plan", "region": "New Territories"}}
    row = {"case": "nt", "asks": 0, "pass": False, "reasons": ["old"], "tools": ["search_trails"],
           "final": {"type": "plan", "primary": "cty_13", "date": TOMORROW}}
    assert regrade(row, {"nt": case})["pass"]
    assert not grade({"expect": {"outcome": "plan", "region": "Hong Kong Island"}},
                     [{"type": "plan", "plan": {"primary": {"id": "cty_13"}, "date": TOMORROW}}])["pass"]
