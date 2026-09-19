"""
GridGuard Gateway (Review 2)
============================
Feeds telemetry into the same engine the dashboard uses, so both share
logs/gridguard.db.

    python gateway/gateway_r2.py                    # paste JSON lines from Wokwi serial monitors
    python gateway/gateway_r2.py --simulate         # headless healthy-meter traffic
    python gateway/gateway_r2.py --mqtt broker.hivemq.com --topic gridguard/demo/<your-unique-topic>
    python gateway/gateway_r2.py --strict           # reject unsigned packets

(The dashboard can also do all of this by itself - see the Attack simulation page.)
"""
import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from gateway.core import GridGuardEngine, Verdict  # noqa: E402
from gateway.simulator import tick  # noqa: E402

COL = {"ACCEPTED": "\033[92m", "FLAGGED": "\033[93m", "REJECTED": "\033[91m", "BLOCKED": "\033[95m"}
END = "\033[0m"


def show(v: Verdict) -> None:
    head = f"{COL.get(v.label, '')}{v.label:<8}{END} {v.meter_id or '?':<8}"
    if not v.findings:
        auth = "signed" if v.authenticated else "unsigned (legacy)"
        print(f"{head} OK · {auth}")
    for f in v.findings:
        print(f"{head} [{f.severity.upper():<8}] {f.type}: {f.reason}")
    if v.blocked:
        print(f"{head} meter is isolated - packet ignored")
    if v.isolated_now:
        print(f"\033[91m>>> {v.meter_id} AUTO-ISOLATED\033[0m")


def run_stdin(eng: GridGuardEngine) -> None:
    print("GridGuard Gateway (Review 2) - paste telemetry lines, Ctrl+C to quit")
    for line in sys.stdin:
        if line.strip():
            show(eng.ingest(line, source="serial", addr="stdin"))


def run_simulator(eng: GridGuardEngine) -> None:
    print("Simulating two healthy meters - Ctrl+C to stop")
    while True:
        for v in tick(eng):
            show(v)
        time.sleep(0.5)


def run_mqtt(eng: GridGuardEngine, host: str, port: int, topic: str) -> None:
    try:
        import paho.mqtt.client as mqtt
    except ImportError:
        sys.exit("pip install paho-mqtt  (needs paho-mqtt >= 2.0)")

    def on_connect(client, userdata, flags, reason_code, properties=None):
        print(f"Connected to {host}:{port} ({reason_code}) - subscribing to {topic}")
        client.subscribe(topic)

    def on_message(client, userdata, msg):
        show(eng.ingest(msg.payload.decode("utf-8", "replace"), source="mqtt", addr=f"mqtt:{host}:{msg.topic}"))

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    client.on_connect, client.on_message = on_connect, on_message
    client.connect(host, port, 60)
    client.loop_forever()


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--simulate", action="store_true")
    ap.add_argument("--mqtt", metavar="HOST")
    ap.add_argument("--port", type=int, default=1883)
    ap.add_argument("--topic", default="gridguard/demo/mtr001-tarunya-2026")
    ap.add_argument("--strict", action="store_true", help="require HMAC on every packet")
    a = ap.parse_args()
    engine = GridGuardEngine(strict_hmac=a.strict)
    try:
        if a.mqtt:
            run_mqtt(engine, a.mqtt, a.port, a.topic)
        elif a.simulate:
            run_simulator(engine)
        else:
            run_stdin(engine)
    except KeyboardInterrupt:
        print("\nbye")
