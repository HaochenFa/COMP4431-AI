import json
from types import SimpleNamespace

from app.llm.anthropic_messages import AnthropicProvider, _sanitize_native, to_anthropic_messages
from app.llm.base import Completion, Message, TextDelta, TextReset, ToolCall, ToolResult
from app.llm.openai_chat import to_chat_messages
from app.llm.openai_responses import _without_calls, to_responses_input

CALL = ToolCall("call_1", "get_weather", {"date": "2026-09-26"})
HISTORY = [
    Message("user", text="Saturday hike?"),
    Message("assistant", text="Checking.", tool_calls=[CALL]),
    Message("tool", tool_results=[ToolResult("call_1", '{"ok": true}')]),
    Message("user", text="Also, I'm a beginner."),
]


def test_anthropic_merges_tool_results_with_following_user_turn():
    msgs = to_anthropic_messages(HISTORY)
    assert [m["role"] for m in msgs] == ["user", "assistant", "user"]
    assert msgs[1]["content"][1] == {"type": "tool_use", "id": "call_1", "name": "get_weather", "input": {"date": "2026-09-26"}}
    assert msgs[2]["content"][0]["type"] == "tool_result" and msgs[2]["content"][1]["type"] == "text"


def test_anthropic_replays_native_blocks_verbatim():
    native = [{"type": "thinking", "thinking": "", "signature": "sig"}, {"type": "tool_use", "id": "call_1", "name": "get_weather", "input": {}}]
    hist = [HISTORY[0], Message("assistant", tool_calls=[CALL], native={"anthropic": native}), HISTORY[2]]
    assert to_anthropic_messages(hist)[1]["content"] == native


def test_anthropic_fallback_echo_rules():
    blocks = [
        {"type": "thinking", "thinking": "", "signature": "a"},
        {"type": "text", "text": "partial"},
        {"type": "tool_use", "id": "x", "name": "n", "input": {}},
        {"type": "fallback", "from": {"model": "a"}, "to": {"model": "b"}},
        {"type": "text", "text": "after"},
    ]
    assert [b["type"] for b in _sanitize_native(blocks)] == ["text", "text"]


def test_chat_completions_shape():
    msgs = to_chat_messages("SYS", HISTORY)
    assert msgs[0] == {"role": "system", "content": "SYS"}
    assert msgs[2]["tool_calls"][0]["function"] == {"name": "get_weather", "arguments": '{"date": "2026-09-26"}'}
    assert msgs[3] == {"role": "tool", "tool_call_id": "call_1", "content": '{"ok": true}'}
    assert msgs[4] == {"role": "user", "content": "Also, I'm a beginner."}


def test_responses_shape_and_native_replay():
    items = to_responses_input(HISTORY)
    assert items[1] == {"role": "assistant", "content": "Checking."}
    assert items[2]["type"] == "function_call" and items[2]["call_id"] == "call_1"
    assert items[3] == {"type": "function_call_output", "call_id": "call_1", "output": '{"ok": true}'}
    native = [{"type": "reasoning", "id": "rs_1", "encrypted_content": "enc", "summary": []},
              {"type": "function_call", "call_id": "call_1", "name": "get_weather", "arguments": "{}"}]
    hist = [HISTORY[0], Message("assistant", tool_calls=[CALL], native={"openai_responses": native}), HISTORY[2]]
    assert to_responses_input(hist)[1:3] == native


def test_responses_drops_reasoning_orphaned_by_removed_calls():
    output = [{"type": "reasoning", "id": "rs_1"}, {"type": "message", "content": []},
              {"type": "reasoning", "id": "rs_2"}, {"type": "function_call", "call_id": "c"}]
    assert _without_calls(output) == output[:2]


class _Block(dict):
    def __getattr__(self, k):
        return self[k]

    def model_dump(self, **_):
        return dict(self)


class _FakeStream:
    def __init__(self, texts, content, stop="end_turn", fail=False):
        self.texts, self.fail = texts, fail
        self.final = SimpleNamespace(content=[_Block(b) for b in content], stop_reason=stop,
                                     usage=SimpleNamespace(input_tokens=1, output_tokens=1))

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def __aiter__(self):
        for t in self.texts:
            yield SimpleNamespace(type="text", text=t)
        if self.fail:
            raise ValueError("unparseable tool input")

    async def get_final_message(self):
        return self.final


def _anthropic(*streams):
    p = AnthropicProvider("claude-opus-5", api_key="test", fallbacks=None)
    queue = list(streams)
    p.client = SimpleNamespace(beta=SimpleNamespace(messages=SimpleNamespace(stream=lambda **kw: queue.pop(0))))
    return p


async def _collect(provider):
    return [ev async for ev in provider.stream("sys", [Message("user", text="hi")], [])]


async def test_anthropic_runs_only_calls_that_survive_the_fallback_echo_rules():
    content = [{"type": "text", "text": "Let me check. "}, {"type": "tool_use", "id": "old", "name": "get_weather", "input": {"da": 1}},
               {"type": "fallback", "from": {"model": "a"}, "to": {"model": "b"}},
               {"type": "tool_use", "id": "new", "name": "get_weather", "input": {"date": "2026-11-18"}}]
    done = (await _collect(_anthropic(_FakeStream(["Let me check. "], content, stop="tool_use"))))[-1]
    assert [c.id for c in done.message.tool_calls] == ["new"]
    assert [b["type"] for b in done.message.native["anthropic"]] == ["text", "tool_use"]


async def test_anthropic_retry_resets_streamed_text_instead_of_duplicating_it():
    evs = await _collect(_anthropic(_FakeStream(["Checking"], [], fail=True), _FakeStream(["Checking now."], [{"type": "text", "text": "Checking now."}])))
    assert [type(e).__name__ for e in evs] == ["TextDelta", "TextReset", "TextDelta", "Completion"]
    assert isinstance(evs[1], TextReset) and isinstance(evs[2], TextDelta) and isinstance(evs[-1], Completion)
    assert evs[-1].message.text == "Checking now."


async def test_anthropic_refusal_before_output_gives_an_empty_message():
    done = (await _collect(_anthropic(_FakeStream([], [], stop="refusal"))))[-1]
    assert done.stop == "refusal" and not done.message.text and not done.message.tool_calls


def test_tool_schemas_are_flattened_for_every_model():
    from pydantic import BaseModel

    from app.agent.harness import build_toolbox
    from app.tools.base import flatten_schema

    class Inner(BaseModel):
        title: str
        n: int | None = None

    class Outer(BaseModel):
        a: Inner
        b: Inner | None = None
        c: list[Inner]

    flat = flatten_schema(Outer.model_json_schema())
    text = json.dumps(flat)
    assert "$ref" not in text and "$defs" not in text and "anyOf" not in text
    assert flat["properties"]["a"]["properties"]["title"] == {"type": "string"}  # a field named title is kept
    assert flat["properties"]["b"]["type"] == ["object", "null"] and flat["properties"]["c"]["items"]["required"] == ["title"]
    assert flat["properties"]["a"]["properties"]["n"]["type"] == ["integer", "null"]
    for spec in build_toolbox().specs:
        assert "$ref" not in json.dumps(spec.parameters), spec.name
