"""Regression coverage for stale safety feeds, trace paths, and reconnect replay."""

import json
from datetime import datetime, timedelta
from urllib.parse import quote

import pytest
from fastapi import WebSocketDisconnect
from fastapi.testclient import TestClient

from app import main
from app.agent import session as session_module
from app.agent.harness import build_toolbox
from app.agent.session import Session, SessionStore
from app.tools import data
from app.tools.agentic import gate
from app.tools.base import ToolContext


async def noop(event):
    pass


@pytest.mark.parametrize("session_id", [
    "../outside", "../../outside", "/tmp/outside", "..%2Foutside",
    r"..\outside", "", "x\x00y", "x\ny", "x" * 161,
])
def test_trace_rejects_unsafe_ids_at_store_and_sink(tmp_path, monkeypatch, session_id):
    monkeypatch.setattr(session_module, "TRACES", tmp_path / "traces")
    with pytest.raises(ValueError):
        SessionStore().get(session_id)
    with pytest.raises(ValueError):
        Session(session_id).trace({"in": {"type": "reset"}})
    assert list(tmp_path.iterdir()) == []


@pytest.mark.parametrize("session_id", ["default", "cli", "s-abc-1234", "eval-or-sonnet-0-case", "conditions:s-abc"])
def test_trace_preserves_valid_names_and_append(tmp_path, monkeypatch, session_id):
    monkeypatch.setattr(session_module, "TRACES", tmp_path)
    s = SessionStore().get(session_id)
    s.trace({"n": 1})
    s.trace({"n": 2})
    assert [json.loads(line)["n"] for line in (tmp_path / f"{session_id}.jsonl").read_text().splitlines()] == [1, 2]


def test_trace_does_not_follow_symlinks(tmp_path, monkeypatch):
    root = tmp_path / "traces"
    root.mkdir()
    outside = tmp_path / "outside.jsonl"
    outside.write_text("unchanged")
    (root / "safe.jsonl").symlink_to(outside)
    monkeypatch.setattr(session_module, "TRACES", root)
    with pytest.raises(ValueError):
        Session("safe").trace({"n": 1})
    assert outside.read_text() == "unchanged"


@pytest.mark.parametrize("session_id", ["../outside", "/tmp/outside", r"..\outside", "..%2Foutside"])
def test_websocket_rejects_unsafe_session_ids(session_id):
    with TestClient(main.app) as client:
        with pytest.raises(WebSocketDisconnect) as error:
            with client.websocket_connect(f"/ws/chat?session={quote(session_id, safe='')}"):
                pass
    assert error.value.code == 1008


@pytest.fixture
def feeds(monkeypatch):
    now = datetime.now(data.HKT)
    meta = {"data_from": "live", "fetched_at": now.isoformat()}
    tomorrow = data.today_hk() + timedelta(days=1)
    records = {
        "flw": ({"forecastDesc": "Fine", "updateTime": now.isoformat()}, dict(meta)),
        "fnd": ({"weatherForecast": [{"forecastDate": tomorrow.strftime("%Y%m%d"), "forecastWeather": "Fine"}]}, dict(meta)),
        "warnsum": ({}, dict(meta)),
        "closures": ([], dict(meta)),
    }

    async def hko(kind, **kwargs):
        return records[kind]

    async def closures():
        return records["closures"]

    monkeypatch.setattr(data, "hko", hko)
    monkeypatch.setattr(data, "closures", closures)
    return records


@pytest.mark.parametrize("kind,offset", [("flw", 0), ("fnd", 1), ("warnsum", 0), ("closures", 0)])
async def test_stale_feeds_cannot_satisfy_live_plan_gate(feeds, kind, offset):
    feeds[kind][1].update(stale=True, data_from="snapshot", fetched_at="2026-09-24T04:05:27+08:00")
    box, session = build_toolbox(), Session("freshness")
    ctx = ToolContext(session, noop, "check")
    day = (data.today_hk() + timedelta(days=offset)).isoformat()
    tool = "check_closures" if kind == "closures" else "get_weather"
    args = {"ids": ["hk_8"]} if kind == "closures" else {"date": day}
    out = await box.tools[tool].handler(args, ctx)
    assert out.is_error
    assert any(tool in missing for missing in gate(ctx, day, ["hk_8"], False))


async def test_today_forecast_must_be_for_today_even_after_live_fetch(feeds):
    feeds["flw"][0]["updateTime"] = (datetime.now(data.HKT) - timedelta(days=1)).isoformat()
    session = Session("old-date")
    out = await build_toolbox().tools["get_weather"].handler(
        {"date": data.today_hk().isoformat()}, ToolContext(session, noop, "w"))
    assert out.is_error and not session.ledger.weather_dates


async def test_recent_live_feeds_still_satisfy_gate(feeds):
    box, session = build_toolbox(), Session("fresh")
    ctx = ToolContext(session, noop, "check")
    day = data.today_hk().isoformat()
    assert not (await box.tools["get_weather"].handler({"date": day}, ctx)).is_error
    assert not (await box.tools["check_closures"].handler({"ids": ["hk_8"]}, ctx)).is_error
    assert gate(ctx, day, ["hk_8"], False) == []


async def test_clear_demo_keeps_offline_support_without_reusing_old_forecast(feeds):
    for _, meta in feeds.values():
        meta.update(stale=True, data_from="snapshot")
    session = Session("demo", scenario="clear")
    ctx, box = ToolContext(session, noop, "check"), build_toolbox()
    day = data.today_hk().isoformat()
    assert not (await box.tools["get_weather"].handler({"date": day}, ctx)).is_error
    assert "demo override" in session.ledger.forecast[day]
    assert not (await box.tools["check_closures"].handler({"ids": ["hk_8"]}, ctx)).is_error


class ReplaySocket:
    def __init__(self, fail_on=None):
        self.sent = []
        self.fail_on = fail_on

    async def accept(self):
        pass

    async def send_json(self, event):
        if event["type"] == self.fail_on:
            raise RuntimeError("Connection dropped")
        self.sent.append(event)

    async def receive_json(self):
        raise WebSocketDisconnect()


@pytest.mark.parametrize("fail_on", ["hello", "plan", "assistant_done"])
async def test_failed_replay_keeps_undelivered_events_for_next_connection(monkeypatch, fail_on):
    store = SessionStore()
    monkeypatch.setattr(main, "sessions", store)
    monkeypatch.setattr(main, "live", {})
    s = store.get("replay")
    events = [{"type": "plan", "plan": {}}, {"type": "assistant_done"}]
    s.missed.extend(events)
    first = ReplaySocket(fail_on)
    await main.chat(first, s.id)
    expected = events[1:] if fail_on == "assistant_done" else events
    assert list(s.missed) == expected
    second = ReplaySocket()
    await main.chat(second, s.id)
    assert second.sent[1:] == expected
    assert not s.missed
