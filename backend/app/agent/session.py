"""Per-conversation state: history, the paused ask_user call, the gate ledger, demo scenario."""

from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from ..llm.base import Message, ToolResult
from ..paths import TRACES

Emit = Callable[[dict[str, Any]], Awaitable[None]]


@dataclass
class Ledger:
    """What this session has actually checked, so present_plan/refuse can be gated on it."""

    closures_checked: set[str] = field(default_factory=set)  # trail ids
    closed: set[str] = field(default_factory=set)  # trail ids check_closures reported closed
    weather_dates: set[str] = field(default_factory=set)  # YYYY-MM-DD
    no_go: dict[str, list[str]] = field(default_factory=dict)  # date -> no-go warning codes that apply to it
    warnings: dict[str, list[str]] = field(default_factory=dict)  # date -> every applicable warning code (incl. WHOT)
    forecast: dict[str, str] = field(default_factory=dict)  # date -> forecast text
    max_c: dict[str, float] = field(default_factory=dict)  # date -> forecast max temperature
    sunset: dict[str, str] = field(default_factory=dict)  # date -> HH:MM


@dataclass
class Pending:
    ask_call_id: str
    results: list[ToolResult]  # results of sibling calls from the same assistant turn
    cards: list[dict[str, Any]] = field(default_factory=list)  # re-sent in `hello` after a reconnect


@dataclass
class Session:
    id: str
    messages: list[Message] = field(default_factory=list)
    scenario: str = "live"  # live | clear | t8 | rainstorm | thunderstorm | closure:<trail_id>
    ledger: Ledger = field(default_factory=Ledger)
    pending: Pending | None = None
    loaded_skills: set[str] = field(default_factory=set)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    def reset(self) -> None:
        self.messages.clear()
        self.ledger = Ledger()
        self.pending = None
        self.loaded_skills.clear()

    def set_scenario(self, scenario: str) -> None:
        """Checks made under another scenario no longer hold, so the gate must see them re-run."""
        if scenario != self.scenario:
            self.ledger = Ledger(sunset=self.ledger.sunset)  # sunset is scenario-independent
        self.scenario = scenario

    def trace(self, event: dict[str, Any]) -> None:
        TRACES.mkdir(parents=True, exist_ok=True)
        with (TRACES / f"{self.id}.jsonl").open("a") as f:
            f.write(json.dumps({"t": round(time.time(), 3), **event}, ensure_ascii=False) + "\n")


class SessionStore:
    def __init__(self) -> None:
        self._sessions: dict[str, Session] = {}

    def get(self, session_id: str) -> Session:
        if session_id not in self._sessions:
            self._sessions[session_id] = Session(session_id)
        return self._sessions[session_id]

    def peek(self, session_id: str) -> Session | None:
        """The session if it exists, without creating one."""
        return self._sessions.get(session_id)
