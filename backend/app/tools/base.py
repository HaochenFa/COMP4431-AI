"""Tool registry: each tool is a JSON-schema'd async handler that returns a ToolOutput."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from pydantic import BaseModel

from ..agent.session import Emit, Session
from ..llm.base import ToolSpec


@dataclass
class ToolContext:
    session: Session
    emit: Emit
    call_id: str


@dataclass
class ToolOutput:
    content: Any  # str or JSON-serialisable; returned to the model
    summary: str = ""  # one line for the tool_trace chip in the app
    is_error: bool = False
    blocked: bool = False  # the gate refused this call
    pause: bool = False  # ask_user: suspend the loop until the user answers


Handler = Callable[[dict[str, Any], ToolContext], Awaitable[ToolOutput]]


@dataclass
class Tool:
    spec: ToolSpec
    handler: Handler


@dataclass
class ToolBox:
    tools: dict[str, Tool] = field(default_factory=dict)

    def register(self, name: str, description: str, schema: dict[str, Any] | type[BaseModel]):
        if isinstance(schema, type) and issubclass(schema, BaseModel):
            schema = schema.model_json_schema()

        def deco(fn: Handler) -> Handler:
            self.tools[name] = Tool(ToolSpec(name, description, schema), fn)
            return fn

        return deco

    @property
    def specs(self) -> list[ToolSpec]:
        return [t.spec for t in self.tools.values()]


def obj(properties: dict[str, Any], required: list[str] | None = None) -> dict[str, Any]:
    return {"type": "object", "properties": properties, "required": required or [], "additionalProperties": False}
