"""Chat with the agent in the terminal: tool chips, question cards and plan/no-go cards as text.

    cd backend && uv run python -m eval.chat --profile ollama [--scenario t8] [--frozen]

Commands: /scenario <name>, /reset, /quit. Question cards are answered by option number
(e.g. "2", or "1,3" for multi-select) or free text.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import json
import sys
from typing import Any

from dotenv import load_dotenv

from app.agent.harness import Agent
from app.agent.session import Session
from app.llm.registry import build_provider

from . import fixtures
from .driver import Metered

DIM, BOLD, RED, GREEN, RESET = "\033[2m", "\033[1m", "\033[31m", "\033[32m", "\033[0m"


async def show(ev: dict[str, Any]) -> None:
    kind = ev["type"]
    if kind == "assistant_delta":
        print(ev["text"], end="", flush=True)
    elif kind == "tool_trace" and ev["status"] != "start":
        colour = RED if ev["status"] in ("blocked", "error") else DIM
        print(f"\n{colour}  [{ev['status']}] {ev['name']} · {ev.get('summary', '')}{RESET}", flush=True)
    elif kind == "tool_trace":
        print(f"\n{DIM}  → {ev['name']}({json.dumps(ev.get('args') or {}, ensure_ascii=False)[:160]}){RESET}", end="", flush=True)
    elif kind == "plan":
        p = ev["plan"]
        print(f"\n{GREEN}{BOLD}PLAN {p['date']}: {p['primary']['name']}{RESET} {p['primary']['length_km']} km, "
              f"{p['primary']['hours']} h, {p['primary'].get('stars')}★; finish {p['finish_time']}, sunset {p['sunset']}")
        for s in p["timeline"]:
            print(f"  {s['start']}-{s['end']}  {s['label']}")
        if p.get("backup"):
            print(f"  backup: {p['backup']['name']}")
    elif kind == "refusal":
        r = ev["refusal"]
        print(f"\n{RED}{BOLD}NO-GO {r['code']}{RESET} {r['summary']}" + (f"\n  instead: {r['counterfactual']}" if r.get("counterfactual") else ""))
    elif kind == "map":
        print(f"\n{DIM}  (map: {ev['payload']['name']} as {ev['payload']['role']}){RESET}")
    elif kind == "error":
        print(f"\n{RED}error: {ev['message']}{RESET}")
    elif kind == "assistant_done":
        print()


def ask(cards: list[dict[str, Any]]) -> list[dict[str, Any]]:
    answers = []
    for card in cards:
        print(f"{BOLD}? {card['prompt']}{RESET}")
        opts = card.get("options") or []
        for i, o in enumerate(opts, 1):
            print(f"  {i}. {o}")
        raw = input("> ").strip()
        picks = [opts[int(x) - 1] for x in raw.replace(" ", "").split(",") if x.isdigit() and 0 < int(x) <= len(opts)]
        if card["type"] == "multi":
            answers.append({"id": card["id"], "value": picks or [raw]})
        else:
            answers.append({"id": card["id"], "value": picks[0] if picks else raw})
    return answers


async def main(args) -> None:
    load_dotenv()
    provider = Metered(build_provider(args.profile))
    agent, session = Agent(provider), Session("cli")
    events: list[dict[str, Any]] = []

    async def emit(ev: dict[str, Any]) -> None:
        events.append(ev)
        await show(ev)

    print(f"{DIM}{provider.model} · scenario {args.scenario or 'live'} · feeds {'frozen' if args.frozen else 'live'}{RESET}")
    if args.scenario:
        await agent.handle(session, {"type": "set_scenario", "scenario": args.scenario}, emit)
    with fixtures.installed() if args.frozen else contextlib.nullcontext():
        while True:
            try:
                text = input(f"\n{BOLD}you>{RESET} ").strip()
            except EOFError:
                return
            if text in ("/quit", "/q"):
                return
            if text == "/reset":
                await agent.handle(session, {"type": "reset"}, emit)
                continue
            if text.startswith("/scenario"):
                name = text.split()[1] if len(text.split()) > 1 else "live"
                await agent.handle(session, {"type": "set_scenario", "scenario": name}, emit)
                continue
            n = len(provider.calls)
            await agent.handle(session, {"type": "user_message", "text": text}, emit)
            while events and events[-1].get("waiting_for"):
                card_ev = next(e for e in reversed(events) if e["type"] == "ask_user")
                await agent.handle(session, {"type": "card_answer", "call_id": card_ev["call_id"], "answers": ask(card_ev["cards"])}, emit)
            calls = provider.calls[n:]
            print(f"{DIM}  {len(calls)} model calls, {sum(c['seconds'] for c in calls):.0f}s, "
                  f"{sum(c['usage'].get('input_tokens', 0) for c in calls):,} input tokens{RESET}", file=sys.stderr)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--profile", default="ollama")
    ap.add_argument("--scenario")
    ap.add_argument("--frozen", action="store_true", help="use the eval's frozen feeds instead of the live ones")
    asyncio.run(main(ap.parse_args()))
