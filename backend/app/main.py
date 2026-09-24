"""FastAPI entry point: WebSocket chat + a few REST helpers for the app."""

from __future__ import annotations

import asyncio
import os
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect

load_dotenv()

from .agent.harness import Agent  # noqa: E402  (after load_dotenv so keys are visible)
from .agent.session import SessionStore  # noqa: E402
from .llm.registry import build_provider  # noqa: E402
from .tools import data  # noqa: E402

app = FastAPI(title="Trailhead - HK hiking agent")
sessions = SessionStore()
provider = build_provider()
agent = Agent(provider)


@app.get("/health")
async def health() -> dict[str, Any]:
    return {"ok": True, "provider": provider.key, "model": provider.model, "trails": len(data.trails()),
            "profile": os.getenv("LLM_PROFILE", "default")}


@app.get("/trails/{trail_id}")
async def trail(trail_id: str) -> dict[str, Any]:
    t = data.trails().get(trail_id)
    if not t:
        raise HTTPException(404, "unknown trail")
    return {**t, "coords": data.geometries().get(trail_id, [])}


@app.websocket("/ws/chat")
async def chat(ws: WebSocket, session: str = "default") -> None:
    await ws.accept()
    s = sessions.get(session)
    send_lock = asyncio.Lock()

    async def emit(event: dict[str, Any]) -> None:
        async with send_lock:
            await ws.send_json(event)

    await emit({"type": "hello", "session": s.id, "scenario": s.scenario, "model": provider.model,
                "waiting_for": s.pending.ask_call_id if s.pending else None})
    tasks: set[asyncio.Task] = set()
    try:
        while True:
            event = await ws.receive_json()
            task = asyncio.create_task(agent.handle(s, event, emit))  # keep receiving while the agent works
            tasks.add(task)
            task.add_done_callback(tasks.discard)
    except WebSocketDisconnect:
        for t in tasks:
            t.cancel()
