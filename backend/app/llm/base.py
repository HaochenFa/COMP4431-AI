"""Provider-neutral conversation types and the Provider interface.

Every adapter converts these to its own wire format. Assistant turns also keep the
provider's raw output in `native[provider_key]` so replaying history to the same
provider is lossless (thinking blocks, reasoning items, signatures).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Literal, Protocol

Role = Literal["user", "assistant", "tool"]
StopReason = Literal["end", "tool_use", "max_tokens", "refusal"]


@dataclass
class ToolSpec:
    name: str
    description: str
    parameters: dict[str, Any]  # JSON Schema (object)


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: dict[str, Any]


@dataclass
class ToolResult:
    call_id: str
    content: str
    is_error: bool = False


@dataclass
class Message:
    role: Role
    text: str = ""
    tool_calls: list[ToolCall] = field(default_factory=list)  # assistant only
    tool_results: list[ToolResult] = field(default_factory=list)  # tool only
    native: dict[str, Any] = field(default_factory=dict)  # provider_key -> raw assistant output


@dataclass
class TextDelta:
    text: str


@dataclass
class TextReset:
    """The adapter re-issued the turn: discard the text streamed since the turn began."""


@dataclass
class Completion:
    message: Message
    stop: StopReason
    usage: dict[str, int] = field(default_factory=dict)


ProviderEvent = TextDelta | TextReset | Completion


class Provider(Protocol):
    key: str  # e.g. "anthropic", "openai_chat", "openai_responses"
    model: str

    def stream(
        self, system: str, messages: list[Message], tools: list[ToolSpec]
    ) -> AsyncIterator[ProviderEvent]:
        """Yield TextDelta events (and TextReset if the turn is re-issued), then exactly one Completion."""
        ...
