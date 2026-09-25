"""Drive the real harness headlessly: user turns in, question cards auto-answered from a persona,
events and per-call metrics out. Used by eval/run.py and scripts/chat.py."""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Any, AsyncIterator

from app.agent.harness import Agent
from app.agent.session import Emit, Session
from app.llm.base import Completion, Message, Provider, ProviderEvent, ToolSpec

MAX_ASKS = 4  # a model that keeps asking is stopped here and graded on what it has done


class Metered:
    """Provider wrapper that records latency, usage and stop reason for every model call."""

    def __init__(self, inner: Provider):
        self.inner, self.key, self.model = inner, inner.key, inner.model
        self.calls: list[dict[str, Any]] = []

    async def stream(self, system: str, messages: list[Message], tools: list[ToolSpec]) -> AsyncIterator[ProviderEvent]:
        t0, first = time.perf_counter(), None
        async for ev in self.inner.stream(system, messages, tools):
            first = first if first is not None else time.perf_counter() - t0
            if isinstance(ev, Completion):
                self.calls.append({"seconds": round(time.perf_counter() - t0, 2), "first_event": round(first, 2),
                                   "stop": ev.stop, "usage": ev.usage, "tool_calls": [c.name for c in ev.message.tool_calls]})
            yield ev


@dataclass
class Persona:
    """How the simulated user answers question cards: the first option mentioning any of `prefers`,
    else the first option; `text` for free-text cards."""

    prefers: list[str] = field(default_factory=list)
    text: str = "No preference, you choose."

    def answer(self, cards: list[dict[str, Any]]) -> list[dict[str, Any]]:
        out = []
        for card in cards:
            options = card.get("options") or []
            if card.get("type") == "text" or not options:
                out.append({"id": card["id"], "value": self.text})
                continue
            hits = [o for o in options if any(p.lower() in o.lower() or o.lower() in p.lower() for p in self.prefers)]
            if card["type"] == "multi":
                out.append({"id": card["id"], "value": hits or options[:1]})
            else:
                out.append({"id": card["id"], "value": (hits or options)[0]})
        return out


@dataclass
class Transcript:
    events: list[dict[str, Any]] = field(default_factory=list)
    asks: int = 0
    timed_out: bool = False
    final_text: str = ""  # assistant text after the last user turn

    @property
    def outputs(self) -> list[dict[str, Any]]:
        """Every plan / refusal card shown, in order."""
        return [e for e in self.events if e["type"] in ("plan", "refusal")]

    @property
    def final(self) -> dict[str, Any] | None:
        return self.outputs[-1] if self.outputs else None

    def traces(self, status: str | None = None) -> list[dict[str, Any]]:
        return [e for e in self.events if e["type"] == "tool_trace" and e["status"] != "start"
                and (status is None or e["status"] == status)]


async def converse(
    agent: Agent,
    session: Session,
    turns: list[str],
    persona: Persona | None = None,
    scenario: str | None = None,
    timeout: float = 900,
    on_event: Emit | None = None,
) -> Transcript:
    """Play `turns` as user messages, answering any question cards, within `timeout` seconds overall."""
    persona = persona or Persona()
    tr = Transcript()

    async def emit(ev: dict[str, Any]) -> None:
        tr.events.append(ev)
        if on_event:
            await on_event(ev)

    async def play() -> None:
        if scenario:
            await agent.handle(session, {"type": "set_scenario", "scenario": scenario}, emit)
        for text in turns:
            tr.final_text = ""
            mark = len(tr.events)
            await agent.handle(session, {"type": "user_message", "text": text}, emit)
            while (done := tr.events[-1] if tr.events else {}).get("waiting_for") and tr.asks < MAX_ASKS:
                ask = next(e for e in reversed(tr.events) if e["type"] == "ask_user" and e["call_id"] == done["waiting_for"])
                tr.asks += 1
                await agent.handle(session, {"type": "card_answer", "call_id": ask["call_id"], "answers": persona.answer(ask["cards"])}, emit)
            tr.final_text = "".join(e["text"] for e in tr.events[mark:] if e["type"] == "assistant_delta")

    try:
        await asyncio.wait_for(play(), timeout)
    except asyncio.TimeoutError:
        tr.timed_out = True
    return tr
