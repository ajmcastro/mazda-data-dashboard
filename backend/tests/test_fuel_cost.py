"""The estimated fuel cost (PLAN.md M33): settings, the price table, and the figures built from them."""

from datetime import date
from pathlib import Path

import duckdb
import pytest
from fastapi.testclient import TestClient

from mazda_dash.api.app import app
from mazda_dash.ingest import ingest
from mazda_dash.model.settings import load_settings
from mazda_dash.pack import TABLES
from mazda_dash.sample import PROFILES, generate

REPO = Path(__file__).parents[2]


def settings(tmp_path, text: str):
    path = tmp_path / "settings.yaml"
    path.write_text(text)
    con = duckdb.connect()
    values = load_settings(con, path)
    return con, values


def prices(con):
    return con.execute(
        "SELECT valid_from, per_l FROM ref_fuel_prices ORDER BY valid_from"
    ).fetchall()


def test_no_price_means_no_cost_and_an_empty_table(tmp_path):
    con, values = settings(tmp_path, "car_timezone: Europe/Lisbon\n")
    assert prices(con) == [] and "fuel_currency" not in values
    con, values = settings(tmp_path, "# only comments\ncar_timezone: UTC\n")
    assert prices(con) == []


def test_the_shipped_settings_of_every_model_are_valid():
    """Whatever price the owner has set, the files in the repository must load (and a price needs its currency)."""
    for model in ("cx5", "cx60"):
        con = duckdb.connect()
        values = load_settings(
            con, REPO / "config" / "models" / model / "settings.yaml"
        )
        assert (len(prices(con)) > 0) == ("fuel_currency" in values), model


def test_one_price_applies_to_all_the_data(tmp_path):
    con, values = settings(tmp_path, "fuel_currency: EUR\nfuel_price_per_l: 1.75\n")
    assert (
        prices(con) == [(date(1970, 1, 1), 1.75)] and values["fuel_currency"] == "EUR"
    )


def test_a_price_history_is_read_in_order_and_each_price_holds_until_the_next(tmp_path):
    con, _ = settings(
        tmp_path,
        "fuel_currency: GBP\nfuel_prices:\n  - {from: 2026-03-01, per_l: 1.72}\n  - {from: '2026-05-15', per_l: 1.81}\n",
    )
    assert prices(con) == [(date(2026, 3, 1), 1.72), (date(2026, 5, 15), 1.81)]


@pytest.mark.parametrize(
    ("text", "message"),
    [
        ("fuel_price_per_l: 1.75\n", "fuel_currency .* is required with a fuel price"),
        (
            "fuel_currency: euro\nfuel_price_per_l: 1.75\n",
            "fuel_currency .* is required",
        ),
        ("fuel_currency: EUR\n", "fuel_currency without a fuel price"),
        (
            "fuel_currency: EUR\nfuel_price_per_l: 0\n",
            "fuel_price_per_l must be a number above 0",
        ),
        ("fuel_currency: EUR\nfuel_price_per_l: -1.5\n", "above 0"),
        ("fuel_currency: EUR\nfuel_price_per_l: cheap\n", "must be a number"),
        ("fuel_currency: EUR\nfuel_price_per_l: true\n", "must be a number"),
        (
            "fuel_currency: EUR\nfuel_price_per_l: 1.7\nfuel_prices: []\n",
            "either fuel_prices or fuel_price_per_l",
        ),
        ("fuel_currency: EUR\nfuel_prices: []\n", "fuel_prices must be a list"),
        (
            "fuel_currency: EUR\nfuel_prices: [1.7]\n",
            "entry 1 must have exactly `from` and `per_l`",
        ),
        (
            "fuel_currency: EUR\nfuel_prices:\n  - {from: 2026-01-01}\n",
            "exactly `from` and `per_l`",
        ),
        (
            "fuel_currency: EUR\nfuel_prices:\n  - {from: soon, per_l: 1.7}\n",
            "`from` must be a date",
        ),
        (
            "fuel_currency: EUR\nfuel_prices:\n  - {from: 2026-05-01, per_l: 1.7}\n  - {from: 2026-04-01, per_l: 1.8}\n",
            "increasing order",
        ),
        (
            "fuel_currency: EUR\nfuel_prices:\n  - {from: 2026-05-01, per_l: 1.7}\n  - {from: 2026-05-01, per_l: 1.8}\n",
            "one entry per date",
        ),
        ("fuel_cost: 1\n", "unknown setting"),
    ],
)
def test_a_wrong_price_setting_is_an_error_that_names_the_file(tmp_path, text, message):
    with pytest.raises(ValueError, match=message) as e:
        settings(tmp_path, text)
    assert "settings.yaml" in str(e.value)


@pytest.fixture(scope="module")
def demo(tmp_path_factory):
    """Both sample cars ingested with their own demo settings (the CX-5 price changes on 15 May)."""
    root = tmp_path_factory.mktemp("cost")
    out = {}
    for pid, profile in PROFILES.items():
        data = root / pid
        generate(data, profile=profile)
        db = root / f"{pid}.duckdb"
        ingest(
            data, db, REPO / "config" / "models" / pid / "codes", data / "settings.yaml"
        )
        out[pid] = db
    # the same CX-5 data without any price
    bare = (
        root / "bare-settings.yaml"
    )  # explicit: the real settings may hold the owner's prices
    bare.write_text("car_timezone: Europe/Lisbon\n")
    ingest(
        root / "cx5",
        root / "noprice.duckdb",
        REPO / "config" / "models" / "cx5" / "codes",
        bare,
    )
    out["noprice"] = root / "noprice.duckdb"
    return out


def monthly(db: Path, **params):
    mp = pytest.MonkeyPatch()
    mp.setenv("MAZDA_DB", str(db))
    try:
        r = TestClient(app).get("/api/trends/monthly", params=params)
        assert r.status_code == 200
        return {m["month"]: m for m in r.json()}
    finally:
        mp.undo()


def test_each_price_holds_until_the_next_and_the_earliest_also_applies_before_its_date(
    demo,
):
    con = duckdb.connect(str(demo["cx5"]), read_only=True)
    spans = con.execute(
        "SELECT valid_from, valid_to, per_l FROM v_fuel_prices ORDER BY per_l"
    ).fetchall()
    assert spans == [
        (date(1, 1, 1), date(2026, 5, 15), 1.72),
        (date(2026, 5, 15), None, 1.81),
    ]
    one = duckdb.connect(str(demo["cx60"]), read_only=True)
    assert one.execute(
        "SELECT valid_from, valid_to, per_l FROM v_fuel_prices"
    ).fetchall() == [(date(1, 1, 1), None, 1.79)]
    assert duckdb.connect(str(demo["noprice"]), read_only=True).execute(
        "SELECT count(*) FROM v_fuel_prices"
    ).fetchone() == (0,)


def test_the_price_in_force_on_each_trip_is_used(demo):
    months = monthly(demo["cx5"])
    for month, m in months.items():
        assert m["currency"] == "EUR"
        l100 = m["l_per_100km"]
        low, high = l100 * 1.72, l100 * 1.81
        if month in ("2026-03", "2026-04"):
            assert m["cost_per_100km"] == pytest.approx(low, abs=0.02), (
                month
            )  # all at the first price
        elif month == "2026-06":
            assert m["cost_per_100km"] == pytest.approx(high, abs=0.02), (
                month
            )  # all at the second
        else:  # May: the price changes on the 15th, so the month sits between the two
            assert low + 0.02 < m["cost_per_100km"] < high - 0.02, month
        # total = distance x cost per km, like the estimated litres are distance x consumption
        assert m["fuel_cost_est"] == pytest.approx(
            m["distance_km"] * m["cost_per_100km"] / 100, rel=0.01
        )


def test_a_single_price_is_the_same_in_every_month(demo):
    for m in monthly(demo["cx60"]).values():
        if m.get("l_per_100km") is not None:
            assert m["cost_per_100km"] == pytest.approx(
                m["l_per_100km"] * 1.79, abs=0.02
            )
            assert m["currency"] == "EUR"


def test_without_a_price_there_is_no_cost_and_no_currency(demo):
    for m in monthly(demo["noprice"]).values():
        assert m.get("currency") is None
        assert m.get("cost_per_100km") is None and m.get("fuel_cost_est") is None
        assert m["l_per_100km"] is not None  # the consumption itself is untouched


def test_the_period_is_honoured(demo):
    june = monthly(demo["cx5"], **{"from": "2026-06-01", "to": "2026-06-30"})
    assert list(june) == ["2026-06"]
    assert june["2026-06"]["cost_per_100km"] == pytest.approx(
        monthly(demo["cx5"])["2026-06"]["cost_per_100km"]
    )


def overview(db: Path, **params):
    mp = pytest.MonkeyPatch()
    mp.setenv("MAZDA_DB", str(db))
    try:
        return TestClient(app).get("/api/overview", params=params).json()
    finally:
        mp.undo()


def test_the_overview_has_the_period_cost(demo):
    o = overview(demo["cx5"])
    assert o["currency"] == "EUR"
    assert 1.72 < o["cost_per_100km_in_range"] / o["l_per_100km_in_range"] < 1.81
    june = overview(demo["cx5"], **{"from": "2026-06-01", "to": "2026-06-30"})
    assert june["cost_per_100km_in_range"] / june[
        "l_per_100km_in_range"
    ] == pytest.approx(1.81)
    empty = overview(demo["noprice"])
    assert empty["cost_per_100km_in_range"] is None and empty["currency"] is None


def test_the_phone_pack_carries_the_prices():
    assert "ref_fuel_prices" in TABLES
