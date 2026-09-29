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


def _elevation(tid: str) -> dict[str, Any] | None:
    """Ascent/height summary from the official GPX (no chart arrays), or None when it has no heights."""
    prof = data.profiles().get(tid)
    return {k: prof[k] for k in ("ascent_m", "descent_m", "max_m", "min_m", "source")} if prof else None


def _brief(t: dict[str, Any]) -> dict[str, Any]:
    prof = data.profiles().get(t["id"]) or {}
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
        "ascent_m": prof.get("ascent_m"),
        "max_m": prof.get("max_m"),
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
                "max_ascent_m": {"type": "number", "description": "Total climb ceiling in metres (from the official GPX). Trails without height data are kept, with ascent_m null"},
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
        if (a := args.get("max_ascent_m")) is not None:
            prof = data.profiles()
            rows = [t for t in rows if t["id"] not in prof or prof[t["id"]]["ascent_m"] <= a]
        if q := (args.get("text") or "").lower():
            rows = [t for t in rows if q in f'{t["name"]} {t["start"]} {t["finish"]}'.lower()]
        sign = 1 if args.get("sort") == "shortest" else -1
        rows.sort(key=lambda t: (t.get("official_hours") is None, sign * (t.get("official_hours") or 0)))
        out = [_brief(t) for t in rows[: args.get("limit", 12)]]
        return ToolOutput({"count": len(rows), "trails": out, "note": "ascent_m / max_m: total climb and highest point from "
                           "the official GPX; null means no height data (unknown, not flat)."}, summary=f"{len(rows)} trails match")

    @box.register(
        "get_trail",
        "Full official record for one trail: length, official walking time, star ratings, start/finish, "
        "elevation (total ascent and highest point, from the official GPX), the official page URL (cite it) and the Chinese description.",
        obj({"id": {"type": "string"}}, ["id"]),
    )
    async def get_trail(args: dict[str, Any], ctx: ToolContext) -> ToolOutput:
        t = data.trails().get(args["id"])
        if not t:
            return ToolOutput(f"Unknown trail id {args['id']!r}", is_error=True, summary="unknown trail")
        return ToolOutput({**t, "elevation": _elevation(t["id"])}, summary=t["name"])

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
            return ToolOutput(f"{d} is in the past; today is {today}", is_error=True, summary="date in the past")
        out: dict[str, Any] = {"date": d.isoformat(), "source": "Hong Kong Observatory Open Data"}
        led = ctx.session.ledger
        scenario = ctx.session.scenario
        if d > today + timedelta(days=9) and scenario not in SCENARIO_WARNINGS:
            # Not an error: the check was made; there is simply no official forecast yet.
            led.weather_dates.add(d.isoformat())
            led.no_go[d.isoformat()], led.warnings[d.isoformat()] = [], []
            out.update(forecast=None, warnings_in_force={}, no_go_warnings=[],
                       note=f"Beyond the HKO 9-day window (ends {today + timedelta(days=9)}). Plan provisionally and tell the user to re-check nearer the date.")
            return ToolOutput(out, summary="beyond 9-day forecast")
        if d > today + timedelta(days=9):
            out["forecast"] = None
        elif d == today:
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

        if scenario in SCENARIO_WARNINGS:
            warnings = SCENARIO_WARNINGS[scenario]
            applies = True  # a demo scenario simulates the warning on the requested date
            out["note"] = f"Demo scenario override active: {scenario}. These warnings apply to {d.isoformat()}."
            out["warnings_apply_to"] = d.isoformat()
        else:
            warnsum, _ = await data.hko("warnsum", ttl=120)
            warnings = {k: {"name": v.get("name"), "code": v.get("code"), "type": v.get("type"),
                            **({"issued": v["issueTime"]} if v.get("issueTime") else {})}
                        for k, v in (warnsum or {}).items() if v.get("actionCode") != "CANCEL"}
            applies = d <= today + timedelta(days=1)
            out["warnings_apply_to"] = "now (HKO issues warnings in real time; they apply to today and the next morning only)"
        out["warnings_in_force"] = warnings
        no_go = [w["code"] for k, w in warnings.items() if k in NO_GO_WARNINGS and NO_GO_WARNINGS[k](w.get("code") or "")]
        out["no_go_warnings"] = no_go if applies else []
        forecast = out.get("forecast") or {}
        led.weather_dates.add(d.isoformat())
        led.no_go[d.isoformat()] = out["no_go_warnings"]
        led.warnings[d.isoformat()] = [w.get("code") or k for k, w in warnings.items()] if applies else []
        led.forecast[d.isoformat()] = " ".join(str(forecast.get(k) or "") for k in ("weather", "desc", "outlook"))
        if isinstance(forecast.get("max_c"), (int, float)):
            led.max_c[d.isoformat()] = forecast["max_c"]
        summary = forecast.get("weather") or forecast.get("desc") or "forecast"
        if out["no_go_warnings"]:
            summary = f"WARNING {', '.join(out['no_go_warnings'])}"
        elif warnings and not applies:
            summary = f"{summary} (warnings now, not on {d.isoformat()})"
        return ToolOutput(out, summary=str(summary)[:80])

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
