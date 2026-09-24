"""Ground-truth tools. Every number the agent states must come from one of these."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from . import data
from .base import ToolBox, ToolContext, ToolOutput, obj

DATE = {"type": "string", "description": "YYYY-MM-DD (Hong Kong date)"}

# HKO warning codes that make an exposed hike a no-go.
NO_GO_WARNINGS = {
    "WTCSGNL": lambda code: not code.startswith(("TC1", "TC3")),  # T8 and above
    "WRAIN": lambda code: True,  # amber / red / black rainstorm
    "WTS": lambda code: True,  # thunderstorm
    # WHOT (Very Hot Weather) is reported in warnings_in_force but not an automatic no-go:
    # hike-safety decides from duration and shade (EXTREME_HEAT).
}

# Demo scenario overrides (session.scenario). Clearly labelled in the tool result.
SCENARIO_WARNINGS: dict[str, dict[str, dict[str, str]]] = {
    "t8": {"WTCSGNL": {"name": "Tropical Cyclone Warning Signal", "code": "TC8NE", "type": "No. 8 Northeast Gale or Storm Signal"}},
    "rainstorm": {"WRAIN": {"name": "Rainstorm Warning Signal", "code": "WRAINR", "type": "Red"}},
    "thunderstorm": {"WTS": {"name": "Thunderstorm Warning", "code": "WTS"}},
    "clear": {},
}


def _parse_date(s: str) -> date:
    return date.fromisoformat(s)


def _brief(t: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": t["id"],
        "name": t["name"],
        "region": t["region"],
        "length_km": t["length_km"],
        "hours": t.get("official_hours"),
        "stars": t.get("stars"),
        "difficulty": t["difficulty"],
        "start": t["start"],
        "finish": t["finish"],
    }


def register(box: ToolBox) -> None:
    @box.register(
        "search_trails",
        "Filter the official AFCD trail set (152 sections). Returns brief records sorted by walking time. "
        "Numbers here are official (hiking.gov.hk); quote them, never estimate your own.",
        obj(
            {
                "region": {"type": "string", "description": "One of: Hong Kong Island, Lantau Island, Sai Kung, North New Territories, Central New Territories, West New Territories (substring match, e.g. 'New Territories')"},
                "max_hours": {"type": "number"},
                "min_hours": {"type": "number"},
                "max_stars": {"type": "integer", "minimum": 1, "maximum": 5},
                "min_stars": {"type": "integer", "minimum": 1, "maximum": 5},
                "text": {"type": "string", "description": "Substring of the English trail name, start or finish"},
                "sort": {"type": "string", "enum": ["longest", "shortest"], "description": "By official hours; default longest first"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 25},
            }
        ),
    )
    async def search_trails(args: dict[str, Any], ctx: ToolContext) -> ToolOutput:
        rows = list(data.trails().values())
        if r := args.get("region"):
            rows = [t for t in rows if r.lower() in (t["region"] or "").lower()]
        if (h := args.get("max_hours")) is not None:
            rows = [t for t in rows if t.get("official_hours") is not None and t["official_hours"] <= h]
        if (h := args.get("min_hours")) is not None:
            rows = [t for t in rows if t.get("official_hours") is not None and t["official_hours"] >= h]
        if (s := args.get("max_stars")) is not None:
            rows = [t for t in rows if t.get("stars") is not None and t["stars"] <= s]
        if (s := args.get("min_stars")) is not None:
            rows = [t for t in rows if t.get("stars") is not None and t["stars"] >= s]
        if q := (args.get("text") or "").lower():
            rows = [t for t in rows if q in f'{t["name"]} {t["start"]} {t["finish"]}'.lower()]
        sign = 1 if args.get("sort") == "shortest" else -1
        rows.sort(key=lambda t: (t.get("official_hours") is None, sign * (t.get("official_hours") or 0)))
        out = [_brief(t) for t in rows[: args.get("limit", 12)]]
        return ToolOutput({"count": len(rows), "trails": out}, summary=f"{len(rows)} trails match")

    @box.register(
        "get_trail",
        "Full official record for one trail: length, official walking time, star ratings, start/finish, "
        "the official page URL (cite it) and the Chinese description.",
        obj({"id": {"type": "string"}}, ["id"]),
    )
    async def get_trail(args: dict[str, Any], ctx: ToolContext) -> ToolOutput:
        t = data.trails().get(args["id"])
        if not t:
            return ToolOutput(f"Unknown trail id {args['id']!r}", is_error=True, summary="unknown trail")
        return ToolOutput(t, summary=t["name"])

    @box.register(
        "check_closures",
        "Check AFCD's live 'Closed Trails in Country Parks' list for the given trail ids. Required before presenting or refusing a plan.",
        obj({"ids": {"type": "array", "items": {"type": "string"}, "minItems": 1}}, ["ids"]),
    )
    async def check_closures(args: dict[str, Any], ctx: ToolContext) -> ToolOutput:
        rows, meta = await data.closures()
        scenario = ctx.session.scenario
        if scenario.startswith("closure:"):
            forced = scenario.split(":", 1)[1]
            rows = rows + [{"trail_id": forced, "Name_of_Hiking_Trail": data.trails().get(forced, {}).get("name", forced),
                            "Status": "Temporary closed", "Effective_Date": "today", "Expected_Expiry_Date": "Until further notice",
                            "scenario_override": True}]
        result = {}
        for tid in args["ids"]:
            hits = [r for r in rows if r["trail_id"] == tid]
            result[tid] = (
                {"closed": True, "partial": "(partial)" in (hits[0].get("Name_of_Hiking_Trail") or ""), "status": hits[0].get("Status"),
                 "effective": hits[0].get("Effective_Date"), "expected_expiry": hits[0].get("Expected_Expiry_Date")}
                if hits else {"closed": False}
            )
            ctx.session.ledger.closures_checked.add(tid)
        closed = [k for k, v in result.items() if v["closed"]]
        content = {"trails": result, "source": "AFCD Closed Trails in Country Parks (CSDI)", **meta}
        if scenario.startswith("closure:"):
            content["note"] = "Demo scenario override active"
        return ToolOutput(content, summary=f"closed: {', '.join(closed)}" if closed else "no closures")

    @box.register(
        "get_weather",
        "Hong Kong Observatory weather for a date: the 9-day forecast (or today's local forecast) plus warnings currently "
        "in force. Required before presenting or refusing a plan. `no_go_warnings` lists warnings that rule out exposed hikes.",
        obj({"date": DATE}, ["date"]),
    )
    async def get_weather(args: dict[str, Any], ctx: ToolContext) -> ToolOutput:
        d = _parse_date(args["date"])
        today = data.today_hk()
        if d < today:
            return ToolOutput(f"{d} is in the past; today is {today}", is_error=True, summary="date in the past")
        out: dict[str, Any] = {"date": d.isoformat(), "source": "Hong Kong Observatory Open Data"}
        if d > today + timedelta(days=9):
            # Not an error: the check was made; there is simply no official forecast yet.
            ctx.session.ledger.weather_dates.add(d.isoformat())
            out.update(forecast=None, warnings_in_force={}, no_go_warnings=[],
                       note=f"Beyond the HKO 9-day window (ends {today + timedelta(days=9)}). Plan provisionally and tell the user to re-check nearer the date.")
            return ToolOutput(out, summary="beyond 9-day forecast")
        if d == today:
            flw, _ = await data.hko("flw")
            out["forecast"] = {"desc": flw.get("forecastDesc"), "outlook": flw.get("outlook"), "update_time": flw.get("updateTime")}
        else:
            fnd, meta = await data.hko("fnd")
            day = next((f for f in fnd.get("weatherForecast", []) if f.get("forecastDate") == d.strftime("%Y%m%d")), None)
            if day:
                out["forecast"] = {
                    "weather": day.get("forecastWeather"),
                    "wind": day.get("forecastWind"),
                    "max_c": (day.get("forecastMaxtemp") or {}).get("value"),
                    "min_c": (day.get("forecastMintemp") or {}).get("value"),
                    "rain_probability": day.get("PSR"),
                }
            out["update_time"] = fnd.get("updateTime")
            out.update({k: v for k, v in meta.items() if k == "stale"})

        scenario = ctx.session.scenario
        if scenario in SCENARIO_WARNINGS:
            warnings = SCENARIO_WARNINGS[scenario]
            out["note"] = f"Demo scenario override active: {scenario}"
        else:
            warnsum, _ = await data.hko("warnsum", ttl=120)
            warnings = {k: {"name": v.get("name"), "code": v.get("code"), "type": v.get("type")} for k, v in (warnsum or {}).items()
                        if v.get("actionCode") != "CANCEL"}
        out["warnings_in_force"] = warnings
        out["warnings_apply_to"] = "now (HKO issues warnings in real time; treat as applying to today and the next morning)"
        no_go = [w["code"] for k, w in warnings.items() if k in NO_GO_WARNINGS and NO_GO_WARNINGS[k](w.get("code") or "")]
        out["no_go_warnings"] = no_go if d <= today + timedelta(days=1) else []
        ctx.session.ledger.weather_dates.add(d.isoformat())
        summary = (out.get("forecast") or {}).get("weather") or (out.get("forecast") or {}).get("desc") or "forecast"
        if no_go:
            summary = f"WARNING {', '.join(no_go)}"
        return ToolOutput(out, summary=str(summary)[:80])

    @box.register(
        "get_daylight",
        "Official HKO sunrise and sunset for a date. Use the sunset to check the hike finishes in daylight.",
        obj({"date": DATE}, ["date"]),
    )
    async def get_daylight(args: dict[str, Any], ctx: ToolContext) -> ToolOutput:
        d = _parse_date(args["date"])
        srs, meta = await data.hko("SRS", ttl=86400, endpoint="opendata.php", rformat="json", year=d.year, month=d.month, day=d.day)
        row = dict(zip(srs["fields"], srs["data"][0]))
        out = {"date": d.isoformat(), "sunrise": row["RISE"], "sunset": row["SET"], "source": "HKO sunrise/sunset times", **meta}
        ctx.session.ledger.sunset[d.isoformat()] = row["SET"]
        return ToolOutput(out, summary=f"sunset {row['SET']}")

    @box.register(
        "maps_draw_gpx",
        "Draw a trail's official AFCD track on the user's map canvas (start and finish pins included).",
        obj({"id": {"type": "string"}, "role": {"type": "string", "enum": ["primary", "backup", "rejected"]}}, ["id"]),
    )
    async def maps_draw_gpx(args: dict[str, Any], ctx: ToolContext) -> ToolOutput:
        t = data.trails().get(args["id"])
        coords = data.geometries().get(args["id"])
        if not t or not coords:
            return ToolOutput(f"No track for {args['id']!r}", is_error=True, summary="no track")
        step = max(1, len(coords) // 400)
        pts = coords[::step] + ([coords[-1]] if (len(coords) - 1) % step else [])
        role = args.get("role", "primary")
        await ctx.emit({
            "type": "map", "op": "draw_gpx",
            "payload": {"trail_id": t["id"], "name": t["name"], "role": role, "coords": pts,
                        "markers": [{"kind": "start", "label": t["start"], "coord": pts[0]},
                                    {"kind": "finish", "label": t["finish"], "coord": pts[-1]}]},
        })
        return ToolOutput({"drawn": t["id"], "points": len(pts)}, summary=f"drew {t['name'][:40]}")
