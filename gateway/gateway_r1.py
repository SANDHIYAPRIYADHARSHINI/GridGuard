import json
import csv
from datetime import datetime
from pathlib import Path

ALLOWED_METERS = {"MTR-001", "MTR-002"}

LOGS_DIR = Path(__file__).parent.parent / "logs"
LOGS_DIR.mkdir(exist_ok=True)
LOG_FILE = LOGS_DIR / "incident_log.csv"

# Create header if file doesn't exist
if not LOG_FILE.exists():
    with open(LOG_FILE, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["timestamp", "meter_id", "reason", "raw"])


def log_incident(meter_id, reason, raw):
    with open(LOG_FILE, "a", newline="") as f:
        writer = csv.writer(f)
        writer.writerow([
            datetime.now().isoformat(),
            meter_id,
            reason,
            raw
        ])


def process_line(line):
    line = line.strip()
    if not line:
        return
    try:
        data = json.loads(line)
    except Exception:
        print(f"INVALID_JSON: {line}")
        return

    meter_id = data.get("meter_id")
    if meter_id not in ALLOWED_METERS:
        print(f"ALERT | Unauthorized meter: {meter_id}")
        log_incident(meter_id, "unauthorized_device", line)
    else:
        print(f"OK | Meter {meter_id} accepted")


if __name__ == "__main__":
    print("GridGuard Gateway (Review 1) — Paste telemetry lines below:")
    while True:
        line = input()
        process_line(line)