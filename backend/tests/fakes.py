"""Test doubles shared by the harness and eval tests."""

from app.llm.base import Completion, Message, TextDelta, ToolCall


class ScriptedProvider:
    """Returns pre-written assistant turns in order; records what it was sent."""

    key = "fake"
    model = "fake-1"

    def __init__(self, turns: list[list[ToolCall] | str]):
        self.turns = list(turns)
        self.seen: list[list[Message]] = []

    async def stream(self, system, messages, tools):
        self.seen.append(list(messages))
        turn = self.turns.pop(0)
        if isinstance(turn, str):
            yield TextDelta(turn)
            yield Completion(Message("assistant", text=turn), stop="end")
        else:
            yield Completion(Message("assistant", tool_calls=turn), stop="tool_use")
