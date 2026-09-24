"""Frozen trail dataset (from scripts/ingest_afcd.py) and live government feeds."""

from __future__ import annotations

import json
import re
from datetime import date, datetime
from functools import lru_cache
from typing import Any
from zoneinfo import ZoneInfo

from ..cache import fetch_json
from ..paths import DATA

HKT = ZoneInfo("Asia/Hong_Kong")
HKO = "https://data.weather.gov.hk/weatherAPI/opendata"
CLOSED_URL = "https://services3.arcgis.com/6j1KwZfY2fZrfNMR/arcgis/rest/services/Closed_Trails_in_Country_Parks/FeatureServer/0/query"


def today_hk() -> date:
    return datetime.now(HKT).date()


@lru_cache
def trails() -> dict[str, dict[str, Any]]:
    return {t["id"]: t for t in json.loads((DATA / "trails.json").read_text())}


_TRKPT = re.compile(r'<trkpt\s+lat="([-\d.]+)"\s+lon="([-\d.]+)"')


@lru_cache
def geometries() -> dict[str, list[list[list[float]]]]:
    """trail_id -> segments, each [[lat, lng], ...].

    The official GPX track (one ordered segment, start -> finish) where there is one; otherwise the
    AFCD layer's parts as separate segments, since joining a MultiLineString draws lines across gaps.
    """
    gj = json.loads((DATA / "trails_raw.geojson").read_text())
    out: dict[str, list[list[list[float]]]] = {}
    for f in gj["features"]:
        tid = f["properties"]["trail_id"]
        gpx = DATA / "gpx" / f"{tid}.gpx"
        if gpx.exists() and (pts := _TRKPT.findall(gpx.read_text())):
            out[tid] = [[[round(float(lat), 6), round(float(lng), 6)] for lat, lng in pts]]
            continue
        g = f["geometry"]
        lines = [g["coordinates"]] if g["type"] == "LineString" else g["coordinates"]
        out[tid] = [[[round(lat, 6), round(lng, 6)] for lng, lat, *_ in line] for line in lines if line]
    return out


def norm_id(raw: str) -> str:
    prefix, _, num = raw.strip().rpartition("_")
    return f"{prefix}_{int(num)}" if num.isdigit() else raw.strip()


async def closures() -> tuple[list[dict], dict]:
    data, meta = await fetch_json(
        "closures", CLOSED_URL, {"where": "1=1", "outFields": "*", "returnGeometry": "false", "f": "json"}, ttl=3600
    )
    rows = [f["attributes"] for f in data.get("features", [])]
    for r in rows:
        r["trail_id"] = norm_id(r.get("Identification_number_of_Hiking") or "")
    return rows, meta


async def hko(data_type: str, ttl: float = 600, endpoint: str = "weather.php", **params) -> tuple[Any, dict]:
    key = "hko_" + data_type + "".join(f"_{v}" for v in params.values())
    return await fetch_json(key, f"{HKO}/{endpoint}", {"dataType": data_type, "lang": "en", **params}, ttl=ttl)
