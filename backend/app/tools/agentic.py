"""Conversation-control tools: question cards, skills, and the gated plan / refusal outputs."""

from __future__ import annotations

import re
from typing import Any

from pydantic import ValidationError

from ..paths import SKILLS
from ..schemas import AskUser, Refusal, TripPlan
from . import data
from .base import ToolBox, ToolContext, ToolOutput, obj

GATE_EXEMPT_CODES = {"OUT_OF_SCOPE"}


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
    """Every figure in the plan must match what the tools returned."""
    problems = []
    for pick in [plan.primary] + ([plan.backup] if plan.backup else []):
        t = data.trails().get(pick.id)
        if not t:
            problems.append(f"{pick.id}: unknown trail id")
            continue
        if t["length_km"] is not None and abs(pick.length_km - t["length_km"]) > 0.05:
            problems.append(f"{pick.id}: length_km {pick.length_km} != official {t['length_km']}")
        if t.get("official_hours") is not None and abs(pick.hours - t["official_hours"]) > 0.01:
            problems.append(f"{pick.id}: hours {pick.hours} != official {t['official_hours']}")
    sunset = ctx.session.ledger.sunset.get(plan.date)
    if sunset and plan.sunset != sunset:
        problems.append(f"sunset {plan.sunset} != HKO {sunset}")
    if sunset and plan.finish_time > sunset:
        problems.append(f"finish_time {plan.finish_time} is after sunset {sunset}; refuse with AFTER_DARK or start earlier")
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
        cards = AskUser.model_validate(args).cards
        await ctx.emit({"type": "ask_user", "call_id": ctx.call_id, "cards": [c.model_dump(exclude_none=True) for c in cards]})
        return ToolOutput(None, summary=f"asked {len(cards)} question(s)", pause=True)

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
        "were called for this date, and every figure matches the tool results.",
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
        if problems := number_check(plan, ctx):
            return ToolOutput({"error": "NUMBERS_DO_NOT_MATCH_TOOLS", "problems": problems}, summary="blocked: figures mismatch",
                              is_error=True, blocked=True)
        await ctx.emit({"type": "plan", "plan": plan.model_dump()})
        return ToolOutput("Plan card shown to the user. Add at most two short sentences; do not repeat the card.", summary=plan.primary.name)

    @box.register(
        "refuse",
        "Show a no-go card with evidence. Blocked (except OUT_OF_SCOPE) unless check_closures and get_weather were called "
        "for these trails and date. Include a counterfactual alternative when one exists.",
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
        await ctx.emit({"type": "refusal", "refusal": refusal.model_dump()})
        return ToolOutput("No-go card shown to the user. Add at most two short sentences.", summary=refusal.code)
