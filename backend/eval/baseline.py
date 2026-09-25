"""No-tools baseline: the same cases, answered by the bare model from memory, graded the same way.

The model answers in JSON (decision, trail, figures), so its figures can be checked against the
official data exactly as number_check does for present_plan. Weather facts a user could see
(demo scenario, warnings now, forecast overrides) are stated in the prompt; AFCD closures are not,
since knowing them needs the live feed.

    cd backend && uv run python -m eval.baseline --profile ollama
"""

from __future__ import annotations

import argparse
import asyncio
import difflib
import json
import re
import time
from typing import Any

from dotenv import load_dotenv

from app.llm.base import Completion, Message
from app.llm.registry import build_provider
from app.tools import data

from .grade import grade
from .run import RESULTS, load_cases

SYSTEM = """You are a Hong Kong hiking planning assistant. Today in Hong Kong is {today}.
You have no tools and no live data: answer from your own knowledge.
Reply with one JSON object only, no other text:
{{"decision": "go" | "no_go" | "out_of_scope",
  "trail_name": "official English name of the trail you recommend (go) or refuse (no_go), or null",
  "length_km": number or null, "hours": official walking time in hours or null,
  "stars": official hiking.gov.hk difficulty rating 1-5 or null,
  "date": "YYYY-MM-DD" or null,
  "code": null or one of CLOSED, WARNING_T8, RAINSTORM, THUNDERSTORM, EXTREME_HEAT, EXCEEDS_ABILITY, AFTER_DARK, INSUFFICIENT_TIME, OUT_OF_SCOPE,
  "reply": "your short answer to the user"}}"""

SCENARIO_TEXT = {
    "t8": "The Hong Kong Observatory has Tropical Cyclone Signal No. 8 in force for that day.",
    "rainstorm": "The Hong Kong Observatory has a Red Rainstorm Warning in force for that day.",
    "thunderstorm": "The Hong Kong Observatory has a Thunderstorm Warning in force for that day.",
}
NOW_TEXT = {
    "t8": "Tropical Cyclone Signal No. 8 is in force right now.",
    "rainstorm": "A Red Rainstorm Warning is in force right now.",
    "thunderstorm": "A Thunderstorm Warning is in force right now.",
    "hot": "The Very Hot Weather Warning is in force right now.",
}


def prompt_for(case: dict[str, Any]) -> str:
    text = "\n".join(case["turns"])
    notes = []
    if s := SCENARIO_TEXT.get(case.get("scenario") or ""):
        notes.append(s)
    if s := NOW_TEXT.get(case.get("warnings_now") or ""):
        notes.append(s)
    for off, w in (case.get("weather") or {}).items():
        notes.append(f"HKO forecast for {off} day(s) from today: {w.get('weather', 'Mainly fine.')} Max {w.get('max_c', 29)}°C.")
    if case["expect"].get("ask"):  # it can't ask, so give it what the persona would have answered
        persona = case.get("persona", {})
        notes.append(f"Details: {persona.get('text', '')} Fitness: {(persona.get('prefers') or ['Regular'])[0]}.")
    return text + ("\n(" + " ".join(notes) + ")" if notes else "")


ALIASES = {"dragon's back": "hk_8", "dragon’s back": "hk_8"}  # popular names the hike-search skill also maps


def resolve(name: str | None) -> str | None:
    """Best official trail id for a free-text name, or None."""
    if not name:
        return None
    names = {t["name"].lower(): t["id"] for t in data.trails().values()} | ALIASES
    short = {re.sub(r"\s*\(.*\)", "", k): v for k, v in names.items()}
    key = name.lower().strip()
    for table in (names, short):
        if hit := difflib.get_close_matches(key, table, n=1, cutoff=0.75):
            return table[hit[0]]
    return None


def figures(ans: dict[str, Any], tid: str | None) -> tuple[int, int]:
    """(figures stated, figures that match the official data)."""
    if not tid:
        return 0, 0
    t, stated, right = data.trails()[tid], 0, 0
    for key, official, tol in (("length_km", t["length_km"], 0.05), ("hours", t.get("official_hours"), 0.01), ("stars", t.get("stars"), 0)):
        if isinstance(ans.get(key), (int, float)):
            stated += 1
            right += official is not None and abs(ans[key] - official) <= tol
    return stated, right


def parse(text: str) -> dict[str, Any]:
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S)
    start, end = text.find("{"), text.rfind("}")
    try:
        return json.loads(text[start : end + 1]) if start >= 0 else {}
    except json.JSONDecodeError:
        return {}


async def run_case(provider, case: dict[str, Any]) -> dict[str, Any]:
    system = SYSTEM.format(today=data.today_hk().strftime("%Y-%m-%d (%A)"))
    t0, text = time.perf_counter(), ""
    async for ev in provider.stream(system, [Message("user", text=prompt_for(case))], []):
        if isinstance(ev, Completion):
            text = ev.message.text
    ans = parse(text)
    tid = resolve(ans.get("trail_name"))
    decision = ans.get("decision")
    final = None
    if decision == "go" and tid:
        final = {"type": "plan", "plan": {"primary": {"id": tid}, "date": ans.get("date")}}
    elif decision == "go":
        final = {"type": "plan", "plan": {"primary": {"id": "?"}, "date": ans.get("date")}}
    elif decision in ("no_go", "out_of_scope"):
        final = {"type": "refusal", "refusal": {"code": ans.get("code") or ("OUT_OF_SCOPE" if decision == "out_of_scope" else "?")}}
    g = grade({**case, "expect": {**case["expect"], "ask": False, "tools": []}}, [final] if final else [], text=ans.get("reply") or text)
    stated, right = figures(ans, tid)
    return {"case": case["id"], "category": case["category"], **g, "parsed": bool(ans), "decision": decision,
            "trail_name": ans.get("trail_name"), "trail_id": tid, "figures_stated": stated, "figures_right": right,
            "seconds": round(time.perf_counter() - t0, 1)}


async def main_run(args) -> None:
    load_dotenv()
    RESULTS.mkdir(exist_ok=True)
    for profile in args.profile.split(","):
        provider = build_provider(profile)
        out = RESULTS / f"baseline-{profile}-{time.strftime('%Y%m%d-%H%M')}.jsonl"
        rows = []
        for case in load_cases(select=args.cases):
            r = {"profile": profile, "model": provider.model, **await run_case(provider, case)}
            rows.append(r)
            with out.open("a") as f:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
            print(f"[baseline {profile}] {case['id']:<28} {'PASS' if r['pass'] else 'FAIL'} safe={r['safe']} "
                  f"trail={r['trail_id']} figures {r['figures_right']}/{r['figures_stated']}", flush=True)
        n = len(rows)
        stated = sum(r["figures_stated"] for r in rows)
        print(f"\n{profile} ({provider.model}) without tools: pass {sum(r['pass'] for r in rows)}/{n}, "
              f"safe {sum(r['safe'] for r in rows)}/{n}, figures right {sum(r['figures_right'] for r in rows)}/{stated}, "
              f"named trail not in the official set {sum(bool(r['trail_name']) and not r['trail_id'] for r in rows)}\nWrote {out}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--profile", default="ollama")
    ap.add_argument("--cases")
    asyncio.run(main_run(ap.parse_args()))


if __name__ == "__main__":
    main()
