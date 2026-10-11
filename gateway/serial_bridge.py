"""
Serial bridge: reads the JSON lines a meter prints and feeds them to the gateway engine.

Works with the Wokwi for VS Code serial forwarding (rfc2217ServerPort in wokwi.toml)
and with a real ESP32 on a COM port.

    python gateway/serial_bridge.py rfc2217://localhost:4000 rfc2217://localhost:4001
    python gateway/serial_bridge.py COM5
    python gateway/serial_bridge.py rfc2217://localhost:4000 --strict

Give one source per meter. Anything that is not a JSON line (boot messages, debug prints) is ignored.
Events go to the same database as the dashboard, so switch the dashboard's built-in simulator OFF.
"""
import argparse
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from gateway.core import GridGuardEngine  # noqa: E402
from gateway.gateway_r2 import show  # noqa: E402


def read_source(eng: GridGuardEngine, url: str, baud: int, stop: threading.Event) -> None:
    try:
        import serial
    except ImportError:
        sys.exit("pip install pyserial")

    while not stop.is_set():
        try:
            port = serial.serial_for_url(url, baudrate=baud, timeout=1)
        except Exception as exc:  # simulator not started yet, cable unplugged, ...
            print(f"[{url}] cannot connect ({exc.__class__.__name__}); retrying in 3 s")
            stop.wait(3)
            continue
        print(f"[{url}] connected")
        try:
            while not stop.is_set():
                raw = port.readline()
                if not raw:
                    continue
                line = raw.decode("utf-8", "replace").strip()
                if line.startswith("{") and line.endswith("}"):
                    show(eng.ingest(line, source="serial", addr=url))
        except Exception as exc:
            print(f"[{url}] connection lost ({exc.__class__.__name__}); reconnecting")
        finally:
            try:
                port.close()
            except Exception:
                pass
        stop.wait(2)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("sources", nargs="+", help="rfc2217://localhost:4000, COM5, /dev/ttyUSB0, ...")
    ap.add_argument("--baud", type=int, default=115200)
    ap.add_argument("--strict", action="store_true", help="reject packets without a valid HMAC")
    a = ap.parse_args()

    eng = GridGuardEngine(strict_hmac=a.strict)
    stop = threading.Event()
    threads = [threading.Thread(target=read_source, args=(eng, u, a.baud, stop), daemon=True) for u in a.sources]
    for t in threads:
        t.start()
    print(f"Bridging {len(a.sources)} source(s) into the gateway. Ctrl+C to stop.")
    try:
        while True:
            time.sleep(0.5)
    except KeyboardInterrupt:
        stop.set()
        print("\nbye")


if __name__ == "__main__":
    main()
