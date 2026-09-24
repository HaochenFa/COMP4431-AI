---
description: Turn a loose request into constraints; decide what to ask.
---
# Intake

Extract these from the conversation: date, time available (or "half day" / "full day"), start time, fitness (beginner / regular / experienced), region or starting MTR station, wants (sea view, peak, waterfall, shade, family, dog...), and worries (heat, recent rain, exposure).

- Date missing: assume the next Saturday only if the user says "weekend"; otherwise ask.
- Fitness missing: ask. It decides the star ceiling.
- Ask everything in one ask_user call with up to 3 cards. Use single-select for fitness, e.g. ["Beginner - rarely hike", "Regular - hike monthly", "Experienced - long ridges are fine"]. Don't ask for anything the user already said.
- If the user answers loosely, map the answer to the nearest option and continue.
