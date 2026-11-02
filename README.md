# GridGuard

Smart meter monitoring and cybersecurity demonstration with a live operator dashboard.

GridGuard receives telemetry from two registered meters, checks message authenticity and sensor readings, detects suspicious activity, and isolates affected meters while healthy meters continue operating. It supports a built-in simulator, signed ESP32 telemetry from Wokwi, and Arduino UNO R4 WiFi boards with DHT22 sensors.

The current application uses **React, TypeScript, Express, and Vite**. No Python gateway or Streamlit installation is required.

## Features

- Live voltage, current, power, temperature, and cumulative energy monitoring for `MTR-001` and `MTR-002`.
- Device allow-list, HMAC-SHA256 verification, sequence and timestamp checks, and per-meter rate limiting.
- Rule-based detection of abnormal readings, power inconsistencies, sudden spikes, and energy rollback.
- Automatic isolation after repeated high or critical anomalies, plus manual isolation and restoration.
- Attack scenarios for unauthorized devices, altered messages, replay, compromised meters, energy rollback, and flooding.
- Live interception of Wokwi bridge traffic, with original and modified packets and gateway verdicts.
- Security event inspection, CSV exports, and a printable incident report that can be saved as PDF through the browser.

## Quick start

Use Node.js 22 or newer with npm. Run these commands from the repository root:

```sh
npm ci
npm run dev
```

Open **http://localhost:3000**. The built-in simulator starts automatically and populates both meters; no hardware is needed.

On Windows, use `npm.cmd` if PowerShell blocks `npm.ps1`.

To choose another port:

```sh
npm run dev -- --port 3001
```

The server uses `--port`, then `DEFAULT_APP_PORT`, then `3000`. The current implementation ignores `--port 8080`. The `PORT` entry in `.env.example` is not read by the server, and `.env` files are not loaded automatically.

## Try the demonstration

1. Open **Overview** to inspect the two meters, live readings, and packet counters.
2. Open **Attack simulation**, select Meter B, and try Unauthorized Meter, Tampered Message, and Replay Attack. Inspect each rejection and its reason.
3. Run **Compromised Meter** with automatic isolation enabled. Repeated severe readings isolate Meter B while Meter A continues.
4. Review the resulting events in **Alerts**.
5. Restore Meter B from **Meters**.
6. Use **Reports** to export telemetry and events or print an incident summary.

The sidebar controls the simulator, strict HMAC verification, automatic isolation, refresh settings, and the live MITM attacker. The **Live interception** page operates on incoming Wokwi bridge packets; it needs a running Wokwi meter and bridge.

## Meter connections

### Built-in simulator

The simulator signs packets using the gateway's configured meter keys. It yields to an external meter for that meter ID while live traffic is present. If traffic stops for approximately eight seconds, simulation can resume when the simulator remains enabled. Disable the simulator when you need to observe hardware loss of signal without fallback data.

### Wokwi ESP32 meters

See [WOKWI.md](WOKWI.md) for PlatformIO builds, Wokwi setup, serial bridge options, and meter scenarios. Use the signed firmware in `prototype r2`; `prototype r1` contains the earlier prototype.

The checked-in Wokwi firmware uses different demo keys from the gateway defaults. In a PowerShell terminal, set matching keys **before starting the gateway**:

```powershell
$env:GG_KEY_MTR001 = 'gridguard-demo-key-A'
$env:GG_KEY_MTR002 = 'gridguard-demo-key-B'
npm.cmd run dev
```

Start the Wokwi simulations for Meter A and Meter B, then run the bridge in a second terminal:

```sh
npm run bridge
```

The bridge connects to local serial TCP ports `4000` and `4001` and forwards packets to `http://localhost:3000`. For a different gateway port:

```sh
npm run bridge -- --url http://localhost:3001
```

The bridge also synchronizes meter clocks, sequences, and energy baselines, and sends isolation state back to the simulated meters. The live MITM attacker affects this serial ingest path; disable it for a clean telemetry demonstration.

### Arduino UNO R4 WiFi meters

See [ARDUINO.md](ARDUINO.md) for wiring, network configuration, PlatformIO upload instructions, LED behavior, and testing. The shared firmware project is `hardware/uno-r4`, with `meter-a` and `meter-b` build environments.

These boards measure temperature and humidity with DHT22 sensors. Voltage, current, power, and energy are simulated. They send signed JSON directly over HTTP to `/api/telemetry`, bypassing the Wokwi interception path.

The firmware's literal demo keys are `GG_KEY_MTR001` and `GG_KEY_MTR002`, matching the current gateway defaults. If environment variables override the gateway keys, configure the firmware to match or restart the gateway with the matching values. Do not run Arduino and Wokwi streams with the same meter ID simultaneously.

## Configuration

Set environment variables in the terminal that starts the server:

```powershell
$env:GG_KEY_MTR001 = 'your-meter-a-key'
$env:GG_KEY_MTR002 = 'your-meter-b-key'
$env:DEFAULT_APP_PORT = '3000'
npm.cmd run dev
```

- `GG_KEY_MTR001`: HMAC key for Meter A; defaults to the literal string `GG_KEY_MTR001`.
- `GG_KEY_MTR002`: HMAC key for Meter B; defaults to the literal string `GG_KEY_MTR002`.
- `DEFAULT_APP_PORT`: listening port when `--port` is absent.
- `NODE_ENV=production`: serves the built frontend from `dist/`.
- `GATEWAY_URL`: optional bridge destination; defaults to `http://localhost:3000` and can be overridden with the bridge's `--url` argument.

Restart the server after changing keys. `.env.example` contains Wokwi demo key values as a reference; copying it to `.env` alone does not configure this application. Keep real secrets and Wi-Fi credentials out of commits.

## Security checks

The engine in [src/server/engine.ts](src/server/engine.ts) applies these checks:

- **Registration and isolation:** reject unknown meter IDs and block packets from isolated meters.
- **Rate limit:** reject more than eight packets from a meter within five seconds. Controlled `attack-sim` and `mitm-interceptor` sources bypass this check.
- **Authentication:** verify supplied HMAC signatures. Unsigned packets are accepted by default for compatibility; enable strict HMAC mode to require signatures.
- **Replay checks:** when supplied, sequence numbers must increase and timestamps must be within 30 seconds of gateway time.
- **Plausibility:** reject voltage outside 0–1000 V, current outside 0–100 A, temperature outside -40–150 °C, negative power, and invalid numeric readings.
- **Thresholds:** warn outside 216–244 V or above 3.5 A, 33 °C, or 0.8 kW; mark readings critical outside 200–255 V or above 8 A, 42 °C, or 1.8 kW.
- **Consistency:** flag excessive power relative to voltage times current, cumulative energy rollback, sudden power increases, and meter-reported alerts.
- **Automatic isolation:** three accepted packets with high or critical findings within 60 seconds isolate the meter when enabled. Authentication failures do not add isolation strikes.

Thresholds are demonstration values for a nominal 230 V supply. Isolation blocks gateway ingestion; it does not disconnect an electrical load.

## Telemetry and signing

A signed telemetry packet has this shape. Replace the timestamp with current Unix seconds, advance the sequence, and calculate the HMAC before sending:

```json
{
  "meter_id": "MTR-001",
  "seq": 42,
  "ts": 1793577600,
  "temp_c": 28.1,
  "voltage_v": 230.2,
  "current_a": 1.24,
  "power_kw": 0.2854,
  "alert": false,
  "energy_wh": 15.62,
  "hmac": "<64-character hexadecimal HMAC-SHA256>"
}
```

The gateway joins fields in this order with `|`:

```text
meter_id|seq|ts|temp_c|voltage_v|current_a|power_kw|alert|energy_wh
```

Numeric signing uses fixed decimal precision: temperature and voltage use two places, current three, power four, and energy two. The alert token is `true` or `false`. For the example above, the signed text is:

```text
MTR-001|42|1793577600|28.10|230.20|1.240|0.2854|false|15.62
```

Use `canonical()` and `signHmac()` in the engine as the implementation reference. Humidity and source metadata are outside this authenticated field set.

## API entry points

The Express server hosts both the dashboard and JSON API:

- `GET /api/status`, `/api/meters`, `/api/telemetry`, and `/api/events`: current state and recorded data.
- `POST /api/telemetry`: direct hardware JSON telemetry.
- `POST /api/ingest`: a packet wrapper with `packet`, `source`, and `addr`; the bridge uses source `serial`.
- `GET /api/time` and `/api/sync/:id`: clock and meter synchronization.
- `POST /api/session/start`: Arduino boot session synchronization.
- `POST /api/attack` and `/api/mitm/simulate`: controlled attack demonstrations.
- `GET /api/live-mitm` and `POST /api/live-mitm/strike`: interception status and next-packet controls.
- `POST /api/meters/:id/isolate` and `/api/meters/:id/restore`: operator actions.
- `GET /api/settings` and `POST /api/settings`: runtime settings.
- `GET /api/export/events.csv` and `/api/export/telemetry.csv`: CSV downloads.
- `POST /api/reset`: clears engine and interception state and seeds new simulator readings.

See [server.ts](server.ts) for request bodies and additional routes.

## Build and verification

```sh
npm run lint
npm run build
npx tsx tools/test-hardware-session.ts
npx tsx tools/test-arduino.ts
```

`lint` runs TypeScript checking. The hardware session script checks session resets and security behavior; the Arduino script checks simulator handoff and the HTTP ingest path without requiring physical boards. Board upload and sensor checks are documented separately in [ARDUINO.md](ARDUINO.md).

To serve a production frontend build in PowerShell:

```powershell
npm.cmd run build
$env:NODE_ENV = 'production'
npm.cmd start
```

`npm start` runs the TypeScript Express server through `tsx`; the build command bundles the frontend only. `npm run preview` previews the Vite build without starting the Express API, so use the Express server for the complete application.

## Repository layout

- `server.ts`: Express API, simulator loop, and frontend serving.
- `src/server/engine.ts`: validation, signing, anomaly rules, isolation, and in-memory state.
- `src/server/simulator.ts`: normal telemetry and controlled attack scenarios.
- `src/server/liveMitm.ts`: interception of Wokwi serial traffic.
- `src/App.tsx` and `src/components/`: dashboard, charts, alerts, meter controls, attack tools, and reports.
- `tools/`: Wokwi bridge and hardware integration checks.
- `hardware/uno-r4/`: Arduino UNO R4 WiFi firmware.
- `prototype r2/`: signed Wokwi ESP32 meter firmware.
- `prototype r1/`: earlier Wokwi prototype.
- `ARDUINO.md` and `WOKWI.md`: connection-specific setup guides.

## Scope and limitations

GridGuard is an educational defensive prototype. Attack demonstrations modify application packets inside the lab; they do not jam wireless networks or switch real electrical loads.

Telemetry, events, counters, and meter state are held **in memory**, with up to 5,000 telemetry points and 3,000 events retained. Restarting the server loses this history. Export data before restarting or resetting.

The server listens on all network interfaces, permits CORS, and has no dashboard login, API authorization, or TLS. Session and operator endpoints are intended for a trusted demonstration network. HMAC protects the listed telemetry fields; it does not authenticate operator API actions. Persistent storage, authenticated access, encrypted transport, and deployment hardening remain future work.

## Contributors

- Sandhiya Priyadharshini Ganesh
- Harshita Das
- Tarunya Modi
