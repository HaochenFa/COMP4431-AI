"""REST helpers for the app's browse screens (no network: HKO feeds are stubbed)."""

from datetime import date, timedelta

import numpy as np
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import tts
from app.agent.harness import build_toolbox
from app.agent.session import SessionStore
from app.rest import _TODAY_MAX, _weekend_after, build_router, build_tts_router
from app.tools import data
from app.tools.hiking import SCENARIO_DAYS


@pytest.fixture(autouse=True)
def offline(monkeypatch):
    async def fake_hko(data_type, ttl=600, endpoint="weather.php", **params):
        if data_type == "fnd":
            days = [data.today_hk() + timedelta(days=i) for i in range(1, 10)]
            return {"weatherForecast": [{"forecastDate": d.strftime("%Y%m%d"), "forecastWeather": "Sunny periods",
                                         "forecastMaxtemp": {"value": 29}, "forecastMintemp": {"value": 24}, "PSR": "Low"}
                                        for d in days]}, {}
        if data_type == "flw":
            return {"forecastDesc": "Mainly fine. The maximum temperature will be around 33 degrees in the urban areas."}, {}
        if data_type == "SRS":
            days = [(data.today_hk() + timedelta(days=i)).isoformat() for i in range(12)]
            return {"fields": ["YYYY-MM-DD", "RISE", "TRAN.", "SET"], "data": [[d, "06:13", "12:15", "18:02"] for d in days]}, {}
        return {}, {}

    monkeypatch.setattr(data, "hko", fake_hko)


@pytest.fixture
def client_and_sessions():
    sessions = SessionStore()
    app = FastAPI()
    app.include_router(build_router(sessions, build_toolbox()))
    return TestClient(app), sessions


def test_trail_list_has_every_trail_with_card_fields(client_and_sessions):
    client, _ = client_and_sessions
    rows = client.get("/trails").json()
    assert len(rows) == len(data.trails())
    hk8 = next(r for r in rows if r["id"] == "hk_8")
    assert {"name", "region", "difficulty", "length_km", "hours", "ascent_m", "start_coord", "photo"} <= hk8.keys()
    assert len(hk8["start_coord"]) == 2
    assert "Dragon's Back" in hk8["landmarks"]  # from 龍脊 in the official description, for the app's search


def test_trail_detail_and_unknown_id(client_and_sessions):
    client, _ = client_and_sessions
    t = client.get("/trails/hk_8").json()
    assert t["segments"] and t["profile"]["ascent_m"] > 0
    assert client.get("/trails/nope").status_code == 404


def test_conditions_follow_the_scenario_but_leave_the_gate_ledger_alone(client_and_sessions):
    client, sessions = client_and_sessions
    s = sessions.get("s1")
    s.set_scenario("t8")
    body = client.get("/conditions", params={"session": "s1"}).json()
    assert body["scenario"] == "t8"
    today = data.today_hk()
    for day in body["days"]:  # the storm covers the coming days, then passes
        ahead = (date.fromisoformat(day["date"]) - today).days
        assert day["no_go"] == (["TC8NE"] if ahead <= SCENARIO_DAYS else [])
    assert body["days"][0]["sunset"] == "18:02"
    # Looking at the forecast on the home screen must not count as the agent's weather/daylight checks.
    assert not s.ledger.weather_dates and not s.ledger.sunset and not s.ledger.no_go


def test_conditions_for_an_unknown_session_do_not_create_it(client_and_sessions):
    client, sessions = client_and_sessions
    body = client.get("/conditions", params={"session": "never-connected"}).json()
    assert body["scenario"] == "live" and body["days"][1]["max_c"] == 29
    assert body["days"][0]["max_c"] == 33 and body["days"][0]["min_c"] is None  # today's high, read from HKO's prose
    assert sessions.peek("never-connected") is None


@pytest.mark.parametrize("prose, high", [
    ("Mainly fine. The maximum temperature will be around 33 degrees in the urban areas.", 33),
    ("Sunny intervals during the day with a maximum temperature of around 28 degrees.", 28),
    ("Fine with a maximum temperature of 30 degrees.", 30),
    ("Showers.", None),
])
def test_todays_high_is_read_from_every_way_hko_writes_it(prose, high):
    m = _TODAY_MAX.search(prose)
    assert (int(m.group(1)) if m else None) == high


def test_conditions_keep_warnings_when_the_forecast_is_down(client_and_sessions, monkeypatch):
    async def no_forecast(data_type, ttl=600, endpoint="weather.php", **params):
        if data_type == "warnsum":
            return {"WHOT": {"name": "Very Hot Weather Warning", "code": "WHOT", "actionCode": "ISSUE"}}, {}
        if data_type == "SRS":
            return {"fields": ["YYYY-MM-DD", "RISE", "TRAN.", "SET"], "data": []}, {}
        return {}, {}

    monkeypatch.setattr(data, "hko", no_forecast)
    client, _ = client_and_sessions
    body = client.get("/conditions").json()
    assert "WHOT" in body["warnings"] and body["days"][0]["summary"] is None


def test_closures_follow_the_official_list_and_the_scenario(client_and_sessions, monkeypatch):
    async def fake_closures():
        return [{"trail_id": "cty_16", "Name_of_Hiking_Trail": "Fan Lau Country Trail", "Status": "Temporary closed",
                 "Effective_Date": "15.10.2023", "Expected_Expiry_Date": "Until further notice"},
                {"trail_id": "lt_7", "Name_of_Hiking_Trail": "Lantau Trail Section 7 (partial)", "Status": "Temporary diversion"}], {}

    monkeypatch.setattr(data, "closures", fake_closures)
    client, sessions = client_and_sessions
    body = client.get("/closures", params={"session": "s1"}).json()
    assert body["cty_16"]["closed"] and body["cty_16"]["effective"] == "15.10.2023"
    assert not body["lt_7"]["closed"] and body["lt_7"]["diversion"]
    assert "hk_8" not in body
    sessions.get("s1").set_scenario("closure:hk_8")
    assert client.get("/closures", params={"session": "s1"}).json()["hk_8"]["closed"]


def test_chinese_names_are_searchable(client_and_sessions):
    client, _ = client_and_sessions
    hk8 = next(r for r in client.get("/trails").json() if r["id"] == "hk_8")
    assert "龍脊" in hk8["search_zh"] and data.trails()["hk_8"]["name_zh"] in hk8["search_zh"]


def test_weekend_days():
    assert [d.isoformat() for d in _weekend_after(date(2026, 10, 1))] == ["2026-10-01", "2026-10-03", "2026-10-04"]  # Thu
    assert [d.isoformat() for d in _weekend_after(date(2026, 10, 3))] == ["2026-10-03", "2026-10-04", "2026-10-10"]  # Sat


class _FakeKokoro:
    def get_voices(self):
        return ["af_heart", "bf_emma", "ef_dora"]

    def create(self, text, voice, speed, lang):
        assert lang == ("en-gb" if voice.startswith("b") else "en-us")
        return np.zeros(int(tts.SAMPLE_RATE * 0.5), dtype=np.float32), tts.SAMPLE_RATE


def _tts_client(speaker):
    app = FastAPI()
    app.include_router(build_tts_router(speaker))
    return TestClient(app)


def test_tts_reads_with_a_loaded_model_and_caches_clips(tmp_path):
    speaker = tts.Speaker(folder=tmp_path)
    speaker.kokoro, speaker.status = _FakeKokoro(), "ready"
    client = _tts_client(speaker)
    assert client.get("/tts/voices").json() == {"status": "ready", "voices": ["af_heart", "bf_emma"], "default": "af_heart"}
    r = client.get("/tts", params={"text": "Good to go.", "voice": "bf_emma"})
    assert r.status_code == 200 and r.headers["content-type"] == "audio/wav"
    assert r.content[:4] == b"RIFF" and len(r.content) == 44 + tts.SAMPLE_RATE  # 0.5 s of 16-bit mono
    assert client.get("/tts", params={"text": "Good to go.", "voice": "bf_emma"}).content == r.content
    assert len(speaker._clips) == 1
    assert client.get("/tts", params={"text": "Hola", "voice": "ef_dora"}).status_code == 422  # English voices only
    assert client.get("/tts", params={"text": "x" * (tts.MAX_CHARS + 1)}).status_code == 422


def test_tts_serves_byte_ranges_for_the_apps_audio_player(tmp_path):
    """AVPlayer probes with HEAD and `Range: bytes=0-1` and refuses a server that answers a range with 200."""
    speaker = tts.Speaker(folder=tmp_path)
    speaker.kokoro, speaker.status = _FakeKokoro(), "ready"
    client = _tts_client(speaker)
    params = {"text": "Good to go.", "voice": "af_heart"}
    whole = client.get("/tts", params=params)
    size = len(whole.content)
    assert whole.headers["accept-ranges"] == "bytes"
    head = client.head("/tts", params=params)
    assert head.status_code == 200 and head.headers["content-length"] == str(size) and not head.content
    probe = client.get("/tts", params=params, headers={"Range": "bytes=0-1"})
    assert probe.status_code == 206 and probe.content == whole.content[:2] and probe.headers["content-range"] == f"bytes 0-1/{size}"
    tail = client.get("/tts", params=params, headers={"Range": "bytes=100-"})
    assert tail.status_code == 206 and tail.content == whole.content[100:] and tail.headers["content-range"] == f"bytes 100-{size - 1}/{size}"
    suffix = client.get("/tts", params=params, headers={"Range": "bytes=-44"})
    assert suffix.status_code == 206 and suffix.content == whole.content[-44:]
    past = client.get("/tts", params=params, headers={"Range": f"bytes={size}-"})
    assert past.status_code == 416 and past.headers["content-range"] == f"bytes */{size}"
    assert client.get("/tts", params=params, headers={"Range": "chunks=1-2"}).status_code == 200  # not bytes: the whole clip
    assert len(speaker._clips) == 1  # every probe is served from the one synthesised clip


def test_tts_is_unavailable_until_the_model_loads(tmp_path):
    client = _tts_client(tts.Speaker(folder=tmp_path))
    r = client.get("/tts", params={"text": "Good to go."})
    assert r.status_code == 503 and "idle" in r.json()["detail"]
    assert client.get("/tts/voices").json()["voices"] == []


def test_a_failed_model_download_is_reported_not_raised(tmp_path, monkeypatch):
    def broken(*_, **__):
        raise OSError("offline")

    monkeypatch.setattr(tts, "fetch", broken)
    speaker = tts.Speaker(folder=tmp_path)
    speaker.load()
    assert speaker.kokoro is None and speaker.status == "failed: offline"
