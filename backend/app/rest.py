"""REST helpers for the app's browse screens: the trail list and detail, and the home screen's conditions.

AFCD photos (scripts/fetch_photos.py) are served as static files from /photos by main.py.
"""

from __future__ import annotations

import re
from datetime import date, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException

from .agent.session import Session, SessionStore
from .paths import DATA
from .tools import data
from .tools.base import ToolBox, ToolContext

PHOTOS = DATA / "photos"
_TODAY_MAX = re.compile(r"maximum temperature will be (?:about|around) (\d+) degrees", re.I)


# English names for landmarks the official (Chinese) descriptions mention, so the app's trail search finds
# "Dragon's Back" (港島徑第八段 never says it in English). Only names that mean one place: 大浪灣 and 西灣 are
# each two different bays, so they're left out.
LANDMARKS = {
    "龍脊": "Dragon's Back", "獅子山": "Lion Rock", "大帽山": "Tai Mo Shan", "鳳凰山": "Lantau Peak",
    "大東山": "Sunset Peak", "馬鞍山": "Ma On Shan", "八仙嶺": "Pat Sin Leng", "飛鵝山": "Kowloon Peak",
    "太平山": "Victoria Peak", "蚺蛇尖": "Sharp Peak", "釣魚翁": "High Junk Peak", "紫羅蘭山": "Violet Hill",
    "孖崗山": "The Twins", "針山": "Needle Hill", "草山": "Grassy Hill", "望夫石": "Amah Rock",
    "筆架山": "Beacon Hill", "九龍坑山": "Cloudy Hill", "大老山": "Tate's Cairn", "柏架山": "Mount Parker",
    "渣甸山": "Jardine's Lookout", "畢拿山": "Mount Butler", "水牛山": "Buffalo Hill",
    "城門水塘": "Shing Mun Reservoir", "萬宜水庫": "High Island Reservoir", "昂坪": "Ngong Ping", "大澳": "Tai O",
    "荔枝窩": "Lai Chi Wo",
}


def _landmarks(t: dict[str, Any]) -> list[str]:
    text = (t.get("name_zh") or "") + (t.get("description_zh") or "")
    return [en for zh, en in LANDMARKS.items() if zh in text]


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
                "landmarks": _landmarks(t),
            })
        return out

    @router.get("/trails/{trail_id}")
    async def trail(trail_id: str) -> dict[str, Any]:
        t = data.trails().get(trail_id)
        if not t:
            raise HTTPException(404, "unknown trail")
        return {**t, "segments": data.geometries().get(trail_id, []), "profile": data.profiles().get(trail_id),
                "photo": _has_photo(trail_id), "landmarks": _landmarks(t)}

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
                if not w.is_error and isinstance(w.content, dict):
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
