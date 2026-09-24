"""OpenAI Chat Completions adapter. With `base_url` it also covers OpenAI-compatible
servers (DeepSeek, OpenRouter, Ollama, vLLM, ...)."""

from __future__ import annotations

import json
from typing import Any, AsyncIterator

import openai

from .base import Completion, Message, ProviderEvent, StopReason, TextDelta, ToolCall, ToolSpec

_STOP: dict[str, StopReason] = {"stop": "end", "tool_calls": "tool_use", "function_call": "tool_use", "length": "max_tokens", "content_filter": "refusal"}


def to_chat_messages(system: str, messages: list[Message]) -> list[dict]:
    out: list[dict] = [{"role": "system", "content": system}]
    for m in messages:
        if m.role == "user":
            out.append({"role": "user", "content": m.text})
        elif m.role == "assistant":
            item: dict[str, Any] = {"role": "assistant", "content": m.text or None}
            if m.tool_calls:
                item["tool_calls"] = [
                    {"id": c.id, "type": "function", "function": {"name": c.name, "arguments": json.dumps(c.arguments, ensure_ascii=False)}}
                    for c in m.tool_calls
                ]
            out.append(item)
        else:
            out.extend({"role": "tool", "tool_call_id": r.call_id, "content": r.content} for r in m.tool_results)
    return out


def to_chat_tools(tools: list[ToolSpec]) -> list[dict]:
    return [{"type": "function", "function": {"name": t.name, "description": t.description, "parameters": t.parameters}} for t in tools]


def _parse_args(raw: str) -> dict:
    try:
        val = json.loads(raw or "{}")
    except json.JSONDecodeError:
        return {"__invalid_json__": raw}
    return val if isinstance(val, dict) else {"__invalid_json__": raw}


class OpenAIChatProvider:
    key = "openai_chat"

    def __init__(
        self,
        model: str,
        api_key: str | None = None,
        base_url: str | None = None,
        max_tokens: int = 16000,
        max_tokens_param: str = "max_completion_tokens",
        reasoning_effort: str | None = None,
        extra: dict | None = None,
    ):
        self.model = model
        self.max_tokens = max_tokens
        self.max_tokens_param = max_tokens_param  # compat servers often want "max_tokens"
        self.reasoning_effort = reasoning_effort
        self.extra = extra or {}
        self.client = openai.AsyncOpenAI(api_key=api_key, base_url=base_url)

    async def stream(self, system: str, messages: list[Message], tools: list[ToolSpec]) -> AsyncIterator[ProviderEvent]:
        params: dict[str, Any] = {
            "model": self.model,
            "messages": to_chat_messages(system, messages),
            "stream": True,
            "stream_options": {"include_usage": True},  # final chunk carries usage (profiles can override via extra)
            self.max_tokens_param: self.max_tokens,
            **self.extra,
        }
        if tools:  # some servers reject an empty list (the no-tools eval baseline sends none)
            params["tools"] = to_chat_tools(tools)
        if self.reasoning_effort:
            params["reasoning_effort"] = self.reasoning_effort

        text_parts: list[str] = []
        pending: dict[int, dict[str, str]] = {}  # index -> {id, name, arguments}
        finish = "stop"
        usage: dict[str, int] = {}
        stream = await self.client.chat.completions.create(**params)
        async for chunk in stream:
            if chunk.usage:
                usage = {"input_tokens": chunk.usage.prompt_tokens, "output_tokens": chunk.usage.completion_tokens}
            if not chunk.choices:
                continue
            choice = chunk.choices[0]
            delta = choice.delta
            if delta and delta.content:
                text_parts.append(delta.content)
                yield TextDelta(delta.content)
            for tc in (delta.tool_calls if delta else None) or []:
                slot = pending.setdefault(tc.index, {"id": "", "name": "", "arguments": ""})
                if tc.id:
                    slot["id"] = tc.id
                if tc.function and tc.function.name:
                    slot["name"] += tc.function.name
                if tc.function and tc.function.arguments:
                    slot["arguments"] += tc.function.arguments
            if choice.finish_reason:
                finish = choice.finish_reason

        calls = [ToolCall(s["id"] or f"call_{i}", s["name"], _parse_args(s["arguments"])) for i, s in sorted(pending.items())]
        stop: StopReason = _STOP.get(finish, "end")
        if calls and stop in ("end", "tool_use"):
            stop = "tool_use"  # some compat servers report "stop" alongside tool calls
        else:
            calls = []
        yield Completion(Message("assistant", text="".join(text_parts), tool_calls=calls), stop=stop, usage=usage)
