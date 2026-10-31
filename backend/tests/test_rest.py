"""REST helpers for the app's browse screens (no network: HKO feeds are stubbed)."""

from datetime import date, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.agent.harness import build_toolbox
from app.agent.session import SessionStore
from app.rest import _TODAY_MAX, _weekend_after, build_router
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
