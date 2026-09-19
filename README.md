GridGuard

Secure smart meter and substation monitoring system

GridGuard is a smart-grid cybersecurity prototype. Simulated ESP32 smart meters send telemetry to a security gateway. The gateway checks every packet, detects attacks and faulty meters, isolates a suspicious meter, and logs everything. A web dashboard shows the live grid, the alerts, and the meter inventory.

Safety note: GridGuard is a defensive, educational prototype. All attacks are simulated inside the gateway software on one machine. It does not jam Wi-Fi, impersonate devices on a real network, disrupt anything, or switch real electrical loads.

Problem

Smart meters continuously send voltage, current, power and temperature readings to a substation or control centre. If an unauthorised device injects data, a message is altered or replayed, or a meter starts reporting abnormal values, the operator must notice quickly and isolate that meter without shutting down the healthy ones.

GridGuard demonstrates this with two simulated meters, a gateway that validates and monitors their data, and an operator dashboard.

What it does
Accepts telemetry only from registered meters (device allow-list).
Verifies each message with an HMAC-SHA256 signature.
Rejects replayed messages (sequence number and timestamp checks) and floods (rate limit).
Flags abnormal readings: voltage, current, power and temperature limits, sudden spikes, power that does not match voltage × current, and cumulative energy that goes backwards.
Isolates a faulty meter automatically (or on the operator's command) while healthy meters keep running.
Stores every event with time, meter, severity, reason, raw packet, source and meter state.
Shows all of this in a live dashboard, with CSV and PDF reports.
Architecture
text
 Simulated ESP32 meters (Wokwi)          Built-in simulator + Attack simulation page
   Meter A (MTR-001)                                   |
   Meter B (MTR-002)                                   |
        |  JSON telemetry                              |
        |  (serial output pasted into the gateway;     |
        |   MQTT listener available, not yet used      |
        |   by the firmware)                           |
        +---------------------+------------------------+
                              v
              Gateway engine  (gateway/core.py)
   allow-list -> isolation check -> rate limit -> HMAC -> replay
        -> plausibility and threshold rules -> auto-isolation
                              |
                              v
                 SQLite database  (logs/gridguard.db)
                              |
                              v
              Streamlit dashboard  (dashboard/app.py)
Quick start

Requirements: Python 3.9 or newer.

bash
pip install -r requirements.txt
streamlit run dashboard/app.py

Run the command from the repository root. The dashboard opens at http://localhost:8501. A built-in simulator is switched on by default, so both meters show live data immediately.

Demo flow
Overview: both meters online, live charts.
Attack simulation: with Meter B selected, run Unauthorized Meter, Tampered Message and Replay Attack. Each is rejected, and the page shows the reason.
Run Compromised Meter. The gateway flags the extreme readings and isolates Meter B while Meter A keeps running.
Alerts: open an event to see the raw packet behind it.
Meters: press Restore to service to bring Meter B back.
Reports: download the CSV files or create the PDF report.
Using the Wokwi meters

Turn off Use built-in simulator in the sidebar. Copy a JSON line from a Wokwi serial monitor and paste it into the box at the bottom of the Attack simulation page, or run the command-line gateway in a second terminal:

bash
python gateway/gateway_r2.py                    # paste JSON lines from the serial monitors
python gateway/gateway_r2.py --simulate         # headless simulated traffic
python gateway/gateway_r2.py --strict           # reject unsigned packets
python gateway/gateway_r2.py --mqtt HOST --topic YOUR/UNIQUE/TOPIC   # MQTT (untested)

The command-line gateway and the dashboard use the same database, so events appear in the dashboard either way.

Tests
bash
python -m pytest -q
Simulated attack scenarios

All scenarios run from the Attack simulation page.

Scenario	What is simulated	Gateway response
Unauthorized Meter	A device with ID MTR-999 sends telemetry	Rejected, critical alert
Tampered Message	A valid packet is edited after it was signed	Rejected, HMAC mismatch
Replay Attack	An earlier genuine packet is sent again	Rejected, sequence already used
Compromised Meter	A meter with a valid key sends extreme values (3 packets)	Flagged, meter auto-isolated
Energy Rollback	A meter's cumulative energy reading goes backwards	Flagged as a high-severity anomaly
Message Flood	15 packets in a burst	Rate-limit alert
Normal packet	A correctly signed reading within limits	Accepted, no alert
Security controls
Control	Rule	Result
Device allow-list	Only MTR-001 and MTR-002 may send data	Reject, critical
Message signature	HMAC-SHA256 over the packet fields, one key per meter	Reject, critical
Replay protection	Sequence number must increase; timestamp within 30 s	Reject, high
Rate limit	More than 8 packets in 5 s from one meter	Reject, high
Sensor plausibility	Voltage 0–1000 V, current up to 100 A, temperature −40 to 150 °C	Reject, critical
Voltage	Warn outside 216–244 V, critical outside 200–255 V	Flag
Current	Warn above 3.5 A, critical above 8 A	Flag
Temperature	Warn above 33 °C, critical above 42 °C	Flag
Power	Warn above 0.8 kW, critical above 1.8 kW	Flag
Power consistency	Reported kW may not exceed voltage × current	Flag, high
Energy rollback	Cumulative energy_wh may not decrease	Flag, high
Sudden spike	Power above 2.5× the recent average	Flag, medium
Meter self-alert	Meter sends "alert": true	Flag, medium
Auto-isolation	3 high or critical packets from one meter within 60 s	Meter isolated

Notes on the design:

Packets that fail authentication never count toward isolation. Otherwise an attacker could get a healthy meter isolated by sending fake packets in its name.
An isolated meter keeps sending, and the gateway drops its packets and counts them as blocked. An operator can restore it from the Meters page.
The thresholds are demo values based on a 230 V supply. Real values would come from the utility's own standards.
Message format

Telemetry is a JSON line. Fields marked optional can be left out (the Review 1 firmware sends only the first seven).

json
{"meter_id":"MTR-001","seq":42,"ts":1789800000,"temp_c":28.1,"voltage_v":230.2,"current_a":1.24,
 "power_kw":0.29,"alert":false,"energy_wh":15.62,"hmac":"<64 hex characters>"}

seq, ts, energy_wh and hmac are optional. The signature is HMAC-SHA256 over the printed text of these fields, joined by |:

meter_id|seq|ts|temp_c|voltage_v|current_a|power_kw|alert|energy_wh

Fields that are absent are signed as an empty string. Signing the printed text (for example 28.1, not the number 28.1) avoids float-formatting differences between C++ and Python. Demo keys are in gateway/core.py and can be overridden with the environment variables GG_KEY_MTR001 and GG_KEY_MTR002. Real keys must never be committed to the repository.

By default the gateway still accepts unsigned packets, so the Review 1 firmware keeps working. Turn on Require signed packets in the sidebar (or use --strict) to reject them.

Dashboard pages
Page	Contents
Overview	Meters online, grid load, packet counters, meter cards, live charts (power, current, voltage, temperature, energy), recent events
Alerts	Filterable event table, charts by severity, type and time, event details with the raw packet
Meters	Asset inventory, isolate and restore buttons, unregistered devices seen, list of gateway rules
Attack simulation	One-click attack scenarios with the gateway's verdict, paste box for Wokwi serial output
Reports	CSV export of events and telemetry, PDF incident report, data reset
Project structure
text
GridGuard/
├── prototype r1/                 # Wokwi and PlatformIO projects for the two simulated meters
│   ├── meter-a/                  # src/main.cpp, diagram.json, wokwi.toml, platformio.ini
│   ├── meter-b/
│   └── README.md
├── gateway/
│   ├── core.py                   # security engine: checks, anomaly rules, isolation, SQLite
│   ├── simulator.py              # normal meter traffic and the attack scenarios
│   ├── gateway_r2.py             # command-line gateway (serial paste, simulator, MQTT)
│   ├── gateway_r1.py             # Review 1 gateway
│   └── __init__.py
├── dashboard/
│   ├── app.py                    # Streamlit dashboard
│   ├── theme.py                  # styling and HTML helpers
│   ├── reporting.py              # PDF report
│   └── __init__.py
├── tests/test_core.py
├── .streamlit/config.toml        # dashboard theme
├── architecture.txt
├── requirements.txt
└── README.md

logs/gridguard.db is created when the app first runs and is not committed.

Meter hardware (simulated)

Each simulated meter is an ESP32 running in Wokwi inside VS Code, with:

DHT22 temperature sensor
Potentiometer for simulated voltage and current
SSD1306 OLED display
RGB LED and buzzer for alerts
Push button to simulate an alert condition

The firmware has demo scenarios (normal, slightly high power, extreme power spike, unauthorised meter) chosen with DEMO_SCENARIO. It prints one JSON line every 2 seconds. A future version will use real ESP32 boards with low-voltage sensors (INA219 or PZEM-004T). The system will never connect directly to mains electricity.

Technology
Layer	Technology
Meter simulation	Wokwi, VS Code, PlatformIO, Arduino C++ on ESP32
Gateway	Python, SQLite
Message security	HMAC-SHA256, sequence numbers, timestamps
Anomaly detection	Rule-based thresholds and consistency checks
Dashboard	Streamlit, Plotly, Pandas
Reports	CSV, ReportLab (PDF)
Current status and limits
Feature	Status
Allow-list, HMAC, replay protection, rate limit, anomaly rules, isolation	Done in the gateway
Dashboard, attack simulation, CSV and PDF reports	Done
Wokwi meters signing packets	Not yet. The firmware sends unsigned JSON without seq, ts or energy_wh
Connection from Wokwi to the gateway	Manual (copy and paste). The MQTT listener is written but untested
Isolation switching the meter's LED and buzzer	Not yet. The gateway does not send commands back to meters
Source address in the event log	Stores the serial port, MQTT topic or operator, not a real client IP
Machine-learning anomaly detection, TLS, dashboard login	Planned

The attacks and the normal traffic in the dashboard are generated by the built-in simulator, so signing and replay protection are demonstrated there, not by the Wokwi meters yet.

Future work
Sign packets in the ESP32 firmware and add seq, ts and energy_wh.
Send telemetry over MQTT (with TLS) instead of copying serial output.
Send an isolation command back to the meter to drive its LED and buzzer.
Train an anomaly model (for example Isolation Forest) on simulated normal and abnormal data.
Add dashboard login, email or Telegram notifications, and physical boards with INA219 or PZEM-004T sensors.
References
NISTIR 7628 Rev. 1: Guidelines for Smart Grid Cybersecurity
NIST Cybersecurity Framework Smart Grid Profile
CISA guidance for industrial control system security and incident response
Contributors
Sandhiya Priyadharshini Ganesh
Harshita Das
Tarunya Modi