"""Generate a synthetic dataset in the same format as the Mazda exports.

Nothing here comes from a real car: the VIN, warning codes, trips and readings are invented
(deterministically, from a seed) so the app can be tried, tested and demonstrated publicly.
The data is shaped to exercise every page and alert rule: a recurring fault, a new fault, a
failed read, a warning spike, a new warning code, a slow tire leak, a burglar-alarm event, a
trip counter that resets, and refuelling.

Usage: python -m mazda_dash.sample <out_dir> [--seed N]
"""

import argparse
import csv
import random
import uuid
from datetime import datetime, timedelta
from pathlib import Path

VIN = "SAMPLEVIN00000001"
START = datetime(2026, 3, 1)
END = datetime(2026, 6, 30)
TANK_L = 56.0
ECUS = ["BCM", "ECM", "ADU", "DCM", "IC", "EPS", "DSC", "CGW"]
# Invented codes: the ids only mimic the format of the real ones.
WARNING_CODES = [
    ("$201", 0.95),
    ("$2B7", 0.30),
    ("$1C4", 0.10),
    ("$3A0", 0.05),
    ("$0F2", 0.015),
]
SPIKE_DAY = datetime(2026, 6, 12).date()
NEW_CODE = "$4E9"


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

    def __init__(self, rng: random.Random):
        self.rng = rng
        self.odo = 120.0
        self.fuel_pct = 85.0
        self.trip_km = self.trip_fuel = self.trip_s = 0.0
        self.tires = [240.0, 240.0, 240.0, 240.0]  # FL, FR, RL, RR
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
        self.fuel_pct -= fuel / TANK_L * 100
        self.events.append((end, self.odo))
        return end

    def reset_trip(self) -> None:
        self.trip_km = self.trip_fuel = self.trip_s = 0.0

    def row(self, t: datetime) -> dict[str, float | int]:
        l100 = self.trip_fuel / self.trip_km * 100 if self.trip_km > 0 else 102.2
        return {
            "ododispvalue": round(self.odo, 1),
            "drv1avlfuele": round(100 / l100, 3) if self.trip_km > 0 else 0.0,
            "drv1avlfuelg": round(l100, 1),
            "drv1drvtm": int(self.trip_s),
            "drv1distnc": round(self.trip_km, 3),
            "enginestate": 10 if self.trip_km > 0 else 3,
            "fuelsegementdactl": round(self.fuel_pct, 1),
            "smaphremdrvdistnum": int(self.fuel_pct / 100 * TANK_L / 6.9 * 100),
            "fltprsdispkp": self.tire(0, t),
            "frtprsdispkp": self.tire(1, t),
            "rltprsdispkp": self.tire(2, t),
            "rrtprsdispkp": self.tire(3, t),
        }

    def tire(self, i: int, t: datetime) -> int:
        value = self.tires[i] + self.rng.choice([-5, 0, 0, 5])
        if i == 2:  # slow leak on the rear left over the last three weeks
            days_left = (END - t).days
            if days_left < 21:
                value -= (21 - days_left) * 2.4
        return int(round(value / 5) * 5)


def build_drives(rng: random.Random) -> tuple[Car, list[dict]]:
    car = Car(rng)
    rows: list[dict] = []
    day = START
    while day <= END:
        weekend = day.weekday() >= 5
        plans = []
        if not weekend and rng.random() < 0.9:
            plans += [(7.5, rng.uniform(10, 24)), (17.5, rng.uniform(10, 24))]
        if weekend and rng.random() < 0.7:
            plans.append((10.5, rng.uniform(25, 150)))
        if day.date() == datetime(2026, 6, 6).date():
            plans.append((14.0, 60.0))  # one heavy stretch (high consumption)
        for hour, km in plans:
            start = day + timedelta(hours=hour + rng.uniform(-0.4, 0.4))
            if car.trip_km > rng.uniform(380, 650):
                car.reset_trip()
                rows.append({"at": start - timedelta(minutes=2), **car.row(start)})
            l100 = rng.gauss(6.8, 0.5) + (
                7.5 if km == 60.0 and day.date().month == 6 else 0
            )
            if km < 15:
                l100 += 0.8  # short city trips use more
            end = car.drive(start, km, max(5.2, l100))
            if car.fuel_pct < 14:
                car.fuel_pct = rng.uniform(88, 100)
            rows.append({"at": end + timedelta(seconds=10), **car.row(end)})
        day += timedelta(days=1)
    return car, rows


def write_status(out: Path, rows: list[dict]) -> None:
    signals = [k for k in rows[0] if k != "at"]
    header = [
        "vin",
        "fileid_datetime",
        "requesttype",
        "isinservicemode",
        "datacreationtime",
    ]
    for s in signals:
        header += [f"{s}_value", f"{s}_validstatus"]
    header += [
        "latitude",
        "longitude",
    ]  # real exports can carry a position; always empty here
    body = []
    for r in rows:
        line = [
            VIN,
            _n(r["at"] - timedelta(seconds=11)),
            "RemoteConfirm",
            "false",
            _z(r["at"]),
        ]
        for s in signals:
            line += [r[s], "Valid"]
        body.append(line + ["", ""])
    _write(out / "all-rts-sample_rts-sample.csv", header, body)


def write_doors(out: Path, rng: random.Random, rows: list[dict]) -> None:
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
    body = []
    for r in rows[::2]:
        line = [VIN, _n(r["at"]), "ForgetInform", _z(r["at"] + timedelta(seconds=12))]
        for s in signals:
            value = {
                "locklinkswdrv": rng.choice([0, 2, 2]),
                "lghtswstate": rng.choice([0, 3]),
            }.get(s, 0)
            line += [
                value,
                "Invalid" if rng.random() < 0.03 and s == "drstatdrv" else "Valid",
            ]
        body.append(line)
    _write(out / "all-vis-sample_vis-sample.csv", header, body)


def write_alarms(out: Path) -> None:
    header = [
        "vin",
        "fileid_datetime",
        "datacreationtime",
        "burglarstatus_value",
        "burglarstatus_validstatus",
        "balarmreasondactl_value",
        "balarmreasondactl_validstatus",
    ]
    events = [
        (datetime(2026, 4, 9, 8, 40), 1, 0),
        (datetime(2026, 6, 22, 21, 14), 5, 5),
        (datetime(2026, 6, 22, 21, 14, 12), 1, 0),
    ]
    body = [
        [VIN, _n(t), _z(t + timedelta(minutes=5)), s, "Valid", r, "Valid"]
        for t, s, r in events
    ]
    _write(out / "all-alt-sample_alt-sample.csv", header, body)


def _tx(rng: random.Random) -> str:
    return str(uuid.UUID(int=rng.getrandbits(128), version=4))


def write_warnings(out: Path, rng: random.Random, car: Car) -> None:
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
                VIN,
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
            codes = [c for c, p in WARNING_CODES if rng.random() < p]
            if codes:
                event(t, odo, codes)
    spike_odo = next(o for t, o in car.events if t.date() >= SPIKE_DAY)
    for i in range(48):
        event(
            datetime.combine(SPIKE_DAY, datetime.min.time())
            + timedelta(hours=9, minutes=i * 4),
            spike_odo,
            ["$1C4", "$201"],
        )
    for end, odo in car.events[-3:]:
        event(end - timedelta(minutes=3), odo, [NEW_CODE])
    body.sort(key=lambda r: r[3])
    _write(out / "all-war-sample_war-sample.csv", header, body)


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


def fault_schedule(n_readouts: int) -> dict[int, list[tuple[str, str]]]:
    """Which (ecu, DTC) is listed in which read-out."""
    plan: dict[int, list[tuple[str, str]]] = {i: [] for i in range(n_readouts)}
    for i in range(2, n_readouts):
        plan[i].append(
            ("BCM", "U0198:00")
        )  # recurring, still active in the latest read-out
    for i in range(3, 6):
        plan[i].append(("DCM", "U3000:00"))  # appears, then clears
    plan[n_readouts - 1].append(("ADU", "C1B22:87"))  # brand new in the latest read-out
    return plan


def write_dtcs(out: Path, rng: random.Random, car: Car) -> None:
    readouts = [
        START + timedelta(days=7 * i + 4, hours=10)
        for i in range((END - START).days // 7)
    ]
    plan = fault_schedule(len(readouts))
    head, detail, ssr = [], [], []
    for i, when in enumerate(readouts):
        tx = _tx(rng)
        odo = next((o for t, o in car.events if t >= when), car.odo)
        trigger = when - timedelta(minutes=rng.randint(30, 200))
        head.append([tx, VIN, _n(when), "", _z(trigger), 1, 0, int(odo)])
        for ecu in ECUS:
            dtc = next((d for e, d in plan[i] if e == ecu), "")
            if ecu == "ECM" and i in (3, 9):
                detail.append(
                    [tx, VIN, _n(when), 4, ecu, "19 02 8F", "", 4]
                )  # a failed read
            elif dtc:
                detail.append(
                    [tx, VIN, _n(when), 1, ecu, dtc, "28" if ecu == "ADU" else "08", 3]
                )
            else:
                detail.append([tx, VIN, _n(when), 1, ecu, "", "", 0])
        for ecu, dtc in plan[i]:
            for rec in ("01", "02") if dtc.startswith("U0198") else ("01",):
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
                        VIN,
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
        out / "all-dtc-h-sample_dtc-h-sample.csv",
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
        out / "all-dtc-d-sample_dtc-d-sample.csv",
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
        out / "all-dtc-ssr-sample_dtc-ssr-sample.csv", SSR_META + SNAPSHOT_SIGNALS, ssr
    )


# Three downloads, each with its own diagnostic report. The counters grow, one fault appears only at the last visit, and the
# monitor results drift a little (but stay inside their limits).
DIAG_VISITS = [
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
]


def diag_text(
    when: datetime, odo: float, faults: bool, mv: float, g: float, lpk: float
) -> str:
    km = odo - 120
    fuel = km * lpk / 100
    ignitions = 40 + int(km / 24)
    dtcs = "ModuleName:ADU\nC1B22:87-28\n" if faults else "ModuleName:ADU\n"
    rob = "ModuleName:DCM\nXB2A92:00-28\n" if faults else "ModuleName:DCM\n"
    snapshot = (
        f"""SnapshotData
ModuleName:ADU
DTC:C1B22:87-28
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

Date:{when:%Y/%m/%d}
Time:{when:%H:%M:%S}
TimeZone:UTC+0000


ODO:{int(odo)}km

Mode 9
ModuleName:ECM
VIN   {VIN}
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


def write_diag(out: Path, car: Car) -> None:
    for when, extra in DIAG_VISITS:
        # odometer when the report was made: after the last drive that ended before it
        odo = next((o for t, o in reversed(car.events) if t <= when), 120.0)
        name = f"all-sample-diag-tool_sample-diag-tool_1_{when:%Y%m%d_%H%M%S}.txt"
        (out / name).write_text(diag_text(when, odo, **extra))


def generate(out: Path, seed: int = 7) -> None:
    out.mkdir(parents=True, exist_ok=True)
    rng = random.Random(seed)
    car, status = build_drives(rng)
    write_status(out, status)
    write_doors(out, rng, status)
    write_alarms(out)
    write_warnings(out, rng, car)
    write_dtcs(out, rng, car)
    write_diag(out, car)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("out", type=Path)
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()
    generate(args.out, args.seed)
    print(f"sample data written to {args.out}")


if __name__ == "__main__":
    main()
