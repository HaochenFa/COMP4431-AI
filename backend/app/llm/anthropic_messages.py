"""Anthropic Messages API adapter (streaming, client tools, adaptive thinking)."""

from __future__ import annotations

from typing import Any, AsyncIterator

import anthropic

from .base import Completion, Message, ProviderEvent, StopReason, TextDelta, ToolCall, ToolSpec

_STOP: dict[str, StopReason] = {"end_turn": "end", "stop_sequence": "end", "tool_use": "tool_use", "max_tokens": "max_tokens", "refusal": "refusal"}


def _sanitize_native(blocks: list[dict]) -> list[dict]:
    """Echo rules after a mid-output fallback: drop thinking/tool_use before the last
    `fallback` marker, and drop the marker itself."""
    last = max((i for i, b in enumerate(blocks) if b.get("type") == "fallback"), default=-1)
    if last < 0:
        return blocks
    drop_before = {"thinking", "redacted_thinking", "tool_use"}
    return [b for i, b in enumerate(blocks) if i > last or (i < last and b.get("type") not in drop_before)]


def to_anthropic_messages(messages: list[Message], key: str = "anthropic") -> list[dict]:
    out: list[dict] = []
    for m in messages:
        if m.role == "user":
            item = {"role": "user", "content": [{"type": "text", "text": m.text}]}
        elif m.role == "assistant":
            if key in m.native:
                content = _sanitize_native(m.native[key])
            else:
                content = ([{"type": "text", "text": m.text}] if m.text else []) + [
                    {"type": "tool_use", "id": c.id, "name": c.name, "input": c.arguments} for c in m.tool_calls
                ]
            item = {"role": "assistant", "content": content}
        else:
            item = {
                "role": "user",
                "content": [
                    {"type": "tool_result", "tool_use_id": r.call_id, "content": r.content, "is_error": r.is_error}
                    for r in m.tool_results
                ],
            }
        # Merge consecutive same-role turns (e.g. tool results followed by a user message).
        if out and out[-1]["role"] == item["role"]:
            out[-1]["content"] = list(out[-1]["content"]) + list(item["content"])
        else:
            out.append(item)
    return out


def to_anthropic_tools(tools: list[ToolSpec]) -> list[dict]:
    return [
        {"name": t.name, "description": t.description, "input_schema": t.parameters, "eager_input_streaming": True}
        for t in tools
    ]


class AnthropicProvider:
    key = "anthropic"

    def __init__(
        self,
        model: str,
        api_key: str | None = None,
        base_url: str | None = None,
        max_tokens: int = 16000,
        effort: str | None = None,
        fallbacks: str | list[dict] | None = "default",
    ):
        self.model = model
        self.max_tokens = max_tokens
        self.effort = effort
        self.fallbacks = fallbacks
        self.client = anthropic.AsyncAnthropic(api_key=api_key, base_url=base_url)

    async def stream(self, system: str, messages: list[Message], tools: list[ToolSpec]) -> AsyncIterator[ProviderEvent]:
        params: dict[str, Any] = {
            "model": self.model,
            "max_tokens": self.max_tokens,
            "system": system,
            "messages": to_anthropic_messages(messages, self.key),
            "tools": to_anthropic_tools(tools),
            "thinking": {"type": "adaptive"},
        }
        if self.effort:
            params["output_config"] = {"effort": self.effort}
        if self.fallbacks:
            params["fallbacks"] = self.fallbacks
            # "default" scalar form and the explicit-model array form are gated by different betas
            params["betas"] = ["server-side-fallback-2026-07-01" if self.fallbacks == "default" else "server-side-fallback-2026-06-01"]

        final = None
        for attempt in range(3):
            try:
                async with self.client.beta.messages.stream(**params) as stream:
                    async for event in stream:
                        if event.type == "text":
                            yield TextDelta(event.text)
                    final = await stream.get_final_message()
                break
            except ValueError:
                # Tool-input JSON the SDK could not parse at all (eager streaming): re-issue the turn.
                if attempt == 2:
                    raise
        assert final is not None

        blocks = [b.model_dump(mode="json", exclude_none=True) for b in final.content]
        text = "".join(b.text for b in final.content if b.type == "text")
        calls = [ToolCall(b.id, b.name, b.input if isinstance(b.input, dict) else {}) for b in final.content if b.type == "tool_use"]
        stop: StopReason = _STOP.get(final.stop_reason or "end_turn", "end")
        if stop in ("refusal", "max_tokens") and calls:
            # A refusal or truncation can cut a tool_use off mid-input: never run it, and
            # keep it out of history (an unanswered tool_use would 400 the next request).
            calls = []
            blocks = [b for b in blocks if b.get("type") != "tool_use"]
        usage = {"input_tokens": final.usage.input_tokens, "output_tokens": final.usage.output_tokens}
        yield Completion(
            Message("assistant", text=text, tool_calls=calls, native={self.key: blocks}),
            stop=stop,
            usage=usage,
        )
