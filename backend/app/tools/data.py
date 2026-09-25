"""Frozen trail dataset (from scripts/ingest_afcd.py) and live government feeds."""

from __future__ import annotations

import base64
import json
import math
import re
from array import array
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


_TRKPT = re.compile(r'<trkpt\s+lat="([-\d.]+)"\s+lon="([-\d.]+)"\s*>\s*(?:<ele>([-\d.]+)</ele>)?')
ASCENT_HYSTERESIS_M = 5  # the GPX heights are integer DEM samples: ignore wiggles smaller than this
PROFILE_POINTS = 120


def _gpx(tid: str) -> list[tuple[float, float, float | None]]:
    """The official GPX track as (lat, lng, ele or None), or [] when there is no GPX."""
    path = DATA / "gpx" / f"{tid}.gpx"
    if not path.exists():
        return []
    return [(float(lat), float(lng), float(ele) if ele else None) for lat, lng, ele in _TRKPT.findall(path.read_text())]


def _km(a: tuple[float, ...], b: tuple[float, ...]) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371.0 * math.asin(math.sqrt(h))


@lru_cache
def profiles() -> dict[str, dict[str, Any]]:
    """trail_id -> elevation profile from the official GPX (start -> finish), for trails whose GPX has heights.

    ascent_m / descent_m use a hysteresis threshold, since summing every 1 m DEM step roughly doubles them.
    d_km / ele_m are downsampled to about PROFILE_POINTS points for the app's chart.
    """
    out: dict[str, dict[str, Any]] = {}
    for tid in trails():
        pts = _gpx(tid)
        if len(pts) < 2 or any(p[2] is None for p in pts):
            continue
        dist, ele = [0.0], [p[2] or 0.0 for p in pts]
        for a, b in zip(pts, pts[1:]):
            dist.append(dist[-1] + _km(a, b))
        ascent = descent = 0.0
        ref = ele[0]
        for e in ele:
            if e - ref >= ASCENT_HYSTERESIS_M:
                ascent, ref = ascent + e - ref, e
            elif ref - e >= ASCENT_HYSTERESIS_M:
                descent, ref = descent + ref - e, e
        step = max(1, len(pts) // PROFILE_POINTS)
        idx = list(range(0, len(pts), step)) + ([len(pts) - 1] if (len(pts) - 1) % step else [])
        out[tid] = {
            "d_km": [round(dist[i], 3) for i in idx], "ele_m": [round(ele[i]) for i in idx],
            "ascent_m": round(ascent), "descent_m": round(descent), "max_m": round(max(ele)), "min_m": round(min(ele)),
            "source": "AFCD official GPX track",
        }
    return out


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
        if pts := _gpx(tid):
            out[tid] = [[[round(lat, 6), round(lng, 6)] for lat, lng, _ in pts]]
            continue
        g = f["geometry"]
        lines = [g["coordinates"]] if g["type"] == "LineString" else g["coordinates"]
        out[tid] = [[[round(lat, 6), round(lng, 6)] for lng, lat, *_ in line] for line in lines if line]
    return out


@lru_cache
def knowledge() -> list[dict[str, Any]]:
    """Embedded passages of the official trail narratives (scripts/build_knowledge.py), vectors decoded."""
    path = DATA / "knowledge.json"
    if not path.exists():
        return []
    chunks = json.loads(path.read_text())["chunks"]
    for c in chunks:
        c["vec"] = array("f", base64.b64decode(c["vec"])).tolist()
    return chunks


@lru_cache
def _embedder():
    from ..llm.registry import build_embedder  # config.yaml is only read when search_knowledge is used

    return build_embedder()


async def embed_query(text: str) -> list[float]:
    return (await _embedder().embed([text]))[0]


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
