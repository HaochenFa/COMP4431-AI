"""Conversation-control tools: question cards, skills, and the gated plan / refusal outputs."""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any

from pydantic import ValidationError

from ..paths import SKILLS
from ..schemas import AskUser, Refusal, TripPlan
from . import data
from .base import ToolBox, ToolContext, ToolOutput, obj

GATE_EXEMPT_CODES = {"OUT_OF_SCOPE"}
# Codes about specific trails: the refusal must name them.
TRAIL_CODES = {"CLOSED", "EXCEEDS_ABILITY", "AFTER_DARK", "INSUFFICIENT_TIME", "EXTREME_HEAT"}
SUNSET_BUFFER_MIN = 30  # hike-safety: finish at least 30 minutes before sunset
VERY_HOT_C = 33  # HKO's Very Hot Weather Warning threshold, for dates beyond the warnings' reach
# HKO says it several ways: "heavy rain", "heavy squally showers", "showers will be heavy at times".
HEAVY_RAIN = re.compile(r"rainstorm|torrential|heavy\s+(?:\w+\s+){0,2}(?:rain|showers?|downpours?)|\b(?:rain|showers?)\b[^.;]{0,30}\bheavy", re.I)
# There is no transport data, so a route number can only be invented.
ROUTE_NUMBER = re.compile(r"\b(?:bus(?:es)?|minibus|route|ferry)\s+(?:no\.?\s*|number\s+)?\d+[a-z]?\b|\b\d+[a-z]?\s+(?:bus|minibus)\b", re.I)
_ESCAPED = re.compile(r"\\u([0-9a-fA-F]{4})")


def _minutes(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def _hhmm(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def _clean(value: Any) -> Any:
    """Some models double-escape non-ASCII, which would show as a literal \\u2013 on the card."""
    if isinstance(value, str):
        return _ESCAPED.sub(lambda m: chr(int(m[1], 16)), value)
    if isinstance(value, list):
        return [_clean(v) for v in value]
    if isinstance(value, dict):
        return {k: _clean(v) for k, v in value.items()}
    return value


def _demo(ctx: ToolContext) -> dict[str, str]:
    """Marks a card made under a demo scenario, so the app can label it wherever it is shown."""
    return {"scenario": ctx.session.scenario} if ctx.session.scenario != "live" else {}


def skill_index() -> dict[str, str]:
    """name -> one-line description (from each skill's `description:` front matter)."""
    out = {}
    for p in sorted(SKILLS.glob("*.md")):
        m = re.search(r"^description:\s*(.+)$", p.read_text(), re.M)
        out[p.stem] = m.group(1).strip() if m else ""
    return out


def gate(ctx: ToolContext, date: str, trail_ids: list[str], need_daylight: bool) -> list[str]:
    """Return the calls still missing before this plan/refusal may be shown."""
    led = ctx.session.ledger
    missing = []
    unchecked = [t for t in trail_ids if t not in led.closures_checked]
    if unchecked:
        missing.append(f"check_closures(ids={unchecked})")
    if date not in led.weather_dates:
        missing.append(f"get_weather(date={date!r})")
    if need_daylight and date not in led.sunset:
        missing.append(f"get_daylight(date={date!r})")
    return missing


def number_check(plan: TripPlan, ctx: ToolContext) -> list[str]:
    """Every figure in the plan must match what the tools returned, and the timing must add up."""
    problems = []
    for pick in [plan.primary] + ([plan.backup] if plan.backup else []):
        t = data.trails().get(pick.id)
        if not t:
            problems.append(f"{pick.id}: unknown trail id")
            continue
        if t["length_km"] is None:
            problems.append(f"{pick.id}: no official length; choose another trail")
        elif abs(pick.length_km - t["length_km"]) > 0.05:
            problems.append(f"{pick.id}: length_km {pick.length_km} != official {t['length_km']}")
        hours, estimated = data.walking_hours(t)
        if hours is not None and abs(pick.hours - hours) > 0.01:
            problems.append(f"{pick.id}: hours {pick.hours} != {'estimated' if estimated else 'official'} {hours}")
        if pick.stars != t.get("stars"):
            problems.append(f"{pick.id}: stars {pick.stars} != official {t.get('stars')} (use null when there is no official rating)")

    steps = [(_minutes(s.start), _minutes(s.end)) for s in plan.timeline]
    if any(end < start for start, end in steps) or any(b[0] < a[1] for a, b in zip(steps, steps[1:])):
        problems.append("timeline steps must be in order, each ending before the next starts")
    finish = _minutes(plan.finish_time)
    hours, _ = data.walking_hours(data.trails().get(plan.primary.id, {}))
    hike = [(start, end) for start, end in steps if end == finish]
    if not hike:
        problems.append(f"finish_time {plan.finish_time} must be the end of the hike step in the timeline")
    elif hours is not None and hike[0][1] - hike[0][0] < round(hours * 60):
        start = hike[0][0]
        problems.append(f"the hike step ({_hhmm(start)}-{plan.finish_time}) is shorter than the {hours} h walking time; "
                        f"starting {_hhmm(start)} it finishes {_hhmm(start + round(hours * 60))}")
    if plan.date == data.today_hk().isoformat() and steps:
        now = datetime.now(data.HKT)
        if steps[0][0] < now.hour * 60 + now.minute - 5:
            problems.append(f"the timeline starts at {plan.timeline[0].start}, but it is already {now:%H:%M}")

    sunset = ctx.session.ledger.sunset.get(plan.date)
    if sunset and plan.sunset != sunset:
        problems.append(f"sunset {plan.sunset} != HKO {sunset}")
    if sunset and finish > _minutes(sunset) - SUNSET_BUFFER_MIN:
        problems.append(f"finish_time {plan.finish_time} is less than {SUNSET_BUFFER_MIN} min before sunset {sunset}; "
                        f"finish by {_hhmm(_minutes(sunset) - SUNSET_BUFFER_MIN)} or refuse with AFTER_DARK")
    if named := [m[0] for text in [plan.why_this, *(s.label for s in plan.timeline)] for m in ROUTE_NUMBER.finditer(text)]:
        problems.append(f"{named} names a transport route, but no tool returned one: say 'Travel to <start> (approx.)' instead")
    return problems


def sources(plan: TripPlan, ctx: ToolContext) -> list[dict[str, str]]:
    """The official sources behind a plan's figures, from what the tools returned, so none goes out uncited."""
    led, d = ctx.session.ledger, plan.date
    out = []
    for pick in [plan.primary] + ([plan.backup] if plan.backup else []):
        t = data.trails()[pick.id]
        hours, estimated = data.walking_hours(t)
        out.append({"source": f"AFCD: {t['name']}", "ref": t.get("url") or "get_trail",
                    "quote": f"{t['length_km']} km, {hours} h{' (estimated from length and climb)' if estimated else ''}"})
    out.append({"source": "HKO forecast", "ref": "get_weather", "quote": led.forecast.get(d) or "No forecast yet for this date"})
    out.append({"source": "HKO sunrise/sunset", "ref": "get_daylight", "quote": f"Sunset {led.sunset[d]}"})
    out.append({"source": "AFCD closed trails", "ref": "check_closures", "quote": "Not on the closed list"})
    return out


def safety_check(plan: TripPlan, ctx: ToolContext) -> list[str]:
    """The hike-safety rules that need no judgement, enforced in code: a plan can't go ahead on a day with a
    no-go warning, on a closed trail, or into a heavy-rain forecast. (Thunderstorm exposure, heat and ability
    are judgement calls left to the model and the hike-safety skill.)"""
    led, d = ctx.session.ledger, plan.date
    problems = []
    for code in led.no_go.get(d, []):
        refusal = ("WARNING_T8" if code.startswith("TC") else "RAINSTORM" if code.startswith("WRAIN")
                   else "LANDSLIP" if code == "WL" else "THUNDERSTORM")
        problems.append(f"get_weather lists the no-go warning {code} for {d}: call refuse with code {refusal} instead")
    ids = [plan.primary.id] + ([plan.backup.id] if plan.backup else [])
    if closed := [t for t in ids if t in led.closed]:
        problems.append(f"check_closures reported {closed} closed: choose another trail, or refuse with code CLOSED")
    if HEAVY_RAIN.search(led.forecast.get(d, "")):
        problems.append(f"the HKO forecast for {d} says heavy rain: refuse with code RAINSTORM, or plan another date")
    return problems


def evidence_check(refusal: Refusal, ctx: ToolContext) -> list[str]:
    """The refusal code must be backed by what the tools actually returned."""
    led, code, d = ctx.session.ledger, refusal.code, refusal.date
    no_go, warnings, forecast = led.no_go.get(d, []), led.warnings.get(d, []), led.forecast.get(d, "").lower()
    trails = data.trails()
    if unknown := [t for t in refusal.trail_ids if t not in trails]:
        return [f"unknown trail ids {unknown}"]
    if code in TRAIL_CODES and not refusal.trail_ids:
        return [f"{code} is about specific trails: list them in trail_ids"]
    problems = []
    if code == "CLOSED" and (open_ := [t for t in refusal.trail_ids if t not in led.closed]):
        problems.append(f"check_closures did not report {open_} as closed")
    elif code == "WARNING_T8" and not any(w.startswith("TC") for w in no_go):
        problems.append(f"get_weather reported no Signal No. 8 or above for {d}")
    elif code == "RAINSTORM" and not any(w.startswith("WRAIN") for w in no_go) and not HEAVY_RAIN.search(forecast):
        problems.append(f"get_weather reported no rainstorm warning or heavy-rain forecast for {d}")
    elif code == "THUNDERSTORM" and "WTS" not in no_go and "thunderstorm" not in forecast:
        problems.append(f"get_weather reported no thunderstorm warning or forecast for {d}")
    elif code == "LANDSLIP" and "WL" not in no_go:
        problems.append(f"get_weather reported no Landslip Warning for {d}")
    elif code == "EXTREME_HEAT" and "WHOT" not in warnings and led.max_c.get(d, 0) < VERY_HOT_C:
        problems.append(f"get_weather reported no Very Hot Weather Warning or forecast of {VERY_HOT_C}°C+ for {d}")
    elif code == "EXCEEDS_ABILITY" and (unrated := [t for t in refusal.trail_ids if trails[t].get("stars") is None]):
        problems.append(f"{unrated} have no official star rating to compare with the user's level")
    elif code == "INSUFFICIENT_TIME" and (untimed := [t for t in refusal.trail_ids if data.walking_hours(trails[t])[0] is None]):
        problems.append(f"{untimed} have no walking time")
    return problems


def _blocked(missing: list[str], what: str) -> ToolOutput:
    return ToolOutput(
        {"error": "PRECONDITION_FAILED", "message": f"{what} blocked: call these first, then try again.", "missing": missing},
        summary="blocked: " + "; ".join(missing), is_error=True, blocked=True,
    )


def register(box: ToolBox) -> None:
    @box.register(
        "ask_user",
        "Pause and show the user 1-3 question cards when a decision you need is missing (fitness, date, start area...). "
        "Use 'single' or 'multi' with 2-5 short options where possible, 'text' otherwise. The answers come back as this tool's result.",
        AskUser,
    )
    async def ask_user(args: dict[str, Any], ctx: ToolContext) -> ToolOutput:
        cards = [c.model_dump(exclude_none=True) for c in AskUser.model_validate(args).cards]
        await ctx.emit({"type": "ask_user", "call_id": ctx.call_id, "cards": cards})
        # While paused, content holds the cards so the harness can re-send them after a reconnect.
        return ToolOutput(cards, summary=f"asked {len(cards)} question(s)", pause=True)

    @box.register(
        "load_skill",
        "Load a skill (a step-by-step procedure) into context. Available: "
        + "; ".join(f"{k}: {v}" for k, v in skill_index().items()),
        obj({"name": {"type": "string", "enum": list(skill_index())}}, ["name"]),
    )
    async def load_skill(args: dict[str, Any], ctx: ToolContext) -> ToolOutput:
        name = args["name"]
        ctx.session.loaded_skills.add(name)
        return ToolOutput((SKILLS / f"{name}.md").read_text(), summary=name)

    @box.register(
        "present_plan",
        "Show the final day plan card. Blocked unless check_closures (for every trail in it), get_weather and get_daylight "
        "were called for this date, no trail is closed, get_weather lists no no-go warning or heavy rain for the date, every figure (km, hours, stars, sunset) matches the tool results, finish_time is the end "
        "of a timeline hike step at least the walking hours long, and it is 30+ minutes before sunset. Make this one call, with date, primary, timeline, "
        "finish_time, sunset and why_this always filled in. The server adds the weather line and the official sources.",
        TripPlan,
    )
    async def present_plan(args: dict[str, Any], ctx: ToolContext) -> ToolOutput:
        try:
            plan = TripPlan.model_validate(args)
        except ValidationError as e:
            return ToolOutput(f"Invalid plan: {e}", is_error=True, summary="invalid plan")
        ids = [plan.primary.id] + ([plan.backup.id] if plan.backup else [])
        if missing := gate(ctx, plan.date, ids, need_daylight=True):
            return _blocked(missing, "present_plan")
        if problems := safety_check(plan, ctx):
            return ToolOutput({"error": "UNSAFE_PLAN", "problems": problems}, summary="blocked: unsafe", is_error=True, blocked=True)
        if problems := number_check(plan, ctx):
            return ToolOutput({"error": "NUMBERS_DO_NOT_MATCH_TOOLS", "problems": problems}, summary="blocked: figures mismatch",
                              is_error=True, blocked=True)
        card = _clean(plan.model_dump())
        for key, pick in (("primary", plan.primary), ("backup", plan.backup)):
            if pick:  # names and the start point come from the dataset, not the model
                t, segs = data.trails()[pick.id], data.geometries().get(pick.id)
                card[key].update(name=t["name"], start=t["start"], start_coord=segs[0][0] if segs else None,
                                 profile=data.profiles().get(pick.id), hours_estimated=data.walking_hours(t)[1])
        led = ctx.session.ledger
        provisional = not led.forecast.get(plan.date)  # beyond the 9-day forecast: a go only until HKO says otherwise
        # Weather and sources come from the tool results, so no unchecked figure reaches the card.
        card.update(provisional=provisional, weather_summary=led.weather_line.get(plan.date) or "No HKO forecast yet for this date", **_demo(ctx))
        card["citations"] = sources(plan, ctx) + [c for c in card["citations"] if c["ref"].startswith("http")]
        await ctx.emit({"type": "plan", "plan": card})
        tail = " Say that the weather must be re-checked nearer the date." if provisional else ""
        return ToolOutput(f"Plan card shown to the user. Add at most two short sentences; do not repeat the card.{tail}", summary=plan.primary.name)

    @box.register(
        "refuse",
        "Show a no-go card with evidence. Blocked (except OUT_OF_SCOPE) unless check_closures and get_weather were called "
        "for these trails and date, and the tool results back the code (e.g. CLOSED needs check_closures to report the trail "
        "closed). Trail-specific codes must list the trails. OUT_OF_SCOPE is only for requests that aren't about a Hong Kong hike, "
        "so it can't name trails. Include a counterfactual alternative when one exists.",
        Refusal,
    )
    async def refuse(args: dict[str, Any], ctx: ToolContext) -> ToolOutput:
        try:
            refusal = Refusal.model_validate(args)
        except ValidationError as e:
            return ToolOutput(f"Invalid refusal: {e}", is_error=True, summary="invalid refusal")
        if refusal.code in GATE_EXEMPT_CODES:
            if refusal.trail_ids:  # a real trip with a trail in it can't dodge the gate this way
                return ToolOutput({"error": "REFUSAL_NOT_SUPPORTED_BY_TOOLS",
                                   "problems": [f"OUT_OF_SCOPE can't name trails ({refusal.trail_ids}): this is a hike, so check it, or answer in plain text"]},
                                  summary="blocked: hike marked out of scope", is_error=True, blocked=True)
        else:
            if missing := gate(ctx, refusal.date, refusal.trail_ids, need_daylight=refusal.code == "AFTER_DARK"):
                return _blocked(missing, "refuse")
            if problems := evidence_check(refusal, ctx):
                return ToolOutput({"error": "REFUSAL_NOT_SUPPORTED_BY_TOOLS", "problems": problems},
                                  summary="blocked: no evidence for " + refusal.code, is_error=True, blocked=True)
        await ctx.emit({"type": "refusal", "refusal": {**_clean(refusal.model_dump()), **_demo(ctx)}})
        return ToolOutput("No-go card shown to the user. Add at most two short sentences.", summary=refusal.code)
