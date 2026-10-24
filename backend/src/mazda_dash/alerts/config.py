"""Alert rule configuration (config/alerts.yaml), validated with pydantic."""

import re
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Severity = Literal["info", "warning", "critical"]
SEVERITY_RANK = {"info": 0, "warning": 1, "critical": 2}


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Rule(_Strict):
    enabled: bool = True
    severity: Severity = "warning"


class RecurringDtc(Rule):
    min_readouts: int = Field(5, ge=1)


class NewWarningCode(Rule):
    severity: Severity = "info"
    ignore_codes: list[str] = []


class WarningSpike(Rule):
    min_events: int = Field(20, ge=1)
    sigma: float = Field(3, gt=0)
    ignore_codes: list[str] = []


class HighConsumption(Rule):
    severity: Severity = "info"
    min_km: float = Field(20, gt=0)
    factor: float = Field(1.4, gt=1)


class LowFuel(Rule):
    below_pct: float = Field(12, ge=0, le=100)


class LowTirePressure(Rule):
    min_kpa: float = Field(200, gt=0)


class DataGap(Rule):
    severity: Severity = "info"
    max_days: float = Field(3, gt=0)


class OilChangeDue(Rule):
    below_km: float = Field(1000, gt=0)


# The flags of v_car_warning_readings (a test keeps this list and the view in step).
CAR_WARNING_FLAGS = (
    "fltyrepresswarn",
    "frtyrepresswarn",
    "rltyrepresswarn",
    "rrtyrepresswarn",
    "tpmsstatus",
    "tpmssystemflt",
    "oillevelwarning",
    "seatbeltwrndrq",
    "dropnwrn",
)


class CarWarningFlag(Rule):
    """The car's own warning flag went on. `severities` overrides the severity for single flags."""

    severities: dict[str, Severity] = {}
    ignore_flags: list[str] = []

    @model_validator(mode="after")
    def _known_flags(self):
        for name in [*self.severities, *self.ignore_flags]:
            if name not in CAR_WARNING_FLAGS:
                raise ValueError(
                    f"unknown car warning flag {name!r}; known: {', '.join(CAR_WARNING_FLAGS)}"
                )
        return self


FLAG_NAME = re.compile(r"^vdt_(2_warningpt|7_warningbody)_\d+_\d+$")


class NewWarningFlag(Rule):
    """A warning-lamp bit flag is set for the first time (inside the lookback window)."""

    severity: Severity = "info"
    ignore_flags: list[str] = []

    @field_validator("ignore_flags")
    @classmethod
    def _names(cls, flags: list[str]) -> list[str]:
        for flag in flags:
            if not FLAG_NAME.match(flag):
                raise ValueError(
                    f"{flag!r} is not a warning-lamp flag name (like vdt_7_warningbody_1_30)"
                )
        return flags


class Rules(_Strict):
    new_dtc: Rule = Rule()
    recurring_dtc: RecurringDtc = RecurringDtc()
    new_warning_code: NewWarningCode = NewWarningCode()
    warning_spike: WarningSpike = WarningSpike()
    burglar_alarm: Rule = Rule(severity="critical")
    high_consumption: HighConsumption = HighConsumption()
    low_fuel: LowFuel = LowFuel()
    low_tire_pressure: LowTirePressure = LowTirePressure()
    data_gap: DataGap = DataGap()
    oil_change_due: OilChangeDue = OilChangeDue()
    car_warning_flag: CarWarningFlag = CarWarningFlag()
    new_warning_flag: NewWarningFlag = NewWarningFlag()


class Notifications(_Strict):
    desktop: bool = False
    min_severity: Severity = "warning"


class AlertsConfig(_Strict):
    lookback_days: int = Field(30, ge=1)
    notifications: Notifications = Notifications()
    rules: Rules = Rules()


def load_config(path: Path | None) -> AlertsConfig:
    """Defaults when the file is missing; a clear error when it is invalid."""
    if path is None or not path.exists():
        return AlertsConfig()
    data = yaml.safe_load(path.read_text()) or {}
    try:
        return AlertsConfig.model_validate(data)
    except ValueError as e:
        raise ValueError(f"{path}: {e}") from e
