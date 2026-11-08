"""REST helpers for the app's browse screens: the trail list and detail, the home screen's conditions, and read-aloud (/tts).

AFCD photos (scripts/fetch_photos.py) are served as static files from /photos by main.py.
"""

from __future__ import annotations

import asyncio
import re
from datetime import date, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request, Response

from . import tts
from .agent.session import Session, SessionStore
from .paths import DATA
from .tools import data
from .tools.base import ToolBox, ToolContext

PHOTOS = DATA / "photos"
# HKO writes both "The maximum temperature will be around 33 degrees" and "a maximum temperature of around 28 degrees".
_TODAY_MAX = re.compile(r"maximum temperature (?:will be |of )?(?:about |around )?(\d+) degrees", re.I)
_RANGE = re.compile(r"bytes=(\d*)-(\d*)")


def _byte_range(header: str | None, size: int) -> tuple[int, int] | None:
    """The one byte range a client asked for, as (first, last) inclusive; None for the whole body."""
    m = _RANGE.fullmatch((header or "").strip())
    if not m or not (m[1] or m[2]):
        return None
    first = int(m[1]) if m[1] else max(size - int(m[2]), 0)
    last = min(int(m[2]), size - 1) if m[1] and m[2] else size - 1
    if first >= size or first > last:
        raise HTTPException(416, "range not satisfiable", headers={"Content-Range": f"bytes */{size}"})
    return first, last


def _start(tid: str) -> list[float] | None:
    segs = data.geometries().get(tid) or []
    return segs[0][0] if segs and segs[0] else None


def _has_photo(tid: str) -> bool:
    return (PHOTOS / "thumb" / f"{tid}.jpg").exists()


def _weekend_after(today: date) -> list[date]:
    """Today, then the next Saturday and Sunday after it (at most three days, all inside the 9-day forecast)."""
    ahead = [today + timedelta(days=i) for i in range(1, 8)]
    return [today, *[d for d in ahead if d.weekday() >= 5][:2]]


async def _noop(_: dict[str, Any]) -> None:
    pass


def build_router(sessions: SessionStore, toolbox: ToolBox) -> APIRouter:
    router = APIRouter()

    @router.get("/trails")
    async def trail_list() -> list[dict[str, Any]]:
        profiles = data.profiles()
        out = []
        for t in data.trails().values():
            prof = profiles.get(t["id"]) or {}
            out.append({
                "id": t["id"],
                "name": t["name"],
                "trail": t["trail"],
                "section": t["section"],
                "region": t["region"],
                "difficulty": t["difficulty"],
                "start": t["start"],
                "finish": t["finish"],
                "length_km": t["length_km"],
                "hours": t.get("official_hours"),
                "stars": t.get("stars"),
                "ascent_m": prof.get("ascent_m"),
                "max_m": prof.get("max_m"),
                "start_coord": _start(t["id"]),
                "photo": _has_photo(t["id"]),
                "landmarks": data.landmarks(t),
                "search_zh": [n for n in (t.get("name_zh"), *data.landmarks_zh(t)) if n],
            })
        return out

    @router.get("/closures")
    async def closures(session: str = "default") -> dict[str, Any]:
        """trail id -> closed / partial / diversion, from the same check the agent runs, under the session's demo scenario."""
        live = sessions.peek(session)
        scratch = Session(f"closures:{session}", scenario=live.scenario if live else "live")
        out = await toolbox.tools["check_closures"].handler({"ids": list(data.trails())}, ToolContext(scratch, emit=_noop, call_id="closures"))
        return {tid: entry for tid, entry in out.content["trails"].items() if entry["closed"] or entry.get("diversion")}

    @router.get("/trails/{trail_id}")
    async def trail(trail_id: str) -> dict[str, Any]:
        t = data.trails().get(trail_id)
        if not t:
            raise HTTPException(404, "unknown trail")
        return {**t, "segments": data.geometries().get(trail_id, []), "profile": data.profiles().get(trail_id),
                "photo": _has_photo(trail_id), "landmarks": data.landmarks(t)}

    @router.get("/conditions")
    async def conditions(session: str = "default") -> dict[str, Any]:
        """HKO forecast, warnings and sunset for today and the coming weekend, under the session's demo scenario.

        The weather/daylight handlers record what they return in `session.ledger`, which is what lets
        present_plan through the safety gate. So they run against a throwaway session: the home screen
        looking at the forecast must never count as the agent having checked it.
        """
        live = sessions.peek(session)
        scratch = Session(f"conditions:{session}", scenario=live.scenario if live else "live")
        ctx = ToolContext(scratch, emit=_noop, call_id="conditions")
        days, warnings = [], {}
        for d in _weekend_after(data.today_hk()):
            day: dict[str, Any] = {"date": d.isoformat()}
            try:
                w = await toolbox.tools["get_weather"].handler({"date": d.isoformat()}, ctx)
                if isinstance(w.content, dict):  # also with no forecast: warnings in force still count
                    f = w.content.get("forecast") or {}
                    summary = f.get("weather") or f.get("desc")
                    day.update(summary=summary, max_c=f.get("max_c"), min_c=f.get("min_c"),
                               rain=f.get("rain_probability"), no_go=w.content.get("no_go_warnings", []))
                    if day["max_c"] is None and summary:  # today's forecast (flw) is prose; HKO states the high in it
                        m = _TODAY_MAX.search(summary)
                        day["max_c"] = int(m.group(1)) if m else None
                    warnings = warnings or w.content.get("warnings_in_force") or {}
                s = await toolbox.tools["get_daylight"].handler({"date": d.isoformat()}, ctx)
                if not s.is_error and isinstance(s.content, dict):
                    day["sunset"] = s.content.get("sunset")
            except Exception as e:  # a feed and its fallbacks all failed: show the day without numbers
                day["error"] = type(e).__name__
            days.append(day)
        return {"scenario": scratch.scenario, "warnings": warnings, "days": days}

    return router


def build_tts_router(speaker: tts.Speaker) -> APIRouter:
    """Read-aloud for the app. A GET, so the app's audio player can stream the WAV straight from the URL."""
    router = APIRouter()

    @router.get("/tts/voices")
    async def tts_voices() -> dict[str, Any]:
        return {"status": speaker.status, "voices": speaker.voices(), "default": tts.DEFAULT_VOICE}

    @router.api_route("/tts", methods=["GET", "HEAD"])
    async def speak(request: Request, text: str = Query(min_length=1, max_length=tts.MAX_CHARS), voice: str = tts.DEFAULT_VOICE,
                    speed: float = Query(1.0, ge=0.5, le=2.0)) -> Response:
        """The app's player (expo-audio, i.e. AVPlayer) streams the clip itself: it probes with HEAD and
        `Range: bytes=0-1`, and gives up on a server that answers a range request with 200 (AVError -11850,
        "server incorrectly configured"), so byte ranges are honoured here."""
        try:
            clip = await asyncio.to_thread(speaker.wav, text, voice, speed)
        except tts.NotReady as e:
            raise HTTPException(503, f"voice model {e}") from None
        except ValueError as e:
            raise HTTPException(422, str(e)) from None
        headers = {"Accept-Ranges": "bytes", "Cache-Control": "max-age=3600"}
        status, body = 200, clip
        if rng := _byte_range(request.headers.get("range"), len(clip)):
            first, last = rng
            status, body = 206, clip[first:last + 1]
            headers["Content-Range"] = f"bytes {first}-{last}/{len(clip)}"
        if request.method == "HEAD":
            headers["Content-Length"] = str(len(body))
            body = b""
        return Response(body, status, media_type="audio/wav", headers=headers)

    return router
