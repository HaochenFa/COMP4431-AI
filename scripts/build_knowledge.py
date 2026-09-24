"""Build data/knowledge.json: the official trail narratives (description_zh from hiking.gov.hk),
split into passages and embedded for search_knowledge.

    scripts/ollama_serve.sh &                                  # the embedder (bge-m3) runs on Ollama
    uv --project backend run python scripts/build_knowledge.py

Re-run after scripts/ingest_afcd.py refreshes trails.json, or after changing `embeddings:` in config.yaml
(queries must be embedded by the same model as the index).
"""

from __future__ import annotations

import asyncio
import base64
import json
import re
import sys
import time
from array import array
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from dotenv import load_dotenv  # noqa: E402

from app.llm.registry import build_embedder, load_profiles  # noqa: E402

BOILERPLATE = re.compile(r"為方便市民計劃遠足路線.*", re.S)  # the GPX download notice on every page
MIN_CHARS, MAX_CHARS = 150, 260


def passages(text: str) -> list[str]:
    """Sentence-aligned passages of roughly MIN..MAX characters."""
    sentences = [s for s in re.split(r"(?<=[。！？])", BOILERPLATE.sub("", text)) if s.strip()]
    out: list[str] = []
    cur = ""
    for s in sentences:
        if cur and (len(cur) >= MIN_CHARS or len(cur) + len(s) > MAX_CHARS):
            out.append(cur)
            cur = ""
        cur += s.strip()
    if cur:
        if out and len(cur) < MIN_CHARS // 2:
            out[-1] += cur
        else:
            out.append(cur)
    return out


async def main() -> None:
    load_dotenv(ROOT / "backend" / ".env")
    trails = json.loads((ROOT / "data" / "trails.json").read_text())
    chunks = []
    for t in trails:
        for i, text in enumerate(passages(t.get("description_zh") or "")):
            chunks.append({"id": f"{t['id']}#{i}", "trail_id": t["id"], "text": text,
                           "embed": f"{t['name']}（{t.get('name_zh') or ''}）：{text}"})
    embedder = build_embedder()
    for i in range(0, len(chunks), 32):
        batch = chunks[i : i + 32]
        for c, vec in zip(batch, await embedder.embed([c.pop("embed") for c in batch])):
            c["vec"] = base64.b64encode(array("f", vec).tobytes()).decode()
        print(f"embedded {min(i + 32, len(chunks))}/{len(chunks)}", flush=True)
    out = ROOT / "data" / "knowledge.json"
    out.write_text(json.dumps({
        "model": load_profiles()["embeddings"]["model"], "dim": len(array("f", base64.b64decode(chunks[0]["vec"]))),
        "built_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "source": "hiking.gov.hk trail descriptions (zh)",
        "chunks": chunks,
    }, ensure_ascii=False))
    print(f"wrote {out} ({len(chunks)} passages from {len({c['trail_id'] for c in chunks})} trails, {out.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    asyncio.run(main())
