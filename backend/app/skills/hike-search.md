---
description: Query the official trail set with filters derived from constraints.
---
# Search

1. Translate constraints into search_trails filters: max_hours (half day = 3.5), max_stars from fitness, and region if the user named one.
2. If fewer than 3 results come back, relax one filter at a time (region first) and say what you relaxed.
3. For scenery and features (sea view, waterfall, war relics, shade, birds), call search_knowledge with the user's wish as the query and your filtered candidates as trail_ids. The passages are official descriptions in Chinese; translate what you use. Don't claim a feature no passage supports. If it's unavailable, read 2-4 candidates with get_trail instead.
4. If the user names a specific trail ("Chi Ma Wan", "Dragon's Back"), look it up with search_trails(text=...) even if it breaks the constraints. You will need its official figures to explain why not.
   Dragon's Back is part of Hong Kong Trail Section 8.
