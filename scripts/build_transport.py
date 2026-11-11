"""Nearest bus stops to each trail's start and finish, from the Transport Department GTFS feed on DATA.GOV.HK.

Output: data/transport.json (committed). Raw GTFS goes to data/gtfs_raw/ (gitignored, never committed).
Display-only: the agent never sees it.

Run from repo root:  uv --project backend run python scripts/build_transport.py [--refresh]
"""

from __future__ import annotations

import csv
import json
import re
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.transport import _route_key, nearest_stops  # noqa: E402

DATA = ROOT / "data"
RAW = DATA / "gtfs_raw"
BASE = "https://static.data.gov.hk/td/pt-headway-{lang}/{name}.txt"
FILES = {"en": ["stops", "routes", "trips", "stop_times"], "tc": ["stops"]}
SOURCE = "Transport Department, Public Transport Routes and Fares (GTFS), DATA.GOV.HK"
BUS = "3"  # GTFS route_type 3 = bus (this feed also has GMB minibuses, which share it)
TRKPT = re.compile(r'<trkpt lat="([-\d.]+)" lon="([-\d.]+)"')
OPERATOR_PREFIX = re.compile(r"^\[[^\]]*\]\s*")


def download(refresh: bool) -> None:
    with httpx.Client(timeout=300, follow_redirects=True, trust_env=False) as client:
        for lang, names in FILES.items():
            (RAW / lang).mkdir(parents=True, exist_ok=True)
            for n in names:
                path = RAW / lang / f"{n}.txt"
                if path.exists() and not refresh:
                    continue
                print(f"downloading {lang}/{n}.txt")
                r = client.get(BASE.format(lang=lang, name=n))
                r.raise_for_status()
                path.write_bytes(r.content)


def rows(lang: str, name: str):
    with open(RAW / lang / f"{name}.txt", encoding="utf-8-sig", newline="") as f:
        yield from csv.DictReader(f)


def clean_name(raw: str) -> str:
    """Stop names arrive as '[CTB] A|[KMB+CTB] A/<BR>A, ROAD|[KMB] A': the first variant, without its operator tag."""
    first = raw.split("|")[0].split("/<BR>")[0]
    return OPERATOR_PREFIX.sub("", first).strip()


def build_stops() -> list[dict]:
    routes = {r["route_id"]: r for r in rows("en", "routes") if r["route_type"] == BUS}
    trips = {t["trip_id"]: t["route_id"] for t in rows("en", "trips") if t["route_id"] in routes}
    served: dict[str, set[str]] = defaultdict(set)
    for st in rows("en", "stop_times"):
        rid = trips.get(st["trip_id"])
        if rid:
            r = routes[rid]
            number = r["route_short_name"]
            served[st["stop_id"]].add(f"GMB {number}" if r["agency_id"] == "GMB" else number)
    zh = {s["stop_id"]: clean_name(s["stop_name"]) for s in rows("tc", "stops")}
    out = []
    for s in rows("en", "stops"):
        if s["stop_id"] in served:
            out.append({
                "name": clean_name(s["stop_name"]),
                "name_zh": zh.get(s["stop_id"], ""),
                "lat": float(s["stop_lat"]),
                "lng": float(s["stop_lon"]),
                "routes": sorted(served[s["stop_id"]], key=_route_key),
            })
    return out


def ends(tid: str) -> tuple[tuple[float, float], tuple[float, float]] | None:
    path = DATA / "gpx" / f"{tid}.gpx"
    if not path.exists():
        return None
    pts = [(float(a), float(b)) for a, b in TRKPT.findall(path.read_text())]
    return (pts[0], pts[-1]) if pts else None


def main() -> None:
    download("--refresh" in sys.argv)
    agencies = defaultdict(set)
    for r in rows("en", "routes"):
        agencies[r["route_type"]].add(r["agency_id"])
    print("route types / operators in the feed:", {k: sorted(v) for k, v in agencies.items()})
    stops = build_stops()
    print(f"{len(stops)} bus stops served by at least one route")

    trails = json.loads((DATA / "trails.json").read_text())
    out, empty = {}, 0
    for t in trails:
        e = ends(t["id"])
        if not e:
            print("no GPX:", t["id"])
            continue
        start, finish = (nearest_stops(p, stops) for p in e)
        empty += (not start) + (not finish)
        out[t["id"]] = {"start": start, "finish": finish}
    result = {"source": SOURCE, "downloaded": date.today().isoformat(), "trails": out}
    (DATA / "transport.json").write_text(json.dumps(result, ensure_ascii=False, indent=1) + "\n")
    print(f"wrote data/transport.json: {len(out)} of {len(trails)} trails, {empty} ends with no stop within 1 km")


if __name__ == "__main__":
    main()
