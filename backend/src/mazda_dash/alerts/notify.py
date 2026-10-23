"""Optional desktop notification (macOS only)."""

import json
import platform
import subprocess

from .config import SEVERITY_RANK, AlertsConfig
from .store import Candidate


def summary(alerts: list[Candidate]) -> tuple[str, str]:
    worst = max(alerts, key=lambda a: SEVERITY_RANK[a.severity])
    title = f"CX-5: {len(alerts)} new alert{'s' if len(alerts) > 1 else ''}"
    more = f" (+{len(alerts) - 1} more)" if len(alerts) > 1 else ""
    return title, f"{worst.title}{more}"


def notify_desktop(alerts: list[Candidate], cfg: AlertsConfig) -> bool:
    """Send one notification for alerts at or above the configured severity."""
    floor = SEVERITY_RANK[cfg.notifications.min_severity]
    relevant = [a for a in alerts if SEVERITY_RANK[a.severity] >= floor]
    if not relevant or platform.system() != "Darwin":
        return False
    title, message = summary(relevant)
    script = (
        f"display notification {json.dumps(message)} with title {json.dumps(title)}"
    )
    result = subprocess.run(
        ["osascript", "-e", script], capture_output=True, check=False
    )
    return result.returncode == 0
