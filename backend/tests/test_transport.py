"""Nearest bus stops, on a tiny fake dataset (no network, no GTFS)."""

from app.transport import distance_m, nearest_stops, route_label

ORIGIN = (22.0, 114.0)
# 0.001 degrees of latitude is about 111 m
STOPS = [
    {"name": "FAR", "name_zh": "遠", "lat": 22.06, "lng": 114.0, "routes": ["1"]},  # ~6.7 km
    {"name": "B", "name_zh": "乙", "lat": 22.003, "lng": 114.0, "routes": ["20", "3"]},  # ~330 m
    {"name": "A", "name_zh": "甲", "lat": 22.001, "lng": 114.0, "routes": ["9"]},  # ~110 m
    {"name": "C", "name_zh": "丙", "lat": 22.006, "lng": 114.0, "routes": ["X1"]},  # ~670 m
    {"name": "D", "name_zh": "丁", "lat": 22.008, "lng": 114.0, "routes": ["5"]},  # ~890 m
    {"name": "EMPTY", "name_zh": "空", "lat": 22.0001, "lng": 114.0, "routes": []},  # nothing serves it
]


def test_route_labels_keep_numbers_and_drop_named_coaches():
    assert route_label("9", "CTB") == "9"
    assert route_label("9A", "GMB") == "GMB 9A"
    assert route_label("Kwun Tong - Huanggang", "XB") is None


def test_distance_is_metres():
    assert 110 < distance_m(ORIGIN, (22.001, 114.0)) < 112


def test_three_nearest_within_5km_nearest_first():
    out = nearest_stops(ORIGIN, STOPS)
    assert [s["name"] for s in out] == ["A", "B", "C"]
    assert [s["distance_m"] for s in out] == [110, 330, 670]
    assert out[1]["routes"] == ["3", "20"]  # numeric order
    assert out[0]["name_zh"] == "甲"


def test_nothing_in_range_is_empty():
    assert nearest_stops((23.0, 114.0), STOPS) == []


def test_limit_and_cutoff_are_inclusive_of_range_only():
    assert [s["name"] for s in nearest_stops(ORIGIN, STOPS, limit=1)] == ["A"]
    assert "FAR" not in [s["name"] for s in nearest_stops(ORIGIN, STOPS, limit=10)]
    assert "EMPTY" not in [s["name"] for s in nearest_stops(ORIGIN, STOPS, limit=10)]


def test_two_sides_of_a_road_merge_into_one_stop():
    stops = [
        {"name": "ROADSIDE", "name_zh": "路旁", "lat": 22.001, "lng": 114.0, "routes": ["9"]},
        {"name": "ROADSIDE", "name_zh": "路旁", "lat": 22.002, "lng": 114.0, "routes": ["9", "X9"]},
    ]
    out = nearest_stops(ORIGIN, stops)
    assert len(out) == 1
    assert out[0]["distance_m"] == 110
    assert out[0]["routes"] == ["9", "X9"]
