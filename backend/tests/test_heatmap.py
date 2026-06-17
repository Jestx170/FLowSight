"""Tests for HeatMapEngine — heat accumulation, decay, zone scoring, and the
end-of-session report (the path that was producing all-0.0 reports).

Decay is wall-clock based, so every update() is given an explicit `now` to keep
these deterministic and fast.
"""
import json

import numpy as np
import pytest

from src.utils.heatmap import HeatMapEngine


def _rect(x1, y1, x2, y2):
    """Axis-aligned rectangle polygon in the engine's pixel space."""
    return np.array([[x1, y1], [x2, y1], [x2, y2], [x1, y2]], dtype=np.int32)


def _deposit(engine, center, frames=12, step=0.2):
    """Drop a person at `center` for several frames so heat accumulates."""
    for i in range(frames):
        engine.update([{"center": center}], now=i * step)


def test_update_deposits_heat():
    e = HeatMapEngine(width=200, height=200, half_life_sec=0)
    assert e._heat.max() == 0
    _deposit(e, (100, 100), frames=3)
    assert e._heat.max() > 0


def test_cumulative_engine_does_not_decay():
    # half_life_sec=0 is the cumulative engine used for the saved report.
    e = HeatMapEngine(width=100, height=100, half_life_sec=0)
    _deposit(e, (50, 50), frames=5)
    peak = e._heat.max()
    # Ten minutes pass with nobody present — cumulative heat must NOT fade.
    e.update([], now=600.0)
    assert e._heat.max() == pytest.approx(peak)


def test_live_engine_decays_over_one_half_life():
    e = HeatMapEngine(width=100, height=100, half_life_sec=20.0)
    e.update([{"center": (50, 50)}], now=0.0)
    e.update([{"center": (50, 50)}], now=0.5)
    peak = e._heat.max()
    # One half-life later with an empty frame → heat roughly halves (not zero).
    e.update([], now=20.5)
    assert 0 < e._heat.max() < peak * 0.6


def test_get_top_zones_ranks_by_mass_with_real_values():
    e = HeatMapEngine(width=200, height=200, half_life_sec=0)
    # Busy zone gets a person every frame; quiet zone only every other frame.
    for i in range(12):
        people = [{"center": (40, 40)}]
        if i % 2 == 0:
            people.append({"center": (160, 160)})
        e.update(people, now=i * 0.2)

    zones = {
        "busy": {"poly": _rect(10, 10, 70, 70), "name": "Entrance"},
        "quiet": {"poly": _rect(130, 130, 190, 190), "name": "Corner"},
    }
    top = e.get_top_zones(zones)
    assert [z["zone_id"] for z in top] == ["busy", "quiet"]
    assert top[0]["mass"] > top[1]["mass"] > 0
    assert top[0]["density"] > 0


def test_get_top_zones_skips_degenerate_polygons():
    e = HeatMapEngine(width=100, height=100, half_life_sec=0)
    _deposit(e, (50, 50))
    zones = {
        "ok": {"poly": _rect(20, 20, 80, 80), "name": "Z"},
        "line": {"poly": np.array([[0, 0], [10, 10]], dtype=np.int32), "name": "bad"},
        "none": {"poly": None, "name": "missing"},
    }
    top = e.get_top_zones(zones)
    assert [z["zone_id"] for z in top] == ["ok"]


def test_generate_report_yields_real_values(tmp_path):
    # The regression this guards: reports used to come out all-0.0 because the
    # live (decaying) engine had faded. The report reads the cumulative engine.
    e = HeatMapEngine(width=200, height=200, half_life_sec=0)
    _deposit(e, (50, 50), frames=15)

    zones = {"z1": {"poly": _rect(20, 20, 90, 90), "name": "Aisle 1"}}
    report = e.generate_report(zones, out_dir=str(tmp_path))

    assert report["zone_count"] == 1
    z = report["zones"][0]
    assert z["name"] == "Aisle 1"
    assert z["mass"] > 0
    assert z["density"] > 0

    saved_path = tmp_path / report["file"].split("/")[-1]
    assert saved_path.exists()
    saved = json.loads(saved_path.read_text(encoding="utf-8"))
    assert saved["zones"][0]["mass"] == z["mass"]
    # No frame passed → no image key.
    assert "image" not in report


def test_generate_report_saves_image_when_frame_given(tmp_path):
    e = HeatMapEngine(width=120, height=120, half_life_sec=0)
    _deposit(e, (60, 60), frames=10)
    frame = np.zeros((120, 120, 3), dtype=np.uint8)

    zones = {"z1": {"poly": _rect(20, 20, 100, 100), "name": "Z"}}
    report = e.generate_report(zones, out_dir=str(tmp_path), frame=frame)

    assert report["image"].endswith(".jpg")
    assert (tmp_path / report["image"]).exists()


def test_reset_clears_heat():
    e = HeatMapEngine(width=50, height=50, half_life_sec=0)
    _deposit(e, (25, 25), frames=4)
    assert e._heat.max() > 0
    e.reset()
    assert e._heat.max() == 0
