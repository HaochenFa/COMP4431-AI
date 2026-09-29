"""FastAPI entry point: WebSocket chat, plus the REST helpers in rest.py and the AFCD photos."""

from __future__ import annotations

import asyncio
import os
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles

load_dotenv()

from .agent.harness import Agent  # noqa: E402  (after load_dotenv so keys are visible)
from .agent.session import SessionStore  # noqa: E402
from .llm.registry import build_provider  # noqa: E402
from .rest import PHOTOS, build_router  # noqa: E402
from .tools import data  # noqa: E402

app = FastAPI(title="Trailhead - HK hiking agent")
sessions = SessionStore()
provider = build_provider()
agent = Agent(provider)
app.include_router(build_router(sessions, agent.toolbox))
# check_dir=False: photos are optional (scripts/fetch_photos.py); the app falls back to route art.
app.mount("/photos", StaticFiles(directory=PHOTOS, check_dir=False), name="photos")


class _Connection:
    def __init__(self, ws: WebSocket):
        self.ws = ws
        self.lock = asyncio.Lock()

    async def send(self, event: dict[str, Any]) -> None:
        async with self.lock:
            try:
                await self.ws.send_json(event)
            except Exception:  # the client went away mid-turn; the event is dropped, the turn carries on
                pass


live: dict[str, _Connection] = {}  # session id -> newest socket


@app.get("/health")
async def health() -> dict[str, Any]:
    return {"ok": True, "provider": provider.key, "model": provider.model, "trails": len(data.trails()),
            "profile": os.getenv("LLM_PROFILE", "default")}


@app.websocket("/ws/chat")
async def chat(ws: WebSocket, session: str = "default") -> None:
    await ws.accept()
    s = sessions.get(session)
    conn = _Connection(ws)
    live[s.id] = conn  # a turn already running for this session now streams to this socket

    async def emit(event: dict[str, Any]) -> None:
        # Always the session's newest socket, so a turn survives an app reload or reconnect.
        if target := live.get(s.id):
            await target.send(event)

    pending = {"call_id": s.pending.ask_call_id, "cards": s.pending.cards} if s.pending else None
    await conn.send({"type": "hello", "session": s.id, "scenario": s.scenario, "model": provider.model,
                     "waiting_for": pending["call_id"] if pending else None, "pending_ask": pending})
    tasks: set[asyncio.Task] = set()
    try:
        while True:
            event = await ws.receive_json()
            task = asyncio.create_task(agent.handle(s, event, emit))  # keep receiving while the agent works
            tasks.add(task)
            task.add_done_callback(tasks.discard)
    except WebSocketDisconnect:
        # Don't cancel running turns: they finish (keeping history consistent) and stream to the
        # next socket for this session, if one connects.
        if live.get(s.id) is conn:
            del live[s.id]

