"""OpenAI Responses API adapter. Stateless by default (store=False) and replays the raw
output items (incl. encrypted reasoning) so multi-turn tool use keeps its reasoning."""

from __future__ import annotations

import json
from typing import Any, AsyncIterator

import openai

from .base import Completion, Message, ProviderEvent, StopReason, TextDelta, ToolCall, ToolSpec
from .openai_chat import _parse_args


def to_responses_input(messages: list[Message], key: str = "openai_responses") -> list[dict]:
    items: list[dict] = []
    for m in messages:
        if m.role == "user":
            items.append({"role": "user", "content": m.text})
        elif m.role == "assistant":
            if key in m.native:
                items.extend(m.native[key])
                continue
            if m.text:
                items.append({"role": "assistant", "content": m.text})
            items.extend(
                {"type": "function_call", "call_id": c.id, "name": c.name, "arguments": json.dumps(c.arguments, ensure_ascii=False)}
                for c in m.tool_calls
            )
        else:
            items.extend({"type": "function_call_output", "call_id": r.call_id, "output": r.content} for r in m.tool_results)
    return items


def to_responses_tools(tools: list[ToolSpec]) -> list[dict]:
    return [{"type": "function", "name": t.name, "description": t.description, "parameters": t.parameters, "strict": False} for t in tools]


class OpenAIResponsesProvider:
    key = "openai_responses"

    def __init__(
        self,
        model: str,
        api_key: str | None = None,
        base_url: str | None = None,
        max_tokens: int = 16000,
        reasoning_effort: str | None = None,
        store: bool = False,
        extra: dict | None = None,
    ):
        self.model = model
        self.max_tokens = max_tokens
        self.reasoning_effort = reasoning_effort
        self.store = store
        self.extra = extra or {}
        self.client = openai.AsyncOpenAI(api_key=api_key, base_url=base_url)

    async def stream(self, system: str, messages: list[Message], tools: list[ToolSpec]) -> AsyncIterator[ProviderEvent]:
        params: dict[str, Any] = {
            "model": self.model,
            "instructions": system,
            "input": to_responses_input(messages, self.key),
            "tools": to_responses_tools(tools),
            "max_output_tokens": self.max_tokens,
            "store": self.store,
            "stream": True,
            **self.extra,
        }
        if self.reasoning_effort:
            params["reasoning"] = {"effort": self.reasoning_effort}
        if not self.store:
            # Stateless: reasoning items must carry their encrypted content to be replayed next turn.
            params["include"] = ["reasoning.encrypted_content"]

        response = None
        stream = await self.client.responses.create(**params)
        async for event in stream:
            if event.type == "response.output_text.delta":
                yield TextDelta(event.delta)
            elif event.type in ("response.completed", "response.incomplete", "response.failed"):
                response = event.response
        if response is None:
            raise RuntimeError("Responses stream ended without a terminal event")
        if response.status == "failed":
            raise RuntimeError(f"Responses API failed: {response.error}")

        output = [item.model_dump(mode="json", exclude_none=True) for item in response.output]
        calls: list[ToolCall] = []
        text_parts: list[str] = []
        refused = False
        for item in response.output:
            if item.type == "function_call":
                calls.append(ToolCall(item.call_id, item.name, _parse_args(item.arguments)))
            elif item.type == "message":
                for part in item.content:
                    if part.type == "output_text":
                        text_parts.append(part.text)
                    elif part.type == "refusal":
                        refused = True
                        text_parts.append(part.refusal)

        stop: StopReason
        if response.status == "incomplete":
            reason = getattr(response.incomplete_details, "reason", None)
            stop = "refusal" if reason == "content_filter" else "max_tokens"
        elif refused:
            stop = "refusal"
        else:
            stop = "tool_use" if calls else "end"
        if stop != "tool_use" and calls:
            calls = []
            output = [o for o in output if o.get("type") != "function_call"]
        usage = {}
        if response.usage:
            usage = {"input_tokens": response.usage.input_tokens, "output_tokens": response.usage.output_tokens}
        yield Completion(Message("assistant", text="".join(text_parts), tool_calls=calls, native={self.key: output}), stop=stop, usage=usage)
