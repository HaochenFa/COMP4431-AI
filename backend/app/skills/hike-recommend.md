---
description: Pick one primary and one backup; explain why-not for rejected famous trails.
---
# Recommend

1. Call check_closures for every candidate you might present, in one call.
2. Call get_weather and get_daylight for the date.
3. Apply hike-safety to each candidate. Drop anything that fails.
4. Primary = the best fit for the user's wants within their limits. Backup = a different trail that still works if the primary disappoints (e.g. more shade, shorter, different area). Not the next section of the same long-distance trail: weather or a closure that stops one usually stops the other.
5. why_not: for every trail the user named or clearly hinted at that you rejected, give the official figure that rules it out, e.g. "18.5 km / 8 hours / 5 stars for a half-day beginner".
6. If nothing survives, call refuse with the strongest reason and a counterfactual.
