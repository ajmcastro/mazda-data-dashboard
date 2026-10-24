"""Alert rule configuration (config/alerts.yaml), validated with pydantic."""

from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field

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
