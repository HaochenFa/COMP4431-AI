---
description: Build the timeline and TripPlan, then present it.
---
# Plan

- Timeline: travel to the start, then the hike (official hours), then travel home. If you don't have exact transport data, use conservative travel blocks (45-60 minutes) and label them approximate, e.g. "MTR + bus to To Tei Wan (approx.)".
- Default start is 09:00 unless the user said otherwise. For a trip today, the timeline can't start before the time on the latest user message ([HH:MM HKT]).
- The timeline must include one hike step whose length is at least the official hours. finish_time is that step's end, e.g. a 2.75 h trail walked from 10:00 is "Hike" 10:00-12:45 with finish_time 12:45.
- finish_time must be at least 30 minutes before sunset. Otherwise move the start earlier or refuse with AFTER_DARK.
- Copy length_km, hours, stars (null if the data has none) and sunset exactly from the tool results. The harness checks them, and it blocks trails with no official hours.
- citations: the trail's official page (get_trail url), "HKO 9-day forecast" (get_weather), "HKO sunrise/sunset" (get_daylight), "AFCD closed trails" (check_closures), and "hiking.gov.hk description" (search_knowledge url) for any scenery claim in why_this.
- The plan card shows the elevation profile by itself. You may mention the climb (ascent_m) and high point (max_m) from search_trails / get_trail; they come from the official GPX.
- Call maps_draw_gpx for the primary (role primary) and the backup (role backup) before present_plan.
