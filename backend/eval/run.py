"""Run the eval cases through the real harness and summarise.

    cd backend
    uv run python -m eval.run --profile ollama                    # all cases, frozen feeds
    uv run python -m eval.run --profile ollama,ollama-14b --cases go_named_hk8,category:weather
    uv run python -m eval.run --profile ollama --resume eval/results/ollama-20261001-1200.jsonl
    uv run python -m eval.run --summarize eval/results/*.jsonl    # rebuild the markdown table
"""

from __future__ import annotations

import argparse
import asyncio
import json
import statistics
import time
from collections import defaultdict
from datetime import date
from pathlib import Path
from typing import Any

import yaml
from dotenv import load_dotenv

from app.agent.harness import Agent
from app.agent.session import Session
from app.llm.registry import build_provider
from app.tools import data

from . import fixtures
from .driver import Metered, Persona, Transcript, converse
from .grade import grade

HERE = Path(__file__).resolve().parent
RESULTS = HERE / "results"


def load_cases(path: Path = HERE / "cases.yaml", select: str | None = None) -> list[dict[str, Any]]:
    doc = yaml.safe_load(path.read_text())
    cases = [{"persona": doc["defaults"]["persona"], **c} for c in doc["cases"]]
    if not select:
        return cases
    keys = {s.strip() for s in select.split(",")}
    return [c for c in cases if c["id"] in keys or f"category:{c['category']}" in keys]


def compact(o: dict[str, Any]) -> dict[str, Any]:
    """Enough of a plan/refusal card to re-grade it later."""
    if o["type"] == "plan":
        p = o["plan"]
        return {"type": "plan", "plan": {"date": p["date"], "primary": {"id": p["primary"]["id"]},
                                         "backup": {"id": p["backup"]["id"]} if p.get("backup") else None}}
    return {"type": "refusal", "refusal": {"code": o["refusal"]["code"], "trail_ids": o["refusal"]["trail_ids"]}}


def regrade(row: dict[str, Any], cases: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """Re-score a stored result against the current cases.yaml and grader (tooled runs only)."""
    case = cases.get(row["case"])
    if not case or "figures_stated" in row:
        return row
    if "outputs" in row:
        outputs = row["outputs"]
    else:  # older rows kept only the last card
        f = row.get("final")
        outputs = [] if not f else [{"type": "plan", "plan": {"date": f["date"], "primary": {"id": f["primary"]}}}] \
            if f["type"] == "plan" else [{"type": "refusal", "refusal": {"code": f["code"], "trail_ids": f["trails"]}}]
    day = date.fromisoformat(row["day"]) if row.get("day") else None
    return {**row, **grade(case, outputs, row["asks"], row.get("reply", ""), today=day, tools=row.get("tools_ok", row.get("tools")))}


def record(case: dict[str, Any], tr: Transcript, calls: list[dict[str, Any]], seconds: float) -> dict[str, Any]:
    final = tr.final
    g = grade(case, tr.outputs, tr.asks, tr.final_text, tools=[e["name"] for e in tr.traces("ok")])
    blocked = [e["summary"] for e in tr.traces("blocked")]
    return {
        "case": case["id"], "category": case["category"], "day": data.today_hk().isoformat(), **g,
        "final": None if not final else (
            {"type": "plan", "primary": final["plan"]["primary"]["id"], "date": final["plan"]["date"]}
            if final["type"] == "plan" else {"type": "refusal", "code": final["refusal"]["code"], "trails": final["refusal"]["trail_ids"]}),
        "outputs": [compact(o) for o in tr.outputs], "tools_ok": [e["name"] for e in tr.traces("ok")],
        "cards_shown": len(tr.outputs), "asks": tr.asks, "timed_out": tr.timed_out,
        "steps": len(calls), "seconds": round(seconds, 1),
        "input_tokens": sum(c["usage"].get("input_tokens", 0) for c in calls),
        "output_tokens": sum(c["usage"].get("output_tokens", 0) for c in calls),
        "blocks": len(blocked),
        "blocks_precondition": sum(not any(k in b for k in ("figures", "evidence", "unsafe")) for b in blocked),
        "blocks_unsafe": sum("unsafe" in b for b in blocked),
        "blocks_figures": sum("figures" in b for b in blocked),
        "blocks_evidence": sum("evidence" in b for b in blocked),
        "self_corrected": bool(blocked) and final is not None,
        "invalid_args": sum(e["summary"] == "invalid arguments" for e in tr.traces("error")),
        "tool_errors": len(tr.traces("error")),
        "tools": [e["name"] for e in tr.traces()],
        "errors": [e["message"] for e in tr.events if e["type"] == "error"],
        "reply": tr.final_text[:400],
    }


async def run_case(provider, case: dict[str, Any], args, tag: str) -> dict[str, Any]:
    metered = Metered(provider)
    agent = Agent(metered, max_steps=args.max_steps)
    session = Session(f"eval-{tag}-{case['id']}")
    persona = Persona(**case.get("persona", {}))
    t0 = time.perf_counter()
    if args.live:
        tr = await converse(agent, session, case["turns"], persona, case.get("scenario"), args.timeout)
    else:
        with fixtures.installed(case.get("weather"), case.get("warnings_now")):
            tr = await converse(agent, session, case["turns"], persona, case.get("scenario"), args.timeout)
    return record(case, tr, metered.calls, time.perf_counter() - t0)


async def main_run(args) -> list[Path]:
    load_dotenv()
    cases = load_cases(select=args.cases)
    RESULTS.mkdir(exist_ok=True)
    outs = []
    for profile in args.profile.split(","):
        provider = build_provider(profile)
        out = Path(args.resume) if args.resume else RESULTS / f"{profile}-{time.strftime('%Y%m%d-%H%M')}.jsonl"
        done = set()
        if out.exists():
            done = {(r["case"], r["rep"]) for r in map(json.loads, out.read_text().splitlines())}
        for rep in range(args.repeat):
            for case in cases:
                if (case["id"], rep) in done:
                    continue
                r = await run_case(provider, case, args, f"{profile}-{out.stem.rsplit('-', 1)[-1]}-{rep}")
                r = {"profile": profile, "model": provider.model, "rep": rep, **r}
                with out.open("a") as f:
                    f.write(json.dumps(r, ensure_ascii=False) + "\n")
                mark = "PASS" if r["pass"] else "FAIL"
                print(f"[{profile}] {case['id']:<28} {mark} safe={r['safe']} steps={r['steps']} {r['seconds']}s blocks={r['blocks']}"
                      + ("" if r["pass"] else f"  {'; '.join(r['reasons'])}"), flush=True)
        outs.append(out)
    return outs


def summarize(paths: list[Path]) -> str:
    cases = {c["id"]: c for c in load_cases()}
    every = [regrade(json.loads(line), cases) for p in paths for line in p.read_text().splitlines() if line.strip()]
    rows = [r for r in every if "figures_stated" not in r]
    base = [r for r in every if "figures_stated" in r]  # from eval/baseline.py
    by_profile: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        by_profile[f"{r['profile']} ({r['model']})"].append(r)
    categories = sorted({r["category"] for r in rows})

    def pct(xs: list[bool]) -> str:
        return f"{100 * sum(xs) / len(xs):.0f}% ({sum(xs)}/{len(xs)})" if xs else "–"

    lines = ["| Metric | " + " | ".join(by_profile) + " |", "|---|" + "---|" * len(by_profile)]

    def row(name: str, fn) -> None:
        lines.append(f"| {name} | " + " | ".join(fn(rs) for rs in by_profile.values()) + " |")

    row("**Pass (outcome + constraints)**", lambda rs: pct([r["pass"] for r in rs]))
    row("**Safe (no unsafe plan)**", lambda rs: pct([r["safe"] for r in rs]))
    for c in categories:
        row(f"&nbsp;&nbsp;pass: {c}", lambda rs, c=c: pct([r["pass"] for r in rs if r["category"] == c]))
    row("Cases with a gate block", lambda rs: pct([r["blocks"] > 0 for r in rs]))
    row("…of which recovered to a card", lambda rs: pct([r["self_corrected"] for r in rs if r["blocks"] > 0]))
    row("Blocks: missing checks / unsafe plan / wrong figures / no evidence", lambda rs: " / ".join(
        str(sum(r.get(k, 0) for r in rs)) for k in ("blocks_precondition", "blocks_unsafe", "blocks_figures", "blocks_evidence")))
    row("Invalid tool arguments", lambda rs: str(sum(r["invalid_args"] for r in rs)))
    row("Timeouts", lambda rs: str(sum(r["timed_out"] for r in rs)))
    row("Median model calls / case", lambda rs: f"{statistics.median(r['steps'] for r in rs):.0f}")
    row("Median seconds / case", lambda rs: f"{statistics.median(r['seconds'] for r in rs):.0f}")
    row("Median input tokens / case", lambda rs: f"{statistics.median(r['input_tokens'] for r in rs):,.0f}")

    if base:
        by_base: dict[str, list[dict]] = defaultdict(list)
        for r in base:
            by_base[f"{r['profile']} ({r['model']}), no tools"].append(r)
        lines += ["", "**Baseline without tools** (same cases, answered from memory as JSON; weather stated in the prompt)", "",
                  "| Metric | " + " | ".join(by_base) + " |", "|---|" + "---|" * len(by_base)]
        for name, fn in (
            ("Pass (outcome + constraints)", lambda rs: pct([r["pass"] for r in rs])),
            ("Safe (no unsafe plan)", lambda rs: pct([r["safe"] for r in rs])),
            ("Figures matching official data", lambda rs: f"{sum(r['figures_right'] for r in rs)}/{sum(r['figures_stated'] for r in rs)}"),
            ("Named a trail not in the official set", lambda rs: str(sum(bool(r["trail_name"]) and not r["trail_id"] for r in rs))),
        ):
            lines.append(f"| {name} | " + " | ".join(fn(rs) for rs in by_base.values()) + " |")

    fails = [f"- `{r['profile']}` **{r['case']}**: {'; '.join(r['reasons'])}" for r in rows if not r["pass"]]
    return "\n".join(["# Eval summary", "", *lines, "", "## Failures", "", *(fails or ["None."]), ""])


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--profile", default="ollama", help="comma-separated config.yaml profiles")
    ap.add_argument("--cases", help="comma-separated case ids and/or category:<name>")
    ap.add_argument("--repeat", type=int, default=1)
    ap.add_argument("--max-steps", type=int, default=16)
    ap.add_argument("--timeout", type=float, default=900, help="seconds per case")
    ap.add_argument("--live", action="store_true", help="use the real feeds instead of frozen fixtures")
    ap.add_argument("--resume", help="append to this results file, skipping cases already in it (single profile)")
    ap.add_argument("--summarize", nargs="+", type=Path, help="only rebuild the summary from these results files")
    args = ap.parse_args()
    paths = args.summarize or asyncio.run(main_run(args))
    md = summarize(paths)
    out = RESULTS / f"summary-{time.strftime('%Y%m%d-%H%M')}.md"
    RESULTS.mkdir(exist_ok=True)
    out.write_text(md)
    print(md, f"\nWrote {out}", sep="\n")


if __name__ == "__main__":
    main()
