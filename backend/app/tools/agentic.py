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


def _minutes(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def _hhmm(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


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
        if t.get("official_hours") is None:
            problems.append(f"{pick.id}: no official walking time; choose another trail")
        elif abs(pick.hours - t["official_hours"]) > 0.01:
            problems.append(f"{pick.id}: hours {pick.hours} != official {t['official_hours']}")
        if pick.stars != t.get("stars"):
            problems.append(f"{pick.id}: stars {pick.stars} != official {t.get('stars')} (use null when there is no official rating)")

    steps = [(_minutes(s.start), _minutes(s.end)) for s in plan.timeline]
    if any(end < start for start, end in steps) or any(b[0] < a[1] for a, b in zip(steps, steps[1:])):
        problems.append("timeline steps must be in order, each ending before the next starts")
    finish = _minutes(plan.finish_time)
    hours = data.trails().get(plan.primary.id, {}).get("official_hours")
    hike = [(start, end) for start, end in steps if end == finish]
    if not hike:
        problems.append(f"finish_time {plan.finish_time} must be the end of the hike step in the timeline")
    elif hours is not None and hike[0][1] - hike[0][0] < round(hours * 60):
        start = hike[0][0]
        problems.append(f"the hike step ({_hhmm(start)}-{plan.finish_time}) is shorter than the official {hours} h; "
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
    return problems


def safety_check(plan: TripPlan, ctx: ToolContext) -> list[str]:
    """The hike-safety rules that need no judgement, enforced in code: a plan can't go ahead on a day with a
    no-go warning, on a closed trail, or into a heavy-rain forecast. (Thunderstorm exposure, heat and ability
    are judgement calls left to the model and the hike-safety skill.)"""
    led, d = ctx.session.ledger, plan.date
    problems = []
    for code in led.no_go.get(d, []):
        refusal = "WARNING_T8" if code.startswith("TC") else "RAINSTORM" if code.startswith("WRAIN") else "THUNDERSTORM"
        problems.append(f"get_weather lists the no-go warning {code} for {d}: call refuse with code {refusal} instead")
    ids = [plan.primary.id] + ([plan.backup.id] if plan.backup else [])
    if closed := [t for t in ids if t in led.closed]:
        problems.append(f"check_closures reported {closed} closed: choose another trail, or refuse with code CLOSED")
    if re.search(r"heavy rain|rainstorm", led.forecast.get(d, ""), re.I):
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
    elif code == "RAINSTORM" and not any(w.startswith("WRAIN") for w in no_go) and not re.search(r"heavy rain|rainstorm", forecast):
        problems.append(f"get_weather reported no rainstorm warning or heavy-rain forecast for {d}")
    elif code == "THUNDERSTORM" and "WTS" not in no_go and "thunderstorm" not in forecast:
        problems.append(f"get_weather reported no thunderstorm warning or forecast for {d}")
    elif code == "EXTREME_HEAT" and "WHOT" not in warnings and led.max_c.get(d, 0) < VERY_HOT_C:
        problems.append(f"get_weather reported no Very Hot Weather Warning or forecast of {VERY_HOT_C}°C+ for {d}")
    elif code == "EXCEEDS_ABILITY" and (unrated := [t for t in refusal.trail_ids if trails[t].get("stars") is None]):
        problems.append(f"{unrated} have no official star rating to compare with the user's level")
    elif code == "INSUFFICIENT_TIME" and (untimed := [t for t in refusal.trail_ids if trails[t].get("official_hours") is None]):
        problems.append(f"{untimed} have no official walking time")
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
        "of a timeline hike step at least the official hours long, and it is 30+ minutes before sunset.",
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
        card = plan.model_dump()
        for key, pick in (("primary", plan.primary), ("backup", plan.backup)):
            if pick:  # names and the start point come from the dataset, not the model
                t, segs = data.trails()[pick.id], data.geometries().get(pick.id)
                card[key].update(name=t["name"], start=t["start"], start_coord=segs[0][0] if segs else None,
                                 profile=data.profiles().get(pick.id))
        await ctx.emit({"type": "plan", "plan": card})
        return ToolOutput("Plan card shown to the user. Add at most two short sentences; do not repeat the card.", summary=plan.primary.name)

    @box.register(
        "refuse",
        "Show a no-go card with evidence. Blocked (except OUT_OF_SCOPE) unless check_closures and get_weather were called "
        "for these trails and date, and the tool results back the code (e.g. CLOSED needs check_closures to report the trail "
        "closed). Trail-specific codes must list the trails. Include a counterfactual alternative when one exists.",
        Refusal,
    )
    async def refuse(args: dict[str, Any], ctx: ToolContext) -> ToolOutput:
        try:
            refusal = Refusal.model_validate(args)
        except ValidationError as e:
            return ToolOutput(f"Invalid refusal: {e}", is_error=True, summary="invalid refusal")
        if refusal.code not in GATE_EXEMPT_CODES:
            if missing := gate(ctx, refusal.date, refusal.trail_ids, need_daylight=refusal.code == "AFTER_DARK"):
                return _blocked(missing, "refuse")
            if problems := evidence_check(refusal, ctx):
                return ToolOutput({"error": "REFUSAL_NOT_SUPPORTED_BY_TOOLS", "problems": problems},
                                  summary="blocked: no evidence for " + refusal.code, is_error=True, blocked=True)
        await ctx.emit({"type": "refusal", "refusal": refusal.model_dump()})
        return ToolOutput("No-go card shown to the user. Add at most two short sentences.", summary=refusal.code)
