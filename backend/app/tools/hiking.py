"""Ground-truth tools. Every number the agent states must come from one of these."""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from typing import Any

from . import data
from .base import ToolBox, ToolContext, ToolOutput, obj

DATE = {"type": "string", "description": "YYYY-MM-DD (Hong Kong date)"}

# HKO warning codes that make an exposed hike a no-go.
NO_GO_WARNINGS = {
    "WTCSGNL": lambda code: not code.startswith(("TC1", "TC3")),  # T8 and above
    "WRAIN": lambda code: True,  # amber / red / black rainstorm
    "WTS": lambda code: True,  # thunderstorm
    "WL": lambda code: True,  # landslip: HKO's advice is to keep away from slopes
    # WHOT (Very Hot Weather) is reported in warnings_in_force but not an automatic no-go:
    # hike-safety decides from duration and shade (EXTREME_HEAT). So are flood, fire and monsoon notices.
}
# How many days past today a warning in force rules out. Rainstorm and thunderstorm warnings are nowcasts
# good for hours, so the forecast decides tomorrow; a typhoon signal lasts, and slopes stay saturated.
NO_GO_REACH_DAYS = {"WTCSGNL": 1, "WL": 1, "WRAIN": 0, "WTS": 0}

# Demo scenario overrides (session.scenario). Clearly labelled in the tool result.
SCENARIO_DAYS = 3  # a storm passes: later dates fall back to the forecast, so a refusal can offer one
SCENARIO_WARNINGS: dict[str, dict[str, dict[str, str]]] = {
    "t8": {"WTCSGNL": {"name": "Tropical Cyclone Warning Signal", "code": "TC8NE", "type": "No. 8 Northeast Gale or Storm Signal"}},
    "rainstorm": {"WRAIN": {"name": "Rainstorm Warning Signal", "code": "WRAINR", "type": "Red"}},
    "thunderstorm": {"WTS": {"name": "Thunderstorm Warning", "code": "WTS"}},
    "clear": {},
}


def _parse_date(s: str) -> date:
    return date.fromisoformat(s)


def _stale_feed(meta: dict[str, Any]) -> bool:
    # Disk fallbacks are useful for display/demo, but cannot certify live safety.
    if meta.get("stale") or meta.get("data_from") == "snapshot":
        return True
    if fetched := meta.get("fetched_at"):
        try:
            age = datetime.now(data.HKT) - datetime.fromisoformat(fetched)
            return not timedelta(0) <= age <= timedelta(hours=1)
        except (ValueError, TypeError):
            return True
    return False  # deterministic test/evaluation fixtures have no fetch timestamp


def _stale_today_forecast(flw: dict[str, Any]) -> bool:
    if updated := flw.get("updateTime"):
        try:
            return datetime.fromisoformat(updated).astimezone(data.HKT).date() != data.today_hk()
        except (ValueError, TypeError):
            return True
    return False


def _elevation(tid: str) -> dict[str, Any] | None:
    """Ascent/height summary from the official GPX (no chart arrays), or None when it has no heights."""
    prof = data.profiles().get(tid)
    return {k: prof[k] for k in ("ascent_m", "descent_m", "max_m", "min_m", "source")} if prof else None


def _brief(t: dict[str, Any]) -> dict[str, Any]:
    prof = data.profiles().get(t["id"]) or {}
    hours, estimated = data.walking_hours(t)
    return {
        "id": t["id"],
        "name": t["name"],
        "region": t["region"],
        "length_km": t["length_km"],
        "hours": hours,
        **({"hours_estimated": True} if estimated else {}),
        "stars": t.get("stars"),
        "difficulty": t["difficulty"],
        "start": t["start"],
        "finish": t["finish"],
        "ascent_m": prof.get("ascent_m"),
        "max_m": prof.get("max_m"),
    }


def _searchable(t: dict[str, Any]) -> str:
    """Names people actually search for: the official ones in both languages, and the landmarks on the way."""
    names = (t["name"], t["trail"], t["start"], t["finish"], t.get("name_zh"), *data.landmarks_zh(t), *data.landmarks(t))
    return " ".join(s for s in names if s).lower()


def _one_line(text: str, limit: int = 80) -> str:
    """The first sentence, cut at a word boundary."""
    first = re.split(r"(?<=[.!?])\s", text.strip(), maxsplit=1)[0].rstrip(".")
    return first if len(first) <= limit else first[:limit].rsplit(" ", 1)[0] + "…"


def _weather_line(text: str, forecast: dict[str, Any]) -> str:
    """The forecast as one line of HKO's own figures, for the plan card."""
    low, high = forecast.get("min_c"), forecast.get("max_c")
    temps = f"{low}–{high}°C" if low is not None and high is not None else f"High {high}°C" if high is not None else ""
    return " · ".join(s for s in (_one_line(text), temps, (forecast.get("wind") or "").rstrip(".")) if s)


def register(box: ToolBox) -> None:
    @box.register(
        "search_trails",
        "Filter the official AFCD trail set (152 sections). Returns brief records sorted by walking time. "
        "Numbers here are official (hiking.gov.hk); quote them, never estimate your own. Where AFCD gives no walking time, "
        "hours is computed from the official length and climb and hours_estimated is true.",
        obj(
            {
                "region": {"type": "string", "description": "One of: Hong Kong Island, Lantau Island, Sai Kung, North New Territories, Central New Territories, West New Territories (substring match, e.g. 'New Territories')"},
                "max_hours": {"type": "number"},
                "min_hours": {"type": "number"},
                "max_stars": {"type": "integer", "minimum": 1, "maximum": 5},
                "min_stars": {"type": "integer", "minimum": 1, "maximum": 5},
                "max_ascent_m": {"type": "number", "description": "Total climb ceiling in metres (from the official GPX). Trails without height data are kept, with ascent_m null"},
                "text": {"type": "string", "description": "A trail name, start, finish or landmark on the way, in English or Chinese, e.g. 'Sharp Peak', 'Lion Rock', '獅子山'"},
                "sort": {"type": "string", "enum": ["longest", "shortest"], "description": "By official hours; default longest first"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 25},
            }
        ),
    )
    async def search_trails(args: dict[str, Any], ctx: ToolContext) -> ToolOutput:
        rows = list(data.trails().values())
        hours = {t["id"]: data.walking_hours(t)[0] for t in rows}
        if r := args.get("region"):
            rows = [t for t in rows if r.lower() in (t["region"] or "").lower()]
        if (h := args.get("max_hours")) is not None:
            rows = [t for t in rows if hours[t["id"]] is not None and hours[t["id"]] <= h]
        if (h := args.get("min_hours")) is not None:
            rows = [t for t in rows if hours[t["id"]] is not None and hours[t["id"]] >= h]
        if (s := args.get("max_stars")) is not None:
            rows = [t for t in rows if t.get("stars") is not None and t["stars"] <= s]
        if (s := args.get("min_stars")) is not None:
            rows = [t for t in rows if t.get("stars") is not None and t["stars"] >= s]
        if (a := args.get("max_ascent_m")) is not None:
            prof = data.profiles()
            rows = [t for t in rows if t["id"] not in prof or prof[t["id"]]["ascent_m"] <= a]
        if q := (args.get("text") or "").lower():
            rows = [t for t in rows if q in _searchable(t)]
        sign = 1 if args.get("sort") == "shortest" else -1
        rows.sort(key=lambda t: (hours[t["id"]] is None, sign * (hours[t["id"]] or 0)))
        out = [_brief(t) for t in rows[: args.get("limit", 12)]]
        return ToolOutput({"count": len(rows), "trails": out, "note": "ascent_m / max_m: total climb and highest point from "
                           "the official GPX; null means no height data (unknown, not flat)."}, summary=f"{len(rows)} trails match")

    @box.register(
        "get_trail",
        "Full official record for one trail: length, official walking time, star ratings, start/finish, "
        "elevation (total ascent and highest point, from the official GPX), the official page URL (cite it) and the Chinese description. "
        "Where official_hours is missing, estimated_hours is computed from the official length and climb.",
        obj({"id": {"type": "string"}}, ["id"]),
    )
    async def get_trail(args: dict[str, Any], ctx: ToolContext) -> ToolOutput:
        t = data.trails().get(args["id"])
        if not t:
            return ToolOutput(f"Unknown trail id {args['id']!r}", is_error=True, summary="unknown trail")
        hours, estimated = data.walking_hours(t)
        return ToolOutput({**t, "elevation": _elevation(t["id"]), **({"estimated_hours": hours} if estimated else {})}, summary=t["name"])

    @box.register(
        "search_knowledge",
        "Semantic search over the official hiking.gov.hk trail descriptions (Chinese; query in English is fine) for scenery "
        "and features: sea views, waterfalls, war relics, shade, villages, birds. Filter with search_trails first and pass "
        "those ids as trail_ids, so it ranks only trails that fit. Returns passages to translate and cite, never figures to quote.",
        obj(
            {
                "query": {"type": "string", "description": "What the user wants to see or avoid, e.g. 'sea views and beaches'"},
                "trail_ids": {"type": "array", "items": {"type": "string"}, "description": "Rank only these trails (from search_trails)"},
                "k": {"type": "integer", "minimum": 1, "maximum": 8, "description": "Passages to return (default 5)"},
            },
            ["query"],
        ),
    )
    async def search_knowledge(args: dict[str, Any], ctx: ToolContext) -> ToolOutput:
        trails = data.trails()
        ids = args.get("trail_ids") or []
        if unknown := [t for t in ids if t not in trails]:
            return ToolOutput(f"Unknown trail ids {unknown}; use ids from search_trails.", is_error=True, summary="unknown trail id")
        chunks = [c for c in data.knowledge() if not ids or c["trail_id"] in ids]
        if not chunks:
            return ToolOutput({"passages": [], "note": "No official description for these trails."}, summary="no descriptions")
        try:
            q = await data.embed_query(args["query"])
        except Exception as e:  # the embedder is optional: planning works without it
            return ToolOutput(f"search_knowledge is unavailable ({type(e).__name__}); read descriptions with get_trail instead.",
                              is_error=True, summary="embedder offline")
        ranked = sorted(chunks, key=lambda c: -sum(a * b for a, b in zip(q, c["vec"])))[: args.get("k", 5)]
        passages = [{"trail_id": c["trail_id"], "name": trails[c["trail_id"]]["name"], "text_zh": c["text"],
                     "score": round(sum(a * b for a, b in zip(q, c["vec"])), 3), "url": trails[c["trail_id"]]["url"]}
                    for c in ranked]
        return ToolOutput({"query": args["query"], "passages": passages, "source": "hiking.gov.hk trail descriptions (zh)",
                           "note": "Translate what you use; cite the url. Don't claim a feature no passage supports."},
                          summary=f"{len(passages)} passages · top {passages[0]['name'][:30]}")

    @box.register(
        "check_closures",
        "Check AFCD's live 'Closed Trails in Country Parks' list for the given trail ids. Required before presenting or refusing a plan.",
        obj({"ids": {"type": "array", "items": {"type": "string"}, "minItems": 1}}, ["ids"]),
    )
    async def check_closures(args: dict[str, Any], ctx: ToolContext) -> ToolOutput:
        # An unknown id would come back "not closed": a false all-clear. Make the model look it up first.
        if unknown := [t for t in args["ids"] if t not in data.trails()]:
            return ToolOutput(f"Unknown trail ids {unknown}. Use the `id` field from search_trails (e.g. search_trails(text=...)), "
                              "like 'hk_8' or 'cty_2'.", is_error=True, summary="unknown trail id")
        rows, meta = await data.closures()
        scenario = ctx.session.scenario
        if scenario == "live" and _stale_feed(meta):
            return ToolOutput({"error": "AFCD closures are stale; current closure status cannot be verified.", **meta},
                              is_error=True, summary="closure data unavailable")
        if scenario.startswith("closure:"):
            forced = scenario.split(":", 1)[1]
            rows = rows + [{"trail_id": forced, "Name_of_Hiking_Trail": data.trails().get(forced, {}).get("name", forced),
                            "Status": "Temporary closed", "Effective_Date": "today", "Expected_Expiry_Date": "Until further notice",
                            "scenario_override": True}]
        result = {}
        led = ctx.session.ledger
        for tid in args["ids"]:
            hits = [r for r in rows if r["trail_id"] == tid]
            # A trail can have several rows; only a "closed" status closes it (a diversion doesn't).
            closure = next((r for r in hits if "clos" in (r.get("Status") or "").lower()), None)
            entry: dict[str, Any] = {"closed": closure is not None}
            if closure:
                entry.update(partial="(partial)" in (closure.get("Name_of_Hiking_Trail") or ""), status=closure.get("Status"),
                             effective=closure.get("Effective_Date"), expected_expiry=closure.get("Expected_Expiry_Date"))
                led.closed.add(tid)
            else:
                led.closed.discard(tid)
            if diversions := [r for r in hits if r is not closure and "divers" in (r.get("Status") or "").lower()]:
                entry["diversion"] = {"status": diversions[0].get("Status"), "effective": diversions[0].get("Effective_Date"),
                                      "expected_expiry": diversions[0].get("Expected_Expiry_Date"),
                                      "note": "Open, but follow the signed diversion"}
            result[tid] = entry
            led.closures_checked.add(tid)
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
            return ToolOutput(f"{d} is in the past; today is {today}. Say so in plain text and ask for a new date; "
                              "don't call present_plan or refuse.", is_error=True, summary="date in the past")
        iso = d.isoformat()
        out: dict[str, Any] = {"date": iso, "source": "Hong Kong Observatory Open Data"}
        led = ctx.session.ledger
        scenario = ctx.session.scenario
        if d > today + timedelta(days=9):
            # Not an error: the check was made; there is simply no official forecast yet.
            led.weather_dates.add(iso)
            led.no_go[iso], led.warnings[iso] = [], []
            out.update(forecast=None, warnings_in_force={}, no_go_warnings=[],
                       note=f"Beyond the HKO 9-day window (ends {today + timedelta(days=9)}). Plan provisionally and tell the user to re-check nearer the date.")
            return ToolOutput(out, summary="beyond 9-day forecast")
        if d == today:
            flw, meta = await data.hko("flw")
            if not _stale_feed(meta) and not _stale_today_forecast(flw):
                out["forecast"] = {"desc": flw.get("forecastDesc"), "outlook": flw.get("outlook"), "update_time": flw.get("updateTime")}
            else:
                out["stale"] = True
        else:
            fnd, meta = await data.hko("fnd")
            day = next((f for f in fnd.get("weatherForecast", []) if f.get("forecastDate") == d.strftime("%Y%m%d")), None)
            if day and not _stale_feed(meta):
                out["forecast"] = {
                    "weather": day.get("forecastWeather"),
                    "wind": day.get("forecastWind"),
                    "max_c": (day.get("forecastMaxtemp") or {}).get("value"),
                    "min_c": (day.get("forecastMintemp") or {}).get("value"),
                    "rain_probability": day.get("PSR"),
                }
            out["update_time"] = fnd.get("updateTime")
            if _stale_feed(meta):
                out["stale"] = True

        in_force = {}
        if scenario in SCENARIO_WARNINGS:
            # A demo scenario simulates the warning on the days the hike could be: the storm passes after that.
            warnings = SCENARIO_WARNINGS[scenario] if d <= today + timedelta(days=SCENARIO_DAYS) else {}
            applies, in_force = True, warnings
            out["note"] = f"Demo scenario override active: {scenario}. The app labels it; don't mention it in your reply."
            out["warnings_apply_to"] = f"{today} to {today + timedelta(days=SCENARIO_DAYS)}"
        else:
            warnsum, warning_meta = await data.hko("warnsum", ttl=120)
            if _stale_feed(warning_meta):
                return ToolOutput({"error": "HKO warnings are stale; current warnings cannot be verified.",
                                   "date": iso, "stale": True}, is_error=True, summary="warnings unavailable")
            warnings = {k: {"name": v.get("name"), "code": v.get("code"), "type": v.get("type"),
                            **({"issued": v["issueTime"]} if v.get("issueTime") else {})}
                        for k, v in (warnsum or {}).items() if v.get("actionCode") != "CANCEL"}
            applies = d <= today + timedelta(days=1)
            in_force = {k: w for k, w in warnings.items() if k in NO_GO_REACH_DAYS and d <= today + timedelta(days=NO_GO_REACH_DAYS[k])}
            out["warnings_apply_to"] = ("now (HKO issues warnings in real time: typhoon signals and landslip warnings "
                                        "cover today and tomorrow, rainstorm and thunderstorm warnings today only)")
        out["warnings_in_force"] = warnings
        out["no_go_warnings"] = [w["code"] for k, w in in_force.items() if k in NO_GO_WARNINGS and NO_GO_WARNINGS[k](w.get("code") or "")]

        forecast: dict[str, Any] = out.get("forecast") or {}
        text = forecast.get("weather") or forecast.get("desc")
        if not text and scenario == "clear":  # the offline demo: the frozen seed has no forecast for today's dates
            text = "Fine (demo override: no live forecast)"
            forecast = out["forecast"] = {"weather": text}
        if not text and not out["no_go_warnings"]:
            # Inside the 9-day window with nothing for this date (feed down, only an old seed): nothing was
            # checked, so it must not read as checked. The gate stays shut until a real forecast comes back.
            out["error"] = "HKO has no forecast for this date right now. Tell the user the weather can't be checked; don't present a plan."
            return ToolOutput(out, summary="forecast unavailable", is_error=True)

        led.weather_dates.add(iso)
        led.no_go[iso] = out["no_go_warnings"]
        led.warnings[iso] = [w.get("code") or k for k, w in warnings.items()] if applies else []
        # Not the outlook: on today's forecast that is about the days after.
        led.forecast[iso] = str(text or "")
        led.weather_line[iso] = _weather_line(text, forecast) if text else ""
        if isinstance(forecast.get("max_c"), (int, float)):
            led.max_c[iso] = forecast["max_c"]
        summary = _one_line(text) if text else "forecast"
        if out["no_go_warnings"]:
            summary = f"WARNING {', '.join(out['no_go_warnings'])}"
        elif (warnings and not applies) or any(k in NO_GO_REACH_DAYS and k not in in_force for k in warnings):
            summary = f"{summary} (warnings now, not on {iso})"
        return ToolOutput(out, summary=summary)

    @box.register(
        "get_daylight",
        "Official HKO sunrise and sunset for a date. Use the sunset to check the hike finishes in daylight.",
        obj({"date": DATE}, ["date"]),
    )
    async def get_daylight(args: dict[str, Any], ctx: ToolContext) -> ToolOutput:
        d = _parse_date(args["date"])
        # The whole year in one request: one cache entry, one committed snapshot per year for offline use.
        srs, meta = await data.hko("SRS", ttl=86400, endpoint="opendata.php", rformat="json", year=d.year)
        rows = [dict(zip(srs["fields"], r)) for r in srs.get("data", [])]
        row = next((r for r in rows if r.get("YYYY-MM-DD") == d.isoformat()), None)
        if row is None:
            return ToolOutput(f"HKO has no sunrise/sunset row for {d}", is_error=True, summary="no daylight data")
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
        segments = data.geometries().get(args["id"])
        if not t or not segments:
            return ToolOutput(f"No track for {args['id']!r}", is_error=True, summary="no track")
        step = max(1, sum(map(len, segments)) // 400)
        # Downsample each segment on its own, keeping its endpoints, so no line is drawn across a gap.
        segs = [seg[::step] + ([seg[-1]] if (len(seg) - 1) % step else []) for seg in segments]
        role = args.get("role", "primary")
        await ctx.emit({
            "type": "map", "op": "draw_gpx",
            "payload": {"trail_id": t["id"], "name": t["name"], "role": role, "segments": segs, "profile": data.profiles().get(t["id"]),
                        "markers": [{"kind": "start", "label": t["start"], "coord": segs[0][0]},
                                    {"kind": "finish", "label": t["finish"], "coord": segs[-1][-1]}]},
        })
        return ToolOutput({"drawn": t["id"], "points": sum(map(len, segs))}, summary=f"drew {t['name'][:40]}")
