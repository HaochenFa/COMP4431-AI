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
            schema = flatten_schema(schema.model_json_schema())

        def deco(fn: Handler) -> Handler:
            self.tools[name] = Tool(ToolSpec(name, description, schema), fn)
            return fn

        return deco

    @property
    def specs(self) -> list[ToolSpec]:
        return [t.spec for t in self.tools.values()]


def flatten_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """Make a Pydantic JSON Schema easy for any model to fill: inline every $ref, turn `anyOf [X, null]`
    into a nullable X, and drop titles. Several models stop mid-object or copy `anyOf` into their
    arguments when handed the nested $defs form."""
    defs = schema.get("$defs", {})

    def walk(node: Any) -> Any:
        if isinstance(node, list):
            return [walk(n) for n in node]
        if not isinstance(node, dict):
            return node
        if "$ref" in node:
            target = walk(defs[node["$ref"].rsplit("/", 1)[-1]])
            return {**target, **{k: walk(v) for k, v in node.items() if k != "$ref"}}
        out = {k: ({name: walk(sub) for name, sub in v.items()} if k == "properties" else walk(v))
               for k, v in node.items() if k not in ("$defs", "title")}  # a property named "title" survives
        options = out.get("anyOf")
        if isinstance(options, list) and len(options) == 2 and {"type": "null"} in options:
            other = next(o for o in options if o != {"type": "null"})
            if isinstance(other.get("type"), str):
                out.pop("anyOf")
                out = {**other, **out, "type": [other["type"], "null"]}
        return out

    return walk(schema)


def obj(properties: dict[str, Any], required: list[str] | None = None) -> dict[str, Any]:
    return {"type": "object", "properties": properties, "required": required or [], "additionalProperties": False}
