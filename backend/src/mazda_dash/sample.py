"""Generate a synthetic dataset in the same format as the Mazda exports.

Nothing here comes from a real car: the VIN, warning codes, trips and readings are invented
(deterministically, from a seed) so the app can be tried, tested and demonstrated publicly.
The data is shaped to exercise every page and alert rule: a recurring fault, a new fault, a
failed read, a warning spike, a new warning code, a slow tire leak, a burglar-alarm event, a
trip counter that resets, and refuelling.

Each car model has a profile (platform code in the file names, VIN, period, time zone, codes, faults,
diagnostic visits, which signals exist), so the demo can show several models side by side. The CX-5 profile
is the original sample data, byte for byte; the CX-60 profile is another car on purpose.

Usage: python -m mazda_dash.sample <out_dir> [--model cx60] [--seed N]   (writes <out_dir>/<model>/)
"""

import argparse
import csv
import random
import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

TIRE_CLOCK_SIGNALS = (
    "tprsdispyear",
    "tprsdispmonth",
    "tprsdispdate",
    "tprsdisphour",
    "tprsdispminute",
)


@dataclass(frozen=True)
class Profile:
    """Everything that makes one synthetic model different from another."""

    id: str
    platform: str  # in the file names (the real exports carry e.g. 24pf)
    vin: str
    start: datetime
    end: datetime
    ecus: tuple[str, ...]
    warning_codes: tuple[
        tuple[str, float], ...
    ]  # invented codes, with how often they appear
    spike_codes: tuple[str, str]
    new_code: str  # a warning code that only appears in the last drives
    spike_day: date
    heavy_day: date  # one heavy stretch (high consumption)
    alarms: tuple[tuple[datetime, int, int], ...]  # time, burglar status, reason
    recurring_fault: tuple[str, str]  # (ecu, dtc): listed in most read-outs
    transient_fault: tuple[str, str]  # appears, then clears
    new_fault: tuple[
        str, str
    ]  # new in the latest read-out and in the last diagnostic report
    visits: tuple[
        tuple[datetime, dict], ...
    ]  # the diagnostic reports: when, what they show
    timezone: str = "Europe/Lisbon"  # the car's local time (config/models/<id>/settings.yaml says the same)
    start_odo: float = 120.0
    tank_l: float = 56.0
    base_l100: float = 6.8
    leak_wheel: int = 2  # which tire loses pressure: FL, FR, RL, RR
    diag_offset_hours: int = 0  # the diagnostic tool's clock
    oil: bool = True  # does the car send the oil-change countdown?
    extra_signals: tuple[
        str, ...
    ] = ()  # signals this model has that the dashboard does not read
    fuel_currency: str = "EUR"
    # fuel price per litre from a date on (the generator writes them into settings.yaml for the demo)
    fuel_prices: tuple[tuple[date, float], ...] = ()
    seed: int = 7


# Three downloads, each with its own diagnostic report. The counters grow, one fault appears only at the last visit, and the
# monitor results drift a little (but stay inside their limits).
DIAG_VISITS = (
    (
        datetime(2026, 4, 15, 10, 0),
        {"faults": False, "mv": 301.2, "g": 2.15, "lpk": 7.05},
    ),
    (
        datetime(2026, 5, 20, 10, 0),
        {"faults": False, "mv": 302.8, "g": 2.31, "lpk": 6.92},
    ),
    (
        datetime(2026, 6, 30, 10, 0),
        {"faults": True, "mv": 304.5, "g": 2.45, "lpk": 6.8},
    ),
)

CX5 = Profile(
    id="cx5",
    platform="sample",
    vin="SAMPLEVIN00000001",
    start=datetime(2026, 3, 1),
    end=datetime(2026, 6, 30),
    ecus=("BCM", "ECM", "ADU", "DCM", "IC", "EPS", "DSC", "CGW"),
    # Invented codes: the ids only mimic the format of the real ones.
    warning_codes=(
        ("$201", 0.95),
        ("$2B7", 0.30),
        ("$1C4", 0.10),
        ("$3A0", 0.05),
        ("$0F2", 0.015),
    ),
    spike_codes=("$1C4", "$201"),
    new_code="$4E9",
    spike_day=datetime(2026, 6, 12).date(),
    heavy_day=datetime(2026, 6, 6).date(),
    alarms=(
        (datetime(2026, 4, 9, 8, 40), 1, 0),
        (datetime(2026, 6, 22, 21, 14), 5, 5),
        (datetime(2026, 6, 22, 21, 14, 12), 1, 0),
    ),
    recurring_fault=("BCM", "U0198:00"),
    transient_fault=("DCM", "U3000:00"),
    new_fault=("ADU", "C1B22:87"),
    visits=DIAG_VISITS,
    fuel_prices=(
        (date(2026, 3, 1), 1.72),
        (date(2026, 5, 15), 1.81),
    ),  # a price change inside the data
)

# Another car on purpose: other platform code, VIN, period, time zone (and diagnostic tool clock), consumption,
# tank, leaking tire, codes and faults; two diagnostic reports; no oil-change countdown; two signals the
# CX-5 lacks. It lets the demo, the tests and `make compat` show what differing models look like.
CX60 = Profile(
    id="cx60",
    platform="sample60",
    vin="SAMPLEVIN00000002",
    start=datetime(2026, 4, 10),
    end=datetime(2026, 7, 31),
    ecus=("BCM", "ECM", "ADU", "DCM", "IC", "EPS", "DSC", "TCM"),
    warning_codes=(
        ("$301", 0.90),
        ("$3B2", 0.35),
        ("$2D1", 0.12),
        ("$1A7", 0.06),
        ("$0C9", 0.02),
    ),
    spike_codes=("$2D1", "$301"),
    new_code="$5F3",
    spike_day=datetime(2026, 7, 14).date(),
    heavy_day=datetime(2026, 7, 4).date(),
    alarms=(
        (datetime(2026, 5, 18, 9, 10), 1, 0),
        (datetime(2026, 7, 19, 2, 31), 5, 5),
        (datetime(2026, 7, 19, 2, 31, 12), 1, 0),
    ),
    recurring_fault=("BCM", "B1A04:00"),
    transient_fault=("TCM", "U1100:00"),
    new_fault=("DSC", "C1A50:87"),
    visits=(
        (
            datetime(2026, 6, 1, 10, 0),
            {"faults": False, "mv": 300.9, "g": 2.20, "lpk": 7.90},
        ),
        (
            datetime(2026, 7, 31, 10, 0),
            {"faults": True, "mv": 303.1, "g": 2.38, "lpk": 7.75},
        ),
    ),
    timezone="Europe/Berlin",
    start_odo=45.0,
    tank_l=58.0,
    base_l100=7.9,
    leak_wheel=0,
    diag_offset_hours=2,
    oil=False,
    extra_signals=("sample60_drivemode", "sample60_cabintemp"),
    fuel_prices=(
        (date(2026, 4, 10), 1.79),
    ),  # one price, written in the single-price form
    seed=11,
)
PROFILES = {p.id: p for p in (CX5, CX60)}
VIN = CX5.vin  # the CX-5 sample's VIN (tests)
SAFE_VINS = tuple(p.vin for p in PROFILES.values())


def _z(t: datetime) -> str:
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def _n(t: datetime) -> str:
    return t.strftime("%Y-%m-%d %H:%M:%S")


def _write(path: Path, header: list[str], rows: list[list]) -> None:
    with path.open("w", newline="") as f:
        # LF, not csv's default CRLF: git stores these files with LF, so CRLF made them look changed
        # on machines that do not convert line endings (CI)
        w = csv.writer(f, quoting=csv.QUOTE_ALL, lineterminator="\n")
        w.writerow(header)
        w.writerows(rows)


class Car:
    """Simulated state that the exports are derived from."""

    def __init__(self, rng: random.Random, p: Profile):
        self.rng = rng
        self.p = p
        self.odo = p.start_odo
        self.fuel_pct = 85.0
        self.trip_km = self.trip_fuel = self.trip_s = 0.0
        self.tires = [240.0, 240.0, 240.0, 240.0]  # FL, FR, RL, RR
        self.tire_warning = [False] * 4  # the car's own warning flag per wheel
        self.tire_measured = p.start - timedelta(
            hours=1
        )  # when the car last measured the tires (UTC)
        self.events: list[
            tuple[datetime, float]
        ] = []  # (time, odometer) of every drive end

    def drive(self, start: datetime, km: float, l100: float) -> datetime:
        seconds = km / self.rng.uniform(38, 68) * 3600
        end = start + timedelta(seconds=seconds)
        fuel = km * l100 / 100
        self.odo += km
        self.trip_km += km
        self.trip_fuel += fuel
        self.trip_s += seconds
        self.fuel_pct -= fuel / self.p.tank_l * 100
        self.events.append((end, self.odo))
        # the car measured the tires 2-41 minutes before the drive ended (from the clock: no random numbers)
        self.tire_measured = end - timedelta(minutes=2 + end.minute * 3 % 40)
        return end

    def reset_trip(self) -> None:
        self.trip_km = self.trip_fuel = self.trip_s = 0.0

    def row(self, t: datetime) -> dict[str, float | int]:
        # same order as before the flags existed, so the random stream (and the rest of the data) is unchanged
        tires = [self.tire(i, t) for i in range(4)]
        l100 = self.trip_fuel / self.trip_km * 100 if self.trip_km > 0 else 102.2
        return {
            "ododispvalue": round(self.odo, 1),
            "drv1avlfuele": round(100 / l100, 3) if self.trip_km > 0 else 0.0,
            "drv1avlfuelg": round(l100, 1),
            "drv1drvtm": int(self.trip_s),
            "drv1distnc": round(self.trip_km, 3),
            "enginestate": 10 if self.trip_km > 0 else 3,
            "fuelsegementdactl": round(self.fuel_pct, 1),
            "smaphremdrvdistnum": int(self.fuel_pct / 100 * self.p.tank_l / 6.9 * 100),
            "fltprsdispkp": tires[0],
            "frtprsdispkp": tires[1],
            "rltprsdispkp": tires[2],
            "rrtprsdispkp": tires[3],
            **(self.oil(t) if self.p.oil else {}),
            **self.car_warnings(tires),
            **self.tire_clock(t),
            **self.lamp_flags(t),
            **self.extras(),
        }

    def extras(self) -> dict[str, float]:
        """Signals only this model has (from the odometer: no random numbers, so nothing else shifts)."""
        return {
            s: round((self.odo * (k + 3)) % 97 / 10, 1)
            for k, s in enumerate(self.p.extra_signals)
        }

    def lamp_flags(self, t: datetime) -> dict[str, int]:
        """A few of the car's 128 warning-lamp bit flags (plain columns, no validity flag, as in the real
        export): two that never change, one that is on in the mornings, two that come on only on the days
        diagnostic reports were taken, and one that appears for the first time in the last days. Derived
        from the clock only (no random numbers)."""
        report_day = t.date() in {when.date() for when, _ in self.p.visits}
        return {
            "vdt_2_warningpt_1_0": 0,  # constant: never listed by the dashboard
            "vdt_7_warningbody_1_1": 0,
            "vdt_7_warningbody_1_30": int(t.hour < 12),
            "vdt_2_warningpt_1_23": int(report_day),
            "vdt_2_warningpt_2_46": int(report_day and t.hour < 12),
            "vdt_7_warningbody_2_44": int(t >= self.p.end - timedelta(days=2)),
        }

    def tire_clock(self, t: datetime) -> dict[str, int | None]:
        """When the tires were last measured, as the car sends it: five numbers in LOCAL time. Snapshots
        taken a long time after the last drive show an old measurement (stale). Now and then the car
        sends no time (Invalid), chosen from the clock like the oil dropouts."""
        if int((t - datetime(1970, 1, 1)).total_seconds()) % 53 == 35:
            return dict.fromkeys(TIRE_CLOCK_SIGNALS)
        local = self.tire_measured.replace(tzinfo=UTC).astimezone(
            ZoneInfo(self.p.timezone)
        )
        return dict(
            zip(
                TIRE_CLOCK_SIGNALS,
                (local.year, local.month, local.day, local.hour, local.minute),
            )
        )

    def car_warnings(self, tires: list[int]) -> dict[str, int]:
        """The car's own warning flags: all clear except the rear left tire, which the car flags once
        the slow leak has taken it below 210 kPa. Like a real warning it stays on until the pressure
        is back above 225 kPa (no flicker around the limit). No random numbers are used."""
        for i, kpa in enumerate(tires):
            if kpa < 210:
                self.tire_warning[i] = True
            elif kpa >= 225:
                self.tire_warning[i] = False
        return {
            "fltyrepresswarn": int(self.tire_warning[0]),
            "frtyrepresswarn": int(self.tire_warning[1]),
            "rltyrepresswarn": int(self.tire_warning[2]),
            "rrtyrepresswarn": int(self.tire_warning[3]),
            "tpmsstatus": 0,
            "tpmssystemflt": 0,
            "oillevelwarning": 0,
            "seatbeltwrndrq": 0,
        }

    def oil(self, t: datetime) -> dict[str, float | int | None]:
        """The car's oil countdown: 5,000 km after the last service (at 0 km), shown in 1,000 km steps.
        Like the real car it sometimes sends 65535 (unknown) or an Invalid reading; chosen from the
        clock, not the random generator, so the rest of the sample data stays as it was."""
        left = max(0, 5000 - int(self.odo // 1000) * 1000)
        second = int(
            (t - datetime(1970, 1, 1)).total_seconds()
        )  # t is naive UTC: not timestamp(), which uses the machine's time zone
        if second % 29 == 0:
            return {"remoildistk": 65535, "remoildistm": 65535}
        if second % 41 == 1:
            return {
                "remoildistk": None,
                "remoildistm": None,
            }  # written as an Invalid reading
        return {"remoildistk": left, "remoildistm": round(left * 0.621371 / 100) * 100}

    def tire(self, i: int, t: datetime) -> int:
        value = self.tires[i] + self.rng.choice([-5, 0, 0, 5])
        if i == self.p.leak_wheel:  # slow leak over the last three weeks
            days_left = (self.p.end - t).days
            if days_left < 21:
                value -= (21 - days_left) * 2.4
        return int(round(value / 5) * 5)


def build_drives(rng: random.Random, p: Profile) -> tuple[Car, list[dict]]:
    car = Car(rng, p)
    rows: list[dict] = []
    day = p.start
    while day <= p.end:
        weekend = day.weekday() >= 5
        plans = []
        if not weekend and rng.random() < 0.9:
            plans += [(7.5, rng.uniform(10, 24)), (17.5, rng.uniform(10, 24))]
        if weekend and rng.random() < 0.7:
            plans.append((10.5, rng.uniform(25, 150)))
        if day.date() == p.heavy_day:
            plans.append((14.0, 60.0))  # one heavy stretch (high consumption)
        for hour, km in plans:
            start = day + timedelta(hours=hour + rng.uniform(-0.4, 0.4))
            if car.trip_km > rng.uniform(380, 650):
                car.reset_trip()
                rows.append({"at": start - timedelta(minutes=2), **car.row(start)})
            l100 = rng.gauss(p.base_l100, 0.5) + (7.5 if km == 60.0 else 0)
            if km < 15:
                l100 += 0.8  # short city trips use more
            end = car.drive(start, km, max(5.2, l100))
            if car.fuel_pct < 14:
                car.fuel_pct = rng.uniform(88, 100)
            rows.append({"at": end + timedelta(seconds=10), **car.row(end)})
        day += timedelta(days=1)
    return car, rows


def plain_signals(signals: list[str]) -> list[str]:
    """Signals the real export writes as a plain column (no `_value` / `_validstatus` pair)."""
    return [s for s in signals if s.startswith("vdt_")]


def write_status(out: Path, rows: list[dict], p: Profile) -> None:
    signals = [k for k in rows[0] if k != "at"]
    header = [
        "vin",
        "fileid_datetime",
        "requesttype",
        "isinservicemode",
        "datacreationtime",
    ]
    paired = [s for s in signals if s not in plain_signals(signals)]
    plain = plain_signals(signals)
    for s in paired:
        header += [f"{s}_value", f"{s}_validstatus"]
    header += (
        plain  # plain columns without a validity flag (the warning-lamp bit flags)
    )
    header += [
        "latitude",
        "longitude",
    ]  # real exports can carry a position; always empty here
    body = []
    for r in rows:
        line = [
            p.vin,
            _n(r["at"] - timedelta(seconds=11)),
            "RemoteConfirm",
            "false",
            _z(r["at"]),
        ]
        for s in paired:
            line += [r[s], "Valid" if r[s] is not None else "Invalid"]
        line += [r[s] for s in plain]
        body.append(line + ["", ""])
    _write(out / f"all-rts-{p.platform}_rts-{p.platform}.csv", header, body)


def write_doors(out: Path, rng: random.Random, rows: list[dict], p: Profile) -> None:
    signals = [
        "drstatdrv",
        "drstatpsngr",
        "drstatrr",
        "drstatrl",
        "locklinkswdrv",
        "locklinkswpsngr",
        "hazardsw",
        "lghtswstate",
    ]
    header = ["vin", "fileid_datetime", "requesttype", "datacreationtime"]
    for s in signals:
        header += [f"{s}_value", f"{s}_validstatus"]
    header += [
        "dropnwrn_value",
        "dropnwrn_validstatus",
    ]  # the car's door-open warning flag
    body = []
    for r in rows[::2]:
        line = [p.vin, _n(r["at"]), "ForgetInform", _z(r["at"] + timedelta(seconds=12))]
        for s in signals:
            value = {
                "locklinkswdrv": rng.choice([0, 2, 2]),
                "lghtswstate": rng.choice([0, 3]),
            }.get(s, 0)
            line += [
                value,
                "Invalid" if rng.random() < 0.03 and s == "drstatdrv" else "Valid",
            ]
        body.append(
            line + [0, "Valid"]
        )  # door-open warning: all clear (no random numbers used)
    _write(out / f"all-vis-{p.platform}_vis-{p.platform}.csv", header, body)


def write_alarms(out: Path, p: Profile) -> None:
    header = [
        "vin",
        "fileid_datetime",
        "datacreationtime",
        "burglarstatus_value",
        "burglarstatus_validstatus",
        "balarmreasondactl_value",
        "balarmreasondactl_validstatus",
    ]
    body = [
        [p.vin, _n(t), _z(t + timedelta(minutes=5)), s, "Valid", r, "Valid"]
        for t, s, r in p.alarms
    ]
    _write(out / f"all-alt-{p.platform}_alt-{p.platform}.csv", header, body)


def _tx(rng: random.Random) -> str:
    return str(uuid.UUID(int=rng.getrandbits(128), version=4))


def write_warnings(out: Path, rng: random.Random, car: Car, p: Profile) -> None:
    header = [
        "X_TRANSACTION_ID",
        "VIN",
        "COPIED_DT_TM",
        "WARNING_TRIGGER_OCCURRENCE_TM",
        "HOURS",
        "MINUTES",
        "ODO_INFORMATION_KM",
        "WARNING_LIST",
    ]
    body = []

    def event(t: datetime, odo: float, codes: list[str]) -> None:
        body.append(
            [
                _tx(rng),
                p.vin,
                _n(t + timedelta(minutes=rng.randint(20, 90))),
                _z(t),
                1,
                0,
                int(odo),
                ",".join(codes),
            ]
        )

    for end, odo in car.events:
        for _ in range(rng.randint(2, 7)):
            t = end - timedelta(minutes=rng.uniform(0, 25))
            codes = [c for c, prob in p.warning_codes if rng.random() < prob]
            if codes:
                event(t, odo, codes)
    spike_odo = next(o for t, o in car.events if t.date() >= p.spike_day)
    for i in range(48):
        event(
            datetime.combine(p.spike_day, datetime.min.time())
            + timedelta(hours=9, minutes=i * 4),
            spike_odo,
            list(p.spike_codes),
        )
    for end, odo in car.events[-3:]:
        event(end - timedelta(minutes=3), odo, [p.new_code])
    body.sort(key=lambda r: r[3])
    _write(out / f"all-war-{p.platform}_war-{p.platform}.csv", header, body)


SNAPSHOT_SIGNALS = [
    "Global_Real_Time",
    "IG_OnTimer",
    "Time_Since_Engine_Start",
    "Vehicle_Odometer_Information",
    "Main_ECU_Voltage_Supply",
    "ECU_Power_Voltage",
    "SOC_StateOfCharge",
    "Ambient_Air_Temperature",
    "Engine_Coolant_Temperature",
    "Vehicle_Speed",
    "Engine_RPM",
    "Shift_Position",
    "Relative_Accelerator_Pedal_Position",
]
SSR_META = [
    "X_TRANSACTION_ID",
    "VIN",
    "COPIED_DT_TM",
    "DIAGNOSTICS_ACQUISITION_TM",
    "WARNING_TRIGGER_OCCURRENCE_TM",
    "HOURS",
    "MINUTES",
    "ODO_INFORMATION_KM",
    "ECU_NAME_MKT",
    "STATUS_CODE",
    "DISPLAY_DTC",
    "DISPLAY_STATUS",
    "DTC_STATUS_FLAG",
    "DTC_SNAPSHOT_RECORD_NUMBER",
    "Time_UTC_Information_Year",
    "Time_UTC_Information_Month",
    "Time_UTC_Information_Date",
    "Time_UTC_Information_Hour",
    "Time_UTC_Information_Minute",
    "Time_UTC_Information_Second",
]


def fault_schedule(n_readouts: int, p: Profile) -> dict[int, list[tuple[str, str]]]:
    """Which (ecu, DTC) is listed in which read-out."""
    plan: dict[int, list[tuple[str, str]]] = {i: [] for i in range(n_readouts)}
    for i in range(2, n_readouts):
        plan[i].append(
            p.recurring_fault
        )  # recurring, still active in the latest read-out
    for i in range(3, 6):
        plan[i].append(p.transient_fault)  # appears, then clears
    plan[n_readouts - 1].append(p.new_fault)  # brand new in the latest read-out
    return plan


def write_dtcs(out: Path, rng: random.Random, car: Car, p: Profile) -> None:
    readouts = [
        p.start + timedelta(days=7 * i + 4, hours=10)
        for i in range((p.end - p.start).days // 7)
    ]
    plan = fault_schedule(len(readouts), p)
    head, detail, ssr = [], [], []
    for i, when in enumerate(readouts):
        tx = _tx(rng)
        odo = next((o for t, o in car.events if t >= when), car.odo)
        trigger = when - timedelta(minutes=rng.randint(30, 200))
        head.append([tx, p.vin, _n(when), "", _z(trigger), 1, 0, int(odo)])
        for ecu in p.ecus:
            dtc = next((d for e, d in plan[i] if e == ecu), "")
            if ecu == "ECM" and i in (3, 9):
                detail.append(
                    [tx, p.vin, _n(when), 4, ecu, "19 02 8F", "", 4]
                )  # a failed read
            elif dtc:
                detail.append(
                    [
                        tx,
                        p.vin,
                        _n(when),
                        1,
                        ecu,
                        dtc,
                        "28" if ecu == "ADU" else "08",
                        3,
                    ]
                )
            else:
                detail.append([tx, p.vin, _n(when), 1, ecu, "", "", 0])
        for ecu, dtc in plan[i]:
            for rec in ("01", "02") if (ecu, dtc) == p.recurring_fault else ("01",):
                snap = trigger - timedelta(
                    days=rng.randint(0, 3), minutes=rng.randint(0, 600)
                )
                values = {s: round(rng.uniform(0, 100), 2) for s in SNAPSHOT_SIGNALS}
                values.update(
                    Main_ECU_Voltage_Supply=round(rng.uniform(12.2, 14.2), 1),
                    ECU_Power_Voltage=round(rng.uniform(12.0, 13.8), 1),
                    Ambient_Air_Temperature=rng.randint(8, 28),
                    Engine_Coolant_Temperature=rng.randint(20, 92),
                    Vehicle_Speed=rng.choice([0, 0, 35, 62]),
                    Engine_RPM=rng.choice([0, 780, 1900]),
                    Shift_Position=rng.randint(0, 4),
                    SOC_StateOfCharge=rng.randint(40, 90),
                )
                ssr.append(
                    [
                        _tx(rng),
                        p.vin,
                        _n(when),
                        "",
                        _z(trigger),
                        1,
                        0,
                        int(odo),
                        ecu,
                        1,
                        dtc,
                        "28" if ecu == "ADU" else "08",
                        3,
                        rec,
                        snap.year,
                        snap.month,
                        snap.day,
                        snap.hour,
                        snap.minute,
                        snap.second,
                        *values.values(),
                    ]
                )
    _write(
        out / f"all-dtc-h-{p.platform}_dtc-h-{p.platform}.csv",
        [
            "X_TRANSACTION_ID",
            "VIN",
            "COPIED_DT_TM",
            "DIAGNOSTICS_ACQUISITION_TM",
            "WARNING_TRIGGER_OCCURRENCE_TM",
            "HOURS",
            "MINUTES",
            "ODO_INFORMATION_KM",
        ],
        head,
    )
    _write(
        out / f"all-dtc-d-{p.platform}_dtc-d-{p.platform}.csv",
        [
            "X_TRANSACTION_ID",
            "VIN",
            "COPIED_DT_TM",
            "STATUS_CODE",
            "ECU_NAME_MKT",
            "DISPLAY_DTC",
            "DISPLAY_STATUS",
            "DTC_STATUS_FLAG",
        ],
        detail,
    )
    _write(
        out / f"all-dtc-ssr-{p.platform}_dtc-ssr-{p.platform}.csv",
        SSR_META + SNAPSHOT_SIGNALS,
        ssr,
    )


def diag_text(
    when: datetime,
    odo: float,
    faults: bool,
    mv: float,
    g: float,
    lpk: float,
    p: Profile = CX5,
) -> str:
    km = odo - p.start_odo
    ecu, code = p.new_fault
    shown = when + timedelta(
        hours=p.diag_offset_hours
    )  # the tool writes its own local time
    fuel = km * lpk / 100
    ignitions = 40 + int(km / 24)
    dtcs = f"ModuleName:{ecu}\n{code}-28\n" if faults else f"ModuleName:{ecu}\n"
    rob = "ModuleName:DCM\nXB2A92:00-28\n" if faults else "ModuleName:DCM\n"
    snapshot = (
        f"""SnapshotData
ModuleName:{ecu}
DTC:{code}-28
RecordNumber:01
APP:12.5 %
ODOMETER:{odo - 3:.1f} km
VSS:48 km/h
VPWR:13.1 V
AMB_TEMP:21 ℃
ECT:88 ℃
ENG_RPM:1900 RPM
POWER_MODE:ON
SHIFT_POS:Drive
"""
        if faults
        else ""
    )
    return f"""Collect Diagnostic Information

Date:{shown:%Y/%m/%d}
Time:{shown:%H:%M:%S}
TimeZone:UTC+{p.diag_offset_hours:02d}00


ODO:{int(odo)}km

Mode 9
ModuleName:ECM
VIN   {p.vin}
CALID   SAMPLECALID000000
CVN   0000000000000000000000000000000000000000
IPT
   (OBDCOND) = 120
   (IGNCNTR) = {ignitions}
   (CATCOMP1) = 150
ECUNAME   ECM-EngineControl
TG/EFN
VOD - Engine Run/Idle Time
   (IGNCNTR_R) = 40
   (IGNCNTR_L) = {ignitions}
   (ERT_R) = 52000 s
   (ERT_L) = {int(km / 55 * 3600 * 1.2)} s
VOD - Distance/Fuel Used
   (DT_R) = 780.0 km
   (DT_L) = {km:.1f} km
   (FC_R) = 53.04 l
   (FC_L) = {fuel:.2f} l
AAF #1 OCC Vehicle Data
   (AAF1_TIME1_R) = 4294967295 s
   (AAF1_TIME1_L) = 120 s
AES ID and Status
   (AESIDx) = 1814
   (AESIDx_Activity_State) = Not Active
   (AESIDx) = 181A
   (AESIDx_Activity_State) = Not Active
Mode 9 Workaround



dtcs
{dtcs}
Rob_dtcs
{rob}
{snapshot}Mode 6
ModuleName:ECM
OBDMID: 1, Test: 80, Min: 0.000, Max: 1.000, Value: 0.000
OBDMID: 2, Test: 3, Min: 300.000 mV, Max: 310.000 mV, Value: {mv:.3f} mV
OBDMID: 21, Test: 82, Min: 0.89 g, Max: 655.35 g, Value: {g:.2f} g
OBDMID: 42, Test: 80, Min: 5 Ohm, Max: 450 Ohm, Value: 100 Ohm
"""


def write_diag(out: Path, car: Car, p: Profile) -> None:
    for when, extra in p.visits:
        # odometer when the report was made: after the last drive that ended before it
        odo = next((o for t, o in reversed(car.events) if t <= when), p.start_odo)
        name = f"all-{p.platform}-diag-tool_{p.platform}-diag-tool_1_{when:%Y%m%d_%H%M%S}.txt"
        (out / name).write_text(diag_text(when, odo, **extra, p=p))


def settings_text(p: Profile) -> str:
    """The demo car's settings file, kept next to its exports: the demo must not depend on (or change) the
    settings in config/models/<id>/, which belong to the real car."""
    lines = [
        f"# Settings of the synthetic {p.id} car (the demo ingests the sample data with this file).",
        f"car_timezone: {p.timezone}",
        "tire_stale_hours: 6",
        f"fuel_currency: {p.fuel_currency}",
    ]
    if len(p.fuel_prices) == 1:
        lines.append(f"fuel_price_per_l: {p.fuel_prices[0][1]}")
    else:
        lines.append("fuel_prices:")
        lines += [
            f"  - {{from: {day.isoformat()}, per_l: {price}}}"
            for day, price in p.fuel_prices
        ]
    return "\n".join(lines) + "\n"


def generate(out: Path, seed: int | None = None, profile: Profile = CX5) -> None:
    out.mkdir(parents=True, exist_ok=True)
    (out / "settings.yaml").write_text(settings_text(profile))
    rng = random.Random(profile.seed if seed is None else seed)
    car, status = build_drives(rng, profile)
    write_status(out, status, profile)
    write_doors(out, rng, status, profile)
    write_alarms(out, profile)
    write_warnings(out, rng, car, profile)
    write_dtcs(out, rng, car, profile)
    write_diag(out, car, profile)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "out", type=Path, help="parent folder: each model goes in <out>/<model>/"
    )
    ap.add_argument(
        "--model", choices=list(PROFILES), help="only this model (default: all)"
    )
    ap.add_argument("--seed", type=int, help="replaces the model's own seed")
    args = ap.parse_args()
    for profile in [PROFILES[args.model]] if args.model else PROFILES.values():
        generate(args.out / profile.id, args.seed, profile)
        print(f"sample data for {profile.id} written to {args.out / profile.id}")


if __name__ == "__main__":
    main()
