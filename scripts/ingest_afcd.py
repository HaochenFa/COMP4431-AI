"""Pull the official AFCD trail layer + closures and enrich each section from its hiking.gov.hk page.

Outputs (all under data/):
  trails_raw.geojson       152 AFCD sections, WGS84 polylines + attributes
  trails.json              one record per section: attributes + official time/ratings/GPX link
  snapshots/closures.json  closed-trail snapshot (fallback for check_closures)
  gpx/<trail_id>.gpx       official GPX tracks (when the page links one)

Run from repo root:  uv --project backend run python scripts/ingest_afcd.py
"""

from __future__ import annotations

import html
import json
import re
import sys
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
ARCGIS = "https://services3.arcgis.com/6j1KwZfY2fZrfNMR/arcgis/rest/services"
TRAILS_URL = f"{ARCGIS}/Hiking_Trails_in_Country_Parks_of_Hong_Kong/FeatureServer/0/query"
CLOSED_URL = f"{ARCGIS}/Closed_Trails_in_Country_Parks/FeatureServer/0/query"
QUERY = {"where": "1=1", "outFields": "*", "outSR": "4326", "f": "geojson"}


def norm_id(raw: str) -> str:
    """AFCD layers disagree on zero padding ('cty_02' vs 'cty_2'); canonicalise to 'cty_2'."""
    prefix, _, num = raw.strip().rpartition("_")
    return f"{prefix}_{int(num)}" if num.isdigit() else raw.strip()


def fetch_geojson(client: httpx.Client, url: str) -> dict:
    r = client.get(url, params=QUERY)
    r.raise_for_status()
    return r.json()


def _text(fragment: str) -> str:
    t = re.sub(r"<[^>]+>", "|", fragment)
    t = html.unescape(re.sub(r"\s+", " ", t))
    return re.sub(r"(\|\s?)+", "|", t)


def parse_trail_page(page: str) -> dict:
    """Extract official summary fields from a hiking.gov.hk trail page (zh-tw)."""
    out: dict = {}
    i = page.find("路徑概要")
    summary = _text(page[i : i + 6000]) if i >= 0 else ""
    if m := re.search(r"時間\|([\d.]+)\s*小時", summary):
        out["official_hours"] = float(m.group(1))
    if m := re.search(r"綜合難度 \((\d) 星", summary):
        out["stars"] = int(m.group(1))
    for key, label in [("length", "長度"), ("time", "時間"), ("ascent", "總攀升"), ("surface", "路面狀況")]:
        if m := re.search(label + r" \(評分 (\d) 星\)", summary):
            out.setdefault("sub_ratings", {})[key] = int(m.group(1))
    if m := re.search(r'href="(//www\.hiking\.gov\.hk/[^"]+\.gpx)"', page):
        out["gpx_url"] = "https:" + m.group(1)
    if m := re.search(r'<meta name="description" content="([^"]*)"', page):
        out["description_zh"] = html.unescape(m.group(1)).strip()
    return out


def main() -> int:
    (DATA / "snapshots").mkdir(parents=True, exist_ok=True)
    (DATA / "gpx").mkdir(parents=True, exist_ok=True)
    with httpx.Client(timeout=30, follow_redirects=True) as client:
        trails = fetch_geojson(client, TRAILS_URL)
        print(f"trails: {len(trails['features'])} sections")

        closed = fetch_geojson(client, CLOSED_URL)
        closures = [f["properties"] for f in closed["features"]]
        # Same shape the backend cache writes (ArcGIS f=json), so check_closures can fall back to it offline.
        snapshot = {"fetched_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "data": {"features": [{"attributes": c} for c in closures]}}
        (DATA / "snapshots" / "closures.json").write_text(json.dumps(snapshot, ensure_ascii=False, indent=1))
        print(f"closures: {len(closures)} rows")

        records = []
        seen: set[str] = set()
        for feat in trails["features"]:
            p = feat["properties"]
            tid = norm_id(p["Trail_ID"])
            if tid in seen:  # the layer has at least one duplicated id (fmy_1)
                tid = f"{tid}_{p['OBJECTID']}"
            seen.add(tid)
            feat["properties"]["trail_id"] = tid
            url = (p["Webpage_En"] or "").strip()
            rec = {
                "id": tid,
                "afcd_id": p["Trail_ID"],
                "name": p["Trail_name_En"],
                "name_zh": p["Trail_name_Ch"],
                "trail": p["NAME"].title(),
                "section": p["Section_No"],
                "type": p["Type_En"],
                "region": p["Region_En"],
                "difficulty": p["Difficult_En"],
                "start": p["Startpt_En"],
                "finish": p["Finishpt_E"],
                "length_km": float(p["Length_KM"]) if p["Length_KM"] else None,
                "url": url if url.startswith("http") else None,
            }
            try:
                if rec["url"]:
                    rec.update(parse_trail_page(client.get(rec["url"]).text))
            except httpx.HTTPError as e:
                print(f"  ! page {rec['id']}: {e}", file=sys.stderr)
            if gpx_url := rec.get("gpx_url"):
                gpx_path = DATA / "gpx" / f"{rec['id']}.gpx"
                if not gpx_path.exists():
                    try:
                        g = client.get(gpx_url)
                        g.raise_for_status()
                        gpx_path.write_bytes(g.content)
                    except httpx.HTTPError as e:
                        print(f"  ! gpx {rec['id']}: {e}", file=sys.stderr)
            records.append(rec)
            print(f"  {rec['id']:<8} {str(rec.get('official_hours', '?')):>5}h {rec.get('stars', '?')}★  {rec['name'][:60]}")
            time.sleep(0.2)  # be polite to hiking.gov.hk

    (DATA / "trails_raw.geojson").write_text(json.dumps(trails, ensure_ascii=False))
    (DATA / "trails.json").write_text(json.dumps(records, ensure_ascii=False, indent=1))
    have_hours = sum("official_hours" in r for r in records)
    print(f"wrote {len(records)} trails ({have_hours} with official hours)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
