"""Wire contract shared with the mobile app (mirrored in mobile/lib/types.ts).

TripPlan / Refusal double as the JSON Schemas of the present_plan / refuse tools.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

HHMM = r"^([01]\d|2[0-3]):[0-5]\d$"  # zero-padded, so string comparison orders times correctly


class Citation(BaseModel):
    source: str = Field(description="Where the fact came from, e.g. 'AFCD hiking.gov.hk', 'HKO 9-day forecast'")
    ref: str = Field(description="URL, or the tool name that returned it, e.g. 'get_weather'")
    quote: str = Field(description="The exact figure or sentence relied on")


class TrailPick(BaseModel):
    id: str
    name: str
    length_km: float
    hours: float = Field(description="Official walking time from get_trail / search_trails")
    stars: int | None = Field(default=None, ge=1, le=5, description="Official overall rating; null when the data has none")


class WhyNot(BaseModel):
    trail_id: str
    reason: str


class TimelineStep(BaseModel):
    label: str = Field(description="e.g. 'MTR to Shau Kei Wan + bus 9', 'Hike', 'Bus back'")
    start: str = Field(description="HH:MM", pattern=HHMM)
    end: str = Field(description="HH:MM", pattern=HHMM)


class TripPlan(BaseModel):
    decision: Literal["go"] = "go"
    date: str = Field(description="YYYY-MM-DD")
    primary: TrailPick
    backup: TrailPick | None = None
    why_this: str
    why_not: list[WhyNot] = []
    timeline: list[TimelineStep] = Field(min_length=1)
    finish_time: str = Field(description="HH:MM end of the hike step in the timeline (hike start + official hours)", pattern=HHMM)
    sunset: str = Field(description="HH:MM from get_daylight", pattern=HHMM)
    weather_summary: str
    citations: list[Citation]


RefusalCode = Literal[
    "CLOSED", "WARNING_T8", "RAINSTORM", "THUNDERSTORM", "EXTREME_HEAT", "EXCEEDS_ABILITY", "AFTER_DARK", "INSUFFICIENT_TIME", "OUT_OF_SCOPE"
]


class Refusal(BaseModel):
    decision: Literal["no_go"] = "no_go"
    date: str = Field(description="YYYY-MM-DD")
    trail_ids: list[str] = Field(description="The trail(s) being refused")
    code: RefusalCode
    summary: str
    evidence: list[Citation]
    counterfactual: str | None = Field(default=None, description="A safer alternative trail or date, if one exists")


class QuestionCard(BaseModel):
    id: str
    type: Literal["single", "multi", "text"]
    prompt: str
    options: list[str] | None = None


class AskUser(BaseModel):
    cards: list[QuestionCard] = Field(min_length=1, max_length=3)
