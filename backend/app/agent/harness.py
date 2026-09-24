"""The agent loop: stream a model turn, run its tool calls, repeat until it answers,
pauses on ask_user, or exhausts the step budget."""

from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Any

import jsonschema

from ..llm.base import Completion, Message, Provider, TextDelta, ToolCall, ToolResult
from ..paths import PROMPTS, SKILLS
from ..tools import agentic, hiking
from ..tools.base import ToolBox, ToolContext, ToolOutput
from ..tools.data import HKT
from .session import Emit, Pending, Session

MAX_STEPS = 10


def build_toolbox() -> ToolBox:
    box = ToolBox()
    hiking.register(box)
    agentic.register(box)
    return box


def system_prompt() -> str:
    now = datetime.now(HKT)
    base = (PROMPTS / "system.md").read_text()
    safety = re.sub(r"\A---.*?---\s*", "", (SKILLS / "hike-safety.md").read_text(), flags=re.S)
    return base.format(today=now.strftime("%Y-%m-%d (%A)"), now=now.strftime("%H:%M"), safety=safety)


def _to_text(content: Any) -> str:
    return content if isinstance(content, str) else json.dumps(content, ensure_ascii=False, default=str)


class Agent:
    def __init__(self, provider: Provider, toolbox: ToolBox | None = None, max_steps: int = MAX_STEPS):
        self.provider = provider
        self.toolbox = toolbox or build_toolbox()
        self.max_steps = max_steps

    async def handle(self, session: Session, event: dict[str, Any], emit: Emit) -> None:
        """Entry point for one client event (user_message / card_answer / reset)."""
        async with session.lock:
            kind = event.get("type")
            session.trace({"in": event})
            if kind == "reset":
                session.reset()
                await emit({"type": "reset_ok"})
                return
            if kind == "set_scenario":
                session.scenario = event.get("scenario") or "live"
                await emit({"type": "scenario", "scenario": session.scenario})
                return
            if kind == "card_answer":
                if not session.pending or session.pending.ask_call_id != event.get("call_id"):
                    await emit({"type": "error", "message": "No question is waiting for that answer."})
                    return
                self._resolve_pending(session, {"answers": event.get("answers", [])})
            elif kind == "user_message":
                text = (event.get("text") or "").strip()
                if not text:
                    return
                if session.pending:  # user typed instead of tapping a card: treat it as the answer
                    self._resolve_pending(session, {"answers": [], "free_text": text})
                else:
                    session.messages.append(Message("user", text=text))
            else:
                await emit({"type": "error", "message": f"Unknown event type {kind!r}"})
                return
            await self._loop(session, emit)

    def _resolve_pending(self, session: Session, answer: dict[str, Any]) -> None:
        assert session.pending
        results = session.pending.results + [ToolResult(session.pending.ask_call_id, json.dumps(answer, ensure_ascii=False))]
        session.messages.append(Message("tool", tool_results=results))
        session.pending = None

    async def _loop(self, session: Session, emit: Emit) -> None:
        async def traced_emit(ev: dict[str, Any]) -> None:
            session.trace({"out": ev})
            await emit(ev)

        system = system_prompt()
        for _ in range(self.max_steps):
            completion: Completion | None = None
            try:
                async for ev in self.provider.stream(system, session.messages, self.toolbox.specs):
                    if isinstance(ev, TextDelta):
                        await emit({"type": "assistant_delta", "text": ev.text})
                    else:
                        completion = ev
            except Exception as e:  # provider/network failure: surface it, keep the session usable
                await traced_emit({"type": "error", "message": f"{type(e).__name__}: {e}"})
                await traced_emit({"type": "assistant_done"})
                return
            assert completion is not None
            msg = completion.message
            session.messages.append(msg)
            session.trace({"assistant": msg.text, "tool_calls": [c.__dict__ for c in msg.tool_calls],
                           "stop": completion.stop, "usage": completion.usage})
            if completion.stop == "refusal":
                await traced_emit({"type": "error", "message": "The model declined to answer this request."})
            if not msg.tool_calls:
                await traced_emit({"type": "assistant_done"})
                return
            results, ask_id = await self._run_tools(session, msg.tool_calls, traced_emit)
            if ask_id:
                session.pending = Pending(ask_id, results)
                await traced_emit({"type": "assistant_done", "waiting_for": ask_id})
                return
            session.messages.append(Message("tool", tool_results=results))
        await traced_emit({"type": "error", "message": f"Stopped after {self.max_steps} steps without an answer."})
        await traced_emit({"type": "assistant_done"})

    async def _run_tools(self, session: Session, calls: list[ToolCall], emit: Emit) -> tuple[list[ToolResult], str | None]:
        results: list[ToolResult] = []
        ask_id: str | None = None
        for call in calls:
            tool = self.toolbox.tools.get(call.name)
            await emit({"type": "tool_trace", "call_id": call.id, "name": call.name, "args": call.arguments, "status": "start"})
            if tool is None:
                out = ToolOutput(f"Unknown tool {call.name!r}", is_error=True, summary="unknown tool")
            elif call.name == "ask_user" and ask_id:
                out = ToolOutput("Only one ask_user per turn; merge the questions into one call.", is_error=True, summary="duplicate ask")
            else:
                try:
                    jsonschema.validate(call.arguments, tool.spec.parameters)
                    out = await tool.handler(call.arguments, ToolContext(session, emit, call.id))
                except jsonschema.ValidationError as e:
                    out = ToolOutput(f"INVALID_ARGUMENTS: {e.message}", is_error=True, summary="invalid arguments")
                except Exception as e:  # a tool failure is reported to the model, not raised
                    out = ToolOutput(f"{type(e).__name__}: {e}", is_error=True, summary="tool failed")
            status = "blocked" if out.blocked else "error" if out.is_error else "waiting" if out.pause else "ok"
            await emit({"type": "tool_trace", "call_id": call.id, "name": call.name, "status": status, "summary": out.summary})
            if out.pause:
                ask_id = call.id
            else:
                results.append(ToolResult(call.id, _to_text(out.content), out.is_error))
        return results, ask_id
