"""Nearest bus stops to a point. Used by scripts/build_transport.py and tested offline; display-only data, never agent input."""

from __future__ import annotations

import math
import re
from typing import Any

MAX_M = 1000
MAX_STOPS = 3


def distance_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Straight-line (haversine) distance in metres between two (lat, lng) points."""
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371000.0 * math.asin(math.sqrt(h))


def nearest_stops(point: tuple[float, float], stops: list[dict[str, Any]], limit: int = MAX_STOPS, max_m: float = MAX_M) -> list[dict[str, Any]]:
    """Up to `limit` stops within `max_m` of `point`, nearest first.

    Each stop needs lat, lng, name, name_zh and routes. Distances are rounded to 10 m; stops with no
    route are skipped, and stops sharing a name are merged.
    """
    best: dict[str, tuple[float, dict[str, Any]]] = {}
    routes: dict[str, set[str]] = {}
    for s in stops:
        if not s["routes"]:
            continue
        d = distance_m(point, (s["lat"], s["lng"]))
        if d > max_m:
            continue
        # The two sides of a road share a name: list the nearer one once, with the routes of both.
        routes.setdefault(s["name"], set()).update(s["routes"])
        if s["name"] not in best or d < best[s["name"]][0]:
            best[s["name"]] = (d, s)
    hits = sorted(best.values(), key=lambda h: h[0])[:limit]
    return [
        {"name": s["name"], "name_zh": s["name_zh"], "distance_m": int(round(d / 10.0)) * 10, "routes": sorted(routes[s["name"]], key=_route_key)}
        for d, s in hits
    ]


def _route_key(r: str):
    m = re.match(r"([A-Za-z ]*?)(\d+)(.*)", r)
    return (m[1], int(m[2]), m[3]) if m else (r, 0, "")
