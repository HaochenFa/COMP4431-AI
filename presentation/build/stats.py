"""Per-category eval numbers for the deck: python3 stats.py [out.json] (default: stats.json beside this file).

Reads the eval runs in backend/eval/results/ (gitignored), which is why stats.json is committed.
"""
import glob
import json
import statistics
import sys
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
R = str(HERE.parents[1] / "backend" / "eval" / "results") + "/"
CATS = ["go", "closure", "weather", "ability", "scenery", "multi_turn", "out_of_scope"]


def load(pattern):
    return [json.loads(l) for f in sorted(glob.glob(R + pattern)) for l in open(f) if l.strip()]


def summarize(rows):
    by = defaultdict(list)
    for r in rows:
        by[r["category"]].append(r)
    out = {
        "n": len(rows),
        "pass": sum(r["pass"] for r in rows),
        "safe": sum(r["safe"] for r in rows),
        "by_cat": {c: [sum(r["pass"] for r in by[c]), len(by[c])] for c in CATS},
    }
    if rows and "steps" in rows[0]:
        out |= {
            "median_steps": statistics.median(r["steps"] for r in rows),
            "median_seconds": statistics.median(r["seconds"] for r in rows),
            "median_tokens": statistics.median(r["input_tokens"] for r in rows),
            "blocks_cases": sum(r["blocks"] > 0 for r in rows),
            "self_corrected": sum(bool(r["self_corrected"]) for r in rows),
            "invalid_args": sum(r["invalid_args"] for r in rows),
            "fails": [[r["case"], r["reasons"]] for r in rows if not r["pass"]],
        }
    if rows and "figures_stated" in rows[0]:
        out |= {
            "figures_right": sum(r["figures_right"] for r in rows),
            "figures_stated": sum(r["figures_stated"] for r in rows),
            "invented_trails": sum(bool(r["trail_name"]) and not r["trail_id"] for r in rows),
            "unsafe": [r["case"] for r in rows if not r["safe"]],
        }
    return out


stats = {
    "sonnet": summarize(load("or-sonnet-final-*.jsonl")),
    "deepseek": summarize(load("or-deepseek-final-*.jsonl")),
    "baseline": summarize(load("baseline-or-sonnet-*.jsonl")),
}
json.dump(stats, open(sys.argv[1] if len(sys.argv) > 1 else HERE / "stats.json", "w"), indent=1)
print(json.dumps(stats, indent=1))
