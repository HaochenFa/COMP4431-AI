---
description: Query the official trail set with filters derived from constraints.
---
# Search

1. Translate constraints into search_trails filters: max_hours (half day = 3.5), max_stars from fitness, and region if the user named one.
2. If fewer than 3 results come back, relax one filter at a time (region first) and say what you relaxed.
3. For sea views and similar features, use get_trail on 2-4 candidates and read their descriptions (in Chinese). Don't claim a feature the description doesn't support.
4. If the user names a specific trail ("Chi Ma Wan", "Dragon's Back"), look it up with search_trails(text=...) even if it breaks the constraints. You will need its official figures to explain why not.
   Dragon's Back is part of Hong Kong Trail Section 8.
