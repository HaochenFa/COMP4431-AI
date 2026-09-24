"""Fetch live JSON with a short in-memory TTL and a disk snapshot fallback.

Every successful fetch refreshes data/snapshots/<key>.json, so the demo keeps working
offline or when a government endpoint is down (the result is marked `stale`).
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

import httpx

from .paths import SNAPSHOTS

_memory: dict[str, tuple[float, Any]] = {}


async def fetch_json(key: str, url: str, params: dict | None = None, ttl: float = 600) -> tuple[Any, dict]:
    """Return (data, meta). meta = {"data_from": "live"|"cache"|"snapshot", "fetched_at": iso}."""
    now = time.time()
    if (hit := _memory.get(key)) and now - hit[0] < ttl:
        return hit[1]["data"], {"data_from": "cache", "fetched_at": hit[1]["fetched_at"]}
    snap: Path = SNAPSHOTS / f"{key}.json"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(url, params=params)
            r.raise_for_status()
            data = r.json()
        record = {"fetched_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "data": data}
        _memory[key] = (now, record)
        snap.parent.mkdir(parents=True, exist_ok=True)
        snap.write_text(json.dumps(record, ensure_ascii=False))
        return data, {"data_from": "live", "fetched_at": record["fetched_at"]}
    except (httpx.HTTPError, ValueError):
        if snap.exists():
            record = json.loads(snap.read_text())
            return record["data"], {"data_from": "snapshot", "fetched_at": record["fetched_at"], "stale": True}
        raise
