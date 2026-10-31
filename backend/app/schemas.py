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
    hours: float = Field(description="Walking time from search_trails / get_trail, copied exactly")
    stars: int | None = Field(default=None, ge=1, le=5, description="Official overall rating; null when the data has none")


class WhyNot(BaseModel):
    trail_id: str
    reason: str


class TimelineStep(BaseModel):
    label: str = Field(description="e.g. 'Travel to To Tei Wan (approx.)', 'Hike', 'Travel home (approx.)'. No route numbers: there is no transport data")
    start: str = Field(description="HH:MM", pattern=HHMM)
    end: str = Field(description="HH:MM", pattern=HHMM)


class TripPlan(BaseModel):
    # Required fields first, in this order: some models stop mid-object after why_not, and everything
    # after the required ones can be left out. The server fills the weather and the official sources in.
    decision: Literal["go"] = "go"
    date: str = Field(description="YYYY-MM-DD")
    primary: TrailPick
    timeline: list[TimelineStep] = Field(min_length=1)
    finish_time: str = Field(description="HH:MM end of the hike step in the timeline (hike start + walking hours)", pattern=HHMM)
    sunset: str = Field(description="HH:MM from get_daylight", pattern=HHMM)
    why_this: str
    backup: TrailPick | None = None
    why_not: list[WhyNot] = []
    weather_summary: str = Field(default="", description="Leave empty: the server writes it from get_weather")
    citations: list[Citation] = Field(default=[], description="Only hiking.gov.hk description passages behind a scenery claim; the server adds the trail, HKO and closure sources")


RefusalCode = Literal[
    "CLOSED", "WARNING_T8", "RAINSTORM", "THUNDERSTORM", "LANDSLIP", "EXTREME_HEAT", "EXCEEDS_ABILITY", "AFTER_DARK", "INSUFFICIENT_TIME", "OUT_OF_SCOPE"
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
    # A plain array (not "array or null"): small models copy an anyOf schema into their arguments.
    options: list[str] = Field(default_factory=list, description="2-5 short choices for single/multi; [] for text")


class AskUser(BaseModel):
    cards: list[QuestionCard] = Field(min_length=1, max_length=3)
