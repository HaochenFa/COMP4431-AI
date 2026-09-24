from app.llm.anthropic_messages import _sanitize_native, to_anthropic_messages
from app.llm.base import Message, ToolCall, ToolResult
from app.llm.openai_chat import to_chat_messages
from app.llm.openai_responses import to_responses_input

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
