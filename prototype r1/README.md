# GridGuard - prototype

## Secure Smart Meter and Substation Monitoring System

GridGuard is a hardware-in-the-loop smart-grid cybersecurity prototype that simulates smart meters, monitors their telemetry, detects suspicious behavior, and provides a web dashboard for security monitoring and incident response.

The current prototype uses two simulated ESP32-based smart meters in Wokwi. A Python gateway validates the telemetry and logs security incidents. A Streamlit dashboard displays meter status and alerts.

> Safety note: GridGuard is a defensive educational prototype. It uses only simulated devices and data in an isolated lab environment. It does not perform Wi‑Fi jamming, device impersonation on real networks, or real electrical switching.

---

## Problem Statement

Modern smart grids depend on many connected smart meters that continuously send operational data (voltage, current, power, temperature) to a substation or control center.

If an unauthorized or compromised device injects fake or extreme readings, the grid operator must detect this quickly and isolate the affected device without disrupting healthy meters.

GridGuard demonstrates this scenario using two simulated smart meters, a security gateway, and a live dashboard.

---

## Objectives

- Simulate two ESP32-based smart meters (Meter A and Meter B).
- Generate telemetry: temperature, voltage, current, power, and alert status.
- Provide configurable demo scenarios:
  - Scenario 0: Normal operation.
  - Scenario 1: Slightly high power (suspicious).
  - Scenario 2: Extreme power spike (clear anomaly).
  - Scenario 3: Unauthorized / fake meter demo.
- Use a push button on Meter B to simulate an attack (unauthorized or anomalous device).
- Validate meter identity and alert status in a Python gateway.
- Log security incidents to a CSV file.
- Display meter status and incidents in a web dashboard.

---

## System Architecture

```text
Wokwi ESP32 Meter A ──┐
  (meter_a.ino)       │
                      ├── Serial (JSON telemetry)
Wokwi ESP32 Meter B ──┘
  (meter_b.ino)       │
                      ▼
              Python Gateway
         (gateway/gateway_simple.py)
              │
              ├── Validate meter_id
              ├── Check alert flag
              └── Write incidents to logs/incident_log.csv
                      │
                      ▼
            Streamlit Web Dashboard
           (dashboard/app.py in browser)
```

---

## How It Works

1. Two Wokwi simulations run independently:
   - Meter A (`MTR-001`) represents an authorized smart meter.
   - Meter B (`MTR-002`) represents a meter that can be switched into attack mode.
2. Each meter sends JSON telemetry over its serial monitor every 2 seconds.
3. The operator copies serial lines from both meters into the Python gateway terminal.
4. The gateway:
   - Checks whether `meter_id` is in the allowed set (`MTR-001`, `MTR-002`).
   - Checks the `alert` flag.
   - Prints `OK` for valid meters and `ALERT` for suspicious/unauthorized ones.
   - Logs incidents to `logs/incident_log.csv`.
5. The Streamlit dashboard reads the CSV and shows:
   - Meter status (Normal / Alert).
   - A table of security incidents with timestamp, meter ID, reason, and raw data.

---

## Demo Scenarios

Each meter supports four demo scenarios (configured via `DEMO_MODE` and `DEMO_SCENARIO`):

| Scenario | Temperature | Voltage | Current | Purpose |
|----------|-------------|---------|---------|---------|
| 0 | 28 °C | 230 V | 1.2 A | Normal operation |
| 1 | 35 °C | 235 V | 4.0 A | Slightly high power (suspicious) |
| 2 | 45 °C | 250 V | 9.5 A | Extreme power spike (anomaly) |
| 3 | 30 °C | 230 V | 2.0 A | Unauthorized meter demo |

- Meter A is configured for normal operation (scenario 0).
- Meter B is configured for normal operation by default, with the push button used to simulate an attack (e.g., sending an unauthorized meter ID or extreme values).

---

## Hardware Simulation

The prototype uses Wokwi (ESP32 simulator) inside VS Code.

### Simulated Components (per meter)

- ESP32 DevKit board
- DHT22 temperature sensor (GPIO 15)
- Potentiometer (GPIO 34) for simulated voltage/current input
- SSD1306 OLED display (I2C)
- RGB LED (GPIO 26/25/33, common cathode)
- Buzzer (GPIO 27)
- Push button (GPIO 4, active-low)

### Final Hardware (future phase)

- 2–3 physical ESP32 boards
- INA219 or PZEM-004T for voltage/current sensing
- DHT11/DHT22 temperature sensors
- OLED displays
- RGB LEDs and buzzers
- Optional Raspberry Pi gateway

> The final system will use only low-voltage sensors and will not connect directly to mains electricity.

---

## Technology Stack

| Layer | Technologies |
|-------|--------------|
| Hardware Simulation | Wokwi, VS Code |
| Embedded Programming | Arduino C/C++, ESP32 |
| Device Communication | Serial (JSON) |
| Backend Gateway | Python |
| Security Logic | Meter allow-list, alert flag validation |
| Data Logging | CSV (`logs/incident_log.csv`) |
| Web Dashboard | Streamlit, Pandas |
| Version Control | Git, GitHub |

---

## Repository Structure

```text
gridguard/
│
├── prototype-r1/
│   ├── meter-a/
│   │   ├── meter_a.ino
│   │   ├── diagram.json
│   │   └── wokwi.toml
│   │
│   └── meter-b/
│       ├── meter_b.ino
│       ├── diagram.json
│       └── wokwi.toml
│
├── gateway/
│   └── gateway_simple.py
│
├── dashboard/
│   └── app.py
│
├── logs/
│   └── incident_log.csv
│
└── README.md
```

---

## Security Model (Prototype)

- **Device allow-list:** Only `MTR-001` and `MTR-002` are considered authorized.
- **Alert flag:** Meters can set `"alert": true` to indicate a local fault or tamper condition.
- **Incident logging:** Unauthorized or suspicious telemetry is recorded with timestamp, meter ID, reason, and raw JSON.
- **Dashboard visibility:** Operators can see which meter triggered an alert and inspect the raw data.

This aligns with smart-grid cybersecurity guidance that emphasizes device authentication, monitoring for abnormal conditions, and incident logging.

---

## How to Run the Prototype

### Prerequisites

- Python 3.8+
- VS Code with:
  - Wokwi extension
  - PlatformIO IDE extension
- Required Python packages:

```bash
pip install -r requirements.txt
```

Create a file named `requirements.txt` in the repo root with the following content:

```text
streamlit
pandas
```

Then install the dependencies:

```bash
pip install -r requirements.txt
```

### Step 1 — Run Wokwi Simulations

1. Open `prototype-r1/meter-a/` in VS Code and start the Wokwi simulation.
2. Open `prototype-r1/meter-b/` in another VS Code window or browser tab and start the simulation.
3. Open the serial monitor for each meter.

### Step 2 — Run the Gateway

From the repo root:

```bash
python gateway/gateway_simple.py
```

Paste JSON lines from both serial monitors into this terminal.

### Step 3 — Run the Dashboard

From the repo root:

```bash
streamlit run dashboard/app.py
```

Open the URL shown in your browser.

---

## Demo Flow for Review

1. Show both Wokwi circuits and explain the components.
2. Show normal telemetry from Meter A and Meter B.
3. Press the attack button on Meter B to simulate an unauthorized/anomalous meter.
4. Show gateway output: `OK` for normal, `ALERT` for attack.
5. Show dashboard: new incident row appears in the table.
6. Explain how this maps to a real smart grid: many meters, a central gateway, and an operator dashboard.

---

## Future Enhancements

- Replace Wokwi simulations with physical ESP32 hardware.
- Add MQTT or HTTP communication instead of manual copy-paste.
- Add HMAC message authentication and replay protection.
- Add rule-based and ML-based anomaly detection.
- Add device isolation logic and physical indicator on the gateway.
- Add role-based login and HTTPS for the dashboard.
- Deploy the system on a Raspberry Pi or cloud instance.

---

## Contributors

- Sandhiya Priyadharshini Ganesh
- Harshita Das
- Tarunya Modi
```
