# Running GridGuard with live Wokwi meters

The built-in simulator keeps working. When a Wokwi meter starts sending for MTR-001 or MTR-002,
the simulator steps aside **for that meter only** and the dashboard card shows **WOKWI LIVE**.
Stop the Wokwi meter and the simulator takes that meter back after ~8 seconds.

## One-time setup
1. VS Code extensions: **PlatformIO IDE** and **Wokwi Simulator** (free license: F1 -> "Wokwi: Request a new License").
2. Build each meter's firmware: open `prototype r2/meter-a` in VS Code (File -> Open Folder), then
   PlatformIO sidebar -> **Build**. Repeat for `prototype r2/meter-b` (use a second VS Code window).

## Every time
1. Terminal 1 (project root): `npm run dev`            -> http://localhost:3000
2. Meter A window: F1 -> **Wokwi: Start Simulator**    (serial exposed on port 4000)
3. Meter B window: F1 -> **Wokwi: Start Simulator**    (serial exposed on port 4001)
4. Terminal 2 (project root): `npm run bridge`

You can run only one meter; the other stays simulated.

## Live MITM attacker (automatic)
Packets from Wokwi meters pass through an on-path attacker inside the gateway before verification, so alerts
appear from live readings with no simulation button. Controls: sidebar -> **Live MITM Attacker**
(on/off, attack type or Auto, attack rate). Default: ON, Auto, 35% of packets.

| Attack | What the attacker does | How the gateway catches it |
|---|---|---|
| Under-report usage | current/power cut to 35% | invalid HMAC |
| False voltage injection | voltage -> 265 V | invalid HMAC |
| Energy register rollback | energy_wh x 0.15 | invalid HMAC |
| Stale timestamp | ts - 10 min | invalid HMAC |
| Replay old packet | re-sends a captured packet | replay detected (sequence) |
| Forged with stolen key | current x3.2, correctly re-signed | behaviour/physics checks (spike, warnings) |

Alerts show the attack in the address column, e.g. `mitm[seq_replay]:wokwi:MTR-001@4000`.
Packets that are not attacked are accepted as normal. Untick the attacker for clean data.

## Acting as the attacker (Live interception page)
Sidebar -> **Live interception**. Pick an attack and a target meter, then press **Strike next live packet**.
The gateway attacks the very next real packet from that meter (even if the automatic attacker is off).
Each strike appears as a card showing the original reading from the meter, what the attacker actually sent
(changed fields highlighted), and the gateway's verdict and reasons. Counters show intercepted / attacked /
caught / missed. "Clear" empties the list.

## What the meter does
- Signs every packet (HMAC-SHA256, demo keys `gridguard-demo-key-A/B`) and sends seq, ts, energy_wh.
- Waits for the bridge's SYNC (clock, next sequence, energy) before transmitting. OLED shows WAIT, LED blue.
- Gateway isolates it -> bridge sends `STATE ISOLATED` -> red LED + slow buzzer. Restore -> green again.
- **Button** cycles scenarios: 0 normal, 1 voltage warning, 2 current warning, 3 temperature critical,
  4 power critical (3 packets -> auto-isolation), 5 meter alert, 6 energy rollback,
  7 tampered signature, 8 replay, 9 unauthorized (MTR-999).
- `USE_SENSORS true` in main.cpp: scenario 0 reads the DHT22 temperature and potentiometer (load).

## Troubleshooting
- Bridge says "waiting for Wokwi on port 4000": start the simulation first (and keep that window open).
- Other gateway port/host: `npm run bridge -- --url http://localhost:3001`
- Different serial ports: `npm run bridge -- --map 4000=MTR-001,4002=MTR-002`
