"""Text embeddings for search_knowledge, over any OpenAI-compatible /v1/embeddings endpoint
(Ollama bge-m3 by default; see `embeddings:` in config.yaml)."""

from __future__ import annotations

import math

import openai


class Embedder:
    def __init__(self, model: str, base_url: str | None = None, api_key: str | None = None):
        self.model = model
        self.client = openai.AsyncOpenAI(api_key=api_key or "unused", base_url=base_url, timeout=30, max_retries=0)

    async def embed(self, texts: list[str]) -> list[list[float]]:
        """Unit-length vectors, so a dot product is the cosine similarity."""
        r = await self.client.embeddings.create(model=self.model, input=texts)
        out = []
        for d in sorted(r.data, key=lambda d: d.index):
            norm = math.sqrt(sum(x * x for x in d.embedding)) or 1.0
            out.append([x / norm for x in d.embedding])
        return out
