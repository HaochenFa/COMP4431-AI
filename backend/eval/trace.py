"""Print a session trace (backend/traces/<session>.jsonl) as a compact timeline.

    cd backend && uv run python -m eval.trace traces/eval-ollama-0-go_named_hk8.jsonl [...]
"""

from __future__ import annotations

import json
import sys


def show(path: str) -> None:
    print(f"== {path}")
    t0 = None
    for line in open(path):
        r = json.loads(line)
        t0 = t0 or r["t"]
        at = f"{r['t'] - t0:6.1f}s"
        if "in" in r:
            print(f"{at} IN     {json.dumps(r['in'], ensure_ascii=False)[:200]}")
        elif "unusable_turn" in r:
            print(f"{at} MODEL  unusable ({r['unusable_turn']}) retry {r['retry']} {r['usage']} {r['text'][:80]!r}")
        elif "assistant" in r:
            calls = ", ".join(f"{c['name']}({json.dumps(c['arguments'], ensure_ascii=False)[:120]})" for c in r["tool_calls"])
            print(f"{at} MODEL  stop={r['stop']} {r['usage']} {r['assistant'][:200]!r} {calls}")
        elif r["out"]["type"] == "tool_trace" and r["out"]["status"] != "start":
            print(f"{at}   {r['out']['status']:<7} {r['out']['name']}: {r['out'].get('summary', '')}")
        elif r["out"]["type"] in ("error", "plan", "refusal", "ask_user"):
            print(f"{at} OUT    {json.dumps(r['out'], ensure_ascii=False)[:300]}")


if __name__ == "__main__":
    for p in sys.argv[1:]:
        show(p)
