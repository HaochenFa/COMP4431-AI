"""Frozen government feeds for eval runs, so a score doesn't depend on the day's real weather.

The forecast is synthesised relative to today (fine, 29°C, every day of the 9-day window) with
per-case overrides; warnings "now" are empty unless a case sets them; sunrise/sunset and closures
come from the committed seeds in data/snapshots/.
"""

from __future__ import annotations

import json
from contextlib import contextmanager
from datetime import timedelta
from typing import Any, Generator

from app.paths import SNAPSHOTS
from app.tools import data

WARNINGS_NOW: dict[str, dict[str, Any]] = {
    "t8": {"WTCSGNL": {"name": "Tropical Cyclone Warning Signal", "code": "TC8NE", "type": "No. 8 Northeast Gale or Storm Signal", "actionCode": "ISSUE"}},
    "rainstorm": {"WRAIN": {"name": "Rainstorm Warning Signal", "code": "WRAINR", "type": "Red", "actionCode": "ISSUE"}},
    "thunderstorm": {"WTS": {"name": "Thunderstorm Warning", "code": "WTS", "actionCode": "ISSUE"}},
    "hot": {"WHOT": {"name": "Very Hot Weather Warning", "code": "WHOT", "actionCode": "ISSUE"}},
}


def _seed(key: str) -> Any:
    return json.loads((SNAPSHOTS / f"{key}.json").read_text())["data"]


def seed_closures() -> list[dict]:
    rows = [f["attributes"] for f in _seed("closures").get("features", [])]
    for r in rows:
        r["trail_id"] = data.norm_id(r.get("Identification_number_of_Hiking") or "")
    return rows


def closed_ids(scenario: str = "live") -> set[str]:
    """Trails the frozen feeds (plus a closure scenario) report closed; used by grading."""
    ids = {r["trail_id"] for r in seed_closures() if "clos" in (r.get("Status") or "").lower()}
    if scenario.startswith("closure:"):
        ids.add(scenario.split(":", 1)[1])
    return ids


def fake_feeds(weather: dict[int, dict[str, Any]] | None = None, warnings_now: str | None = None):
    """(hko, closures) replacements. `weather` maps a day offset (0 = today) to overrides:
    {"weather": str, "max_c": int, "psr": str}."""
    weather = weather or {}
    today = data.today_hk()
    days = []
    for i in range(1, 10):
        d, o = today + timedelta(days=i), weather.get(i, {})
        days.append({
            "forecastDate": d.strftime("%Y%m%d"), "week": d.strftime("%A"), "forecastWind": "East force 3 to 4.",
            "forecastWeather": o.get("weather", "Mainly fine."),
            "forecastMaxtemp": {"value": o.get("max_c", 29), "unit": "C"},
            "forecastMintemp": {"value": o.get("max_c", 29) - 5, "unit": "C"},
            "PSR": o.get("psr", "Low"),
        })
    meta = {"data_from": "fixture"}

    async def hko(data_type: str, ttl: float = 600, endpoint: str = "weather.php", **params):
        if data_type == "fnd":
            return {"weatherForecast": days, "updateTime": f"{today}T11:30:00+08:00"}, meta
        if data_type == "flw":
            desc = weather.get(0, {}).get("weather", "Mainly fine. Hot during the day.")
            return {"forecastDesc": desc, "outlook": "Fine in the next couple of days.", "updateTime": f"{today}T11:45:00+08:00"}, meta
        if data_type == "warnsum":
            return WARNINGS_NOW.get(warnings_now or "", {}), meta
        if data_type == "SRS":
            return _seed(f"hko_SRS_json_{params['year']}"), meta
        raise ValueError(f"no fixture for HKO {data_type}")

    async def closures():
        return seed_closures(), meta

    return hko, closures


@contextmanager
def installed(weather: dict[int, dict[str, Any]] | None = None, warnings_now: str | None = None) -> Generator[None]:
    saved = data.hko, data.closures
    data.hko, data.closures = fake_feeds(weather, warnings_now)
    try:
        yield
    finally:
        data.hko, data.closures = saved
