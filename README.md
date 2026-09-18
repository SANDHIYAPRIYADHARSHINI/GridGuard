# GridGuard

## Secure Smart Meter and Substation Monitoring System

GridGuard is a hardware-in-the-loop smart-grid cybersecurity project that simulates smart meters, monitors their telemetry, detects suspicious behavior, and provides a web dashboard for security monitoring and incident response.

The prototype uses simulated ESP32 smart-meter devices in Wokwi and VS Code. In the final implementation, the simulated devices will be replaced with physical ESP32 boards and low-voltage sensors.

> Safety note: GridGuard is a defensive educational prototype. It uses only simulated attacks in an isolated lab environment. It does not perform Wi-Fi jamming, device impersonation, network disruption, or real electrical switching.

---

## Problem Statement

Modern smart grids depend on connected smart meters, sensors, gateways, and substations. These devices continuously exchange power-consumption and operational data.

If an unauthorized device sends data, a message is altered, an old message is replayed, or a meter begins transmitting abnormal readings, the grid operator needs to detect the issue quickly and isolate the affected device without interrupting healthy devices.

GridGuard addresses this problem through simulated meter telemetry, message validation, anomaly detection, incident logging, and a live operator dashboard.

---

## Objectives

- Simulate two ESP32-based smart meters.
- Collect voltage, current, power, energy, and temperature telemetry.
- Validate smart-meter identity before accepting data.
- Protect message integrity using HMAC signatures.
- Detect replayed messages using timestamps and sequence numbers.
- Detect suspicious sensor values and abnormal message rates.
- Create a live web dashboard for grid operators.
- Trigger visible alerts through simulated LEDs and buzzers.
- Isolate a suspicious meter while continuing to monitor healthy meters.
- Generate downloadable incident logs and reports.

---

## System Architecture

```text
Wokwi ESP32 Meter A ──┐
                      ├── MQTT / JSON Telemetry ──> Python Gateway
Wokwi ESP32 Meter B ──┘                                  │
                                                         ├── Security Validation
                                                         ├── Anomaly Detection
                                                         ├── Incident Logging
                                                         └── SQLite / PostgreSQL
                                                                  │
                                                                  ▼
                                                       Streamlit Web Dashboard
```

---

## How It Works

1. Two simulated ESP32 devices act as smart meters.
2. Each meter collects or simulates sensor readings:
   - Voltage
   - Current
   - Power
   - Energy consumption
   - Temperature
3. Each meter sends a signed JSON telemetry message to the gateway.
4. The gateway verifies:
   - Whether the meter ID is registered.
   - Whether the HMAC signature is valid.
   - Whether the timestamp is recent.
   - Whether the sequence number has already been used.
   - Whether the readings fall within expected limits.
5. Valid data is stored and displayed in the dashboard.
6. Suspicious data creates a security alert and forensic log.
7. The gateway isolates the suspicious meter by rejecting further telemetry from it.
8. The meter LED and buzzer indicate the isolated state.
9. The operator can review alerts and export incident reports.

---

## Simulated Attack Scenarios

All attack scenarios are safe simulations triggered using a push button or software toggle.

| Scenario | Simulation | Gateway Response |
|---|---|---|
| Unauthorized Meter | Sends an unregistered meter ID | Rejects packet and raises critical alert |
| Invalid HMAC | Sends a deliberately incorrect message signature | Rejects altered message |
| Replay Attack | Reuses an earlier sequence number or timestamp | Rejects duplicated packet |
| Sensor Tampering | Sends impossible or extreme readings | Raises anomaly alert |
| Message Flooding | Sends readings above the allowed rate | Raises rate-limit alert |
| Device Isolation | Gateway blocks an unsafe meter | Marks meter as isolated and ignores new data |

---

## Prototype Hardware Simulation

The initial prototype is implemented using Wokwi inside VS Code.

### Simulated Components

- ESP32 development board
- DHT22 temperature sensor
- Potentiometer for simulated voltage/current input
- OLED display
- RGB LED
- Piezo buzzer
- Push button for attack-mode simulation

### Final Hardware Components

- 2 or 3 ESP32 development boards
- INA219 current and voltage sensor or PZEM-004T module
- DHT11 or DHT22 temperature sensor
- OLED display
- RGB LED
- Buzzer
- Push button
- Optional Raspberry Pi gateway
- Optional RFID RC522 module for technician authentication

> The final system will use only low-voltage sensors. It will not connect directly to mains electricity.

---

## Technology Stack

| Layer | Technologies |
|---|---|
| Hardware Simulation | Wokwi, VS Code |
| Embedded Programming | Arduino C/C++, ESP32 |
| Device Communication | MQTT, JSON |
| MQTT Broker | Mosquitto |
| Backend Gateway | Python, FastAPI or Flask |
| Message Security | HMAC-SHA256, timestamps, sequence numbers |
| Data Processing | Python, Pandas |
| Anomaly Detection | Rule-based thresholds, Scikit-learn Isolation Forest |
| Database | SQLite for prototype, PostgreSQL for final version |
| Web Dashboard | Streamlit |
| Reporting | CSV export, ReportLab PDF generation |
| Version Control | Git and GitHub |

---

## Repository Structure

```text
gridguard/
│
├── prototype r1/
│   ├── meter-a/
│   │   ├── meter_a.ino
│   │   ├── diagram.json
│   │   └── wokwi.toml
│   │
│   ├── meter-b/
│   │   ├── meter_b.ino
│   │   ├── diagram.json
│   │   └── wokwi.toml
│   │
│   └── README.md
│
├── gateway/
│   ├── app.py
│   ├── mqtt_client.py
│   ├── validator.py
│   ├── anomaly_detector.py
│   ├── isolation_manager.py
│   └── config.py
│
├── dashboard/
│   ├── streamlit_app.py
│   └── pages/
│       ├── 1_Live_Grid.py
│       ├── 2_Asset_Inventory.py
│       ├── 3_Security_Alerts.py
│       └── 4_Incident_Reports.py
│
├── database/
│   ├── schema.sql
│   └── gridguard.db
│
├── reports/
│   └── generated_reports/
│
├── docs/
│   ├── architecture.png
│   ├── threat_model.md
│   └── screenshots/
│
├── requirements.txt
└── README.md
```

---

## Security Controls

### Device Allow-List

Only registered meter IDs are permitted to submit telemetry.

### HMAC Message Authentication

Each meter signs telemetry with an HMAC-SHA256 secret key. The gateway calculates and compares the expected signature before accepting the message.

### Replay Protection

Every telemetry message includes a timestamp and sequence number. The gateway rejects old timestamps and repeated sequence numbers.

### Anomaly Detection

The gateway checks readings for unusual behavior, including:

- Sudden current or power spikes.
- Unrealistic voltage readings.
- Temperature values outside safe limits.
- Energy values that decrease unexpectedly.
- Excessive telemetry transmission rate.

### Incident Logging

Each rejected packet or detected anomaly is stored with:

- Timestamp
- Meter ID
- Network address
- Alert type
- Alert severity
- Validation failure reason
- Sensor values
- Isolation status

### Device Isolation

When a meter is marked as suspicious, the gateway blocks its telemetry. Healthy meters remain active.

---

## Dashboard Features

- Live voltage, current, power, energy, and temperature charts.
- Smart-meter asset inventory.
- Meter health and connection status.
- Real-time security alert feed.
- Alert severity classification.
- Detailed incident evidence.
- Meter isolation controls.
- Downloadable CSV event logs.
- PDF incident report generation.

---

## First Review Prototype Scope

The first review demonstrates:

- Two simulated ESP32 smart meters in Wokwi.
- Simulated temperature and electrical readings.
- Serial output or MQTT-style JSON telemetry.
- A basic Python gateway that receives and validates telemetry.
- A simple Streamlit dashboard with live/simulated readings.
- One safe attack scenario: invalid meter ID or unrealistic sensor value.
- Alert generation and device-isolation simulation.

---

## Future Enhancements

- Replace Wokwi devices with physical ESP32 hardware.
- Add INA219 or PZEM-004T sensor integration.
- Add MQTT over TLS.
- Add role-based dashboard login.
- Add RFID-based technician authorization.
- Train an ML classifier using simulated normal and anomalous telemetry.
- Add email or Telegram incident notifications.
- Deploy the dashboard using Docker and cloud infrastructure.
- Add digital-twin visualization of the grid topology.
- Add tamper detection using enclosure-open sensors.

---

## References

- NISTIR 7628 Rev. 1: Guidelines for Smart Grid Cybersecurity.
- NIST Cybersecurity Framework Smart Grid Profile.
- CISA guidance for industrial control system security and incident response.

---

## Contributors

- Sandhiya Priyadharshini Ganesh
- Harshita Das 
- Tarunya Modi
