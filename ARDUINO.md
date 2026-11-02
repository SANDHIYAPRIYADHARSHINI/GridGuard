# Arduino UNO R4 WiFi meters

The shared project is `hardware/uno-r4`. Environment `meter-a` builds MTR-001
with key `GG_KEY_MTR001`; `meter-b` builds MTR-002 with key `GG_KEY_MTR002`.
Temperature and humidity come from DHT22. Voltage, current, power and cumulative
energy are simulated. No INA219, buzzer, button or LCD is used.

## Wiring (repeat separately for both boards)

Disconnect USB power while wiring. Connect each board's 5V and GND to its own
breadboard rails. For a bare four-pin DHT22, viewed from the grille/front with
pins pointing down: pin 1 VCC to 5V, pin 2 DATA to Arduino D2, pin 3 unconnected,
pin 4 GND to GND. Connect a 10 kOhm resistor from DATA to 5V. For a three-pin
module, follow its printed VCC/DATA/GND labels; pin order may differ.

Connect D5 through a **series resistor** to the green LED anode (long leg), and
its cathode (short leg/flat edge) to GND. Repeat from D6 for the red LED.
Each LED needs its own resistor: never connect an LED directly to a GPIO.
The available 10 kOhm resistors can be used safely but the LEDs will be dim;
330 Ohm to 1 kOhm resistors are more visible if obtained later. Reserve one
10 kOhm pull-up per DHT22. The 100 kOhm resistors are not needed.
No connection between the two boards is required. Power each over USB-C.

## Network and gateway

1. Connect the laptop and both boards to the same 2.4 GHz phone hotspot.
   Disable hotspot client isolation if offered. Some hotspots prevent client to
   client traffic; if so, use a Wi-Fi router that permits it.
2. On Windows run `ipconfig` in PowerShell. Under the active Wi-Fi adapter, find
   **IPv4 Address**, such as `192.168.43.25`. Use this address, not localhost,
   the phone's address, or the default gateway. It can change after reconnecting.
3. Edit `WIFI_SSID`, `WIFI_PASSWORD`, `LAPTOP_IP`, and `GATEWAY_PORT` at the top of
   `hardware/uno-r4/src/main.cpp`. Meter IDs and keys are immediately below.
4. Start GridGuard from the repository root in PowerShell:

   ```powershell
   npm.cmd ci
   $env:GG_KEY_MTR001 = 'GG_KEY_MTR001'
   $env:GG_KEY_MTR002 = 'GG_KEY_MTR002'
   npm.cmd run dev
   ```

   These are literal demo key values, not references the board can resolve.
   Existing gateway defaults remain `gridguard-demo-key-A/B` for Wokwi; the
   environment variables above override them for hardware. This server does
   not automatically load `.env`. Restart it after changing environment values.
   Do not stream Wokwi and Arduino with the same meter ID simultaneously.
5. Allow Node.js inbound TCP port 3000 through Windows Firewall for the active
   network profile when prompted. The server already listens on `0.0.0.0`.
   Open `http://<LAPTOP_IP>:3000/api/time` from another hotspot device; expect
   plain Unix epoch seconds. A timeout usually means firewall, wrong IP, or
   hotspot isolation. HTTP is intended for this local prototype.

## Build and upload

Install PlatformIO IDE in VS Code (or its CLI), then open `hardware/uno-r4`
as the PlatformIO project. Its `platformio.ini` specifies the UNO R4 WiFi
board and all external library versions: DHT sensor library, Adafruit Unified
Sensor, Rhys Weatherley's Crypto, ArduinoHttpClient and ArduinoJson. WiFiS3
comes with the board's Arduino framework; no separate WiFi library is needed.

Connect only Meter A initially, choose environment **meter-a**, and click
PlatformIO Upload. Repeat with Meter B using **meter-b**. Alternatively, from
`hardware/uno-r4`, use the PlatformIO terminal (replace COM ports with those
shown in Device Manager > Ports or `pio device list`):

```powershell
pio run -e meter-a -t upload --upload-port COM5
pio run -e meter-b -t upload --upload-port COM6
pio device monitor --port COM5 --baud 115200
```

Use USB data cables. If upload fails, close Serial Monitor, confirm the board
and port, and double-tap RESET to enter bootloader mode if needed. Upload to
the UNO R4's RA4M1, keeping the onboard ESP32 connectivity firmware intact.
Do not upload the old ESP32 firmware to these boards. Keep local Wi-Fi
credentials out of commits.

## Operation and testing

The board obtains epoch seconds from `/api/time`, then uses the existing
`/api/sync/:id?claim=1&source=arduino` to reserve that meter and resume its
energy baseline. Once per boot it then posts `{"meter_id":"<METER_ID>","source":"arduino-live"}`
to `/api/session/start` and waits for `SESSION_STARTED` before sending sequence 1.
Failed handshakes are retried before telemetry. Telemetry uses source `arduino-live`.
Clock refreshes and transport recovery do not start a new session.
After every acknowledged packet it advances sequence,
including when the gateway rejects the reading. On transport failure it blinks
red and resynchronizes before retrying; this also handles a lost response after
acceptance. Clock/counters are refreshed periodically and after rejection.
The DHT22 is sampled no faster than once every two seconds. Invalid sensor
readings show steady red and are not replaced by invented temperature values.

The firmware signs the exact printed numeric tokens in this order:

```text
meter_id|seq|ts|temp_c|voltage_v|current_a|power_kw|alert|energy_wh
```

Humidity and source are included in JSON but are not authenticated by the
existing canonical format. The HTTP handler preserves raw JSON before passing
it through the unchanged security checks. Hardware traffic does not enter the
Wokwi MITM transport. Security policy remains unchanged, including temperature
warnings at 33 C and the 30-second clock skew limit.

With the gateway running and firmware uploaded:

```powershell
Invoke-RestMethod http://localhost:3000/api/time
Invoke-RestMethod http://localhost:3000/api/meters | ConvertTo-Json -Depth 6
Invoke-RestMethod 'http://localhost:3000/api/telemetry?limit=10' | ConvertTo-Json -Depth 6
```

Expect `data_source: arduino` for each active meter, an **Arduino live** badge
on Overview, increasing sequences, `source: arduino` in telemetry, and serial
responses such as `{"verdict":"ACCEPTED","reason":"Packet accepted","meter_status":"online"}`.
Green indicates ACCEPTED; red indicates any other security verdict, including
FLAGGED, REJECTED, WARNING or ISOLATED. A real hot sensor can correctly cause
red. For `invalid_hmac`, check the matching gateway environment variable and
firmware key. An isolated meter must be restored in the dashboard after fixing
the cause. Rejections are visible in `/api/events`, not accepted telemetry.

Unplug only Meter A: after the existing eight-second live timeout, its simulator
resumes while Meter B stays live. Reconnect A: it syncs to the simulator's newer
sequence/energy baseline and takes over again. The simulator settings still
apply: if software simulation is disabled, fallback readings remain disabled.
The original Wokwi bridge and simulator remain available.

Software regression checks from the repository root:

```powershell
npm.cmd run lint
node --import tsx tools/test-arduino.ts
npm.cmd run build
```

These checks exercise the gateway, not a connected physical board. Compile and
upload each PlatformIO environment and confirm the serial responses on hardware.

Reference: [PlatformIO UNO R4 WiFi board](https://docs.platformio.org/en/latest/boards/renesas-ra/uno_r4_wifi.html),
[Arduino WiFiS3 examples](https://github.com/arduino/docs-content/blob/main/content/hardware/uno/boards/uno-r4-wifi/tutorials/wifi-examples/wifi-examples.md),
[Crypto SHA256 HMAC implementation](https://github.com/rweather/arduinolibs/blob/master/libraries/Crypto/SHA256.cpp).
