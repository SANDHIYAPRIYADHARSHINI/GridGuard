// Meter B - Smart Meter MTR-002  (GridGuard prototype r2)
//
// Behaves like the built-in simulator, but as a real signed device:
//   * healthy readings follow the same profile the dashboard simulator uses
//   * every packet carries seq, ts, energy_wh and an HMAC-SHA256 signature
//   * the gateway bridge (npm run bridge) sets the clock and tells the meter when it is isolated
//
// Button: press to cycle through the demo scenarios below (0 = healthy).
//
//   0 normal               5 meter_alert (meter raises its own tamper flag)
//   1 voltage_warning      6 energy_rollback (energy register goes backwards)
//   2 current_warning      7 tampered_signature (value edited after signing)
//   3 temperature_critical 8 replay (re-sends the previous packet)
//   4 power_critical       9 unauthorized (claims to be MTR-999)

#include <Arduino.h>
#include <DHT.h>
#include <Wire.h>
#include <U8g2lib.h>
#include "mbedtls/md.h"

// =============================
// CONFIG
// =============================
#define METER_ID_STR   "MTR-002"
#define METER_KEY      "gridguard-demo-key-B"   // demo key - must match GG_KEY_* on the gateway

// Healthy profile (same numbers the dashboard simulator uses for this meter)
const float BASE_CUR = 1.70f;
const float CUR_AMP  = 0.45f;
const float BASE_TEMP = 29.5f;
const float PHASE    = 2.1f;

// false = synthetic healthy readings (matches simulator)
// true  = scenario 0 reads the DHT22 (temperature) and potentiometer (load) so you can
//         drive the meter by hand in Wokwi
#define USE_SENSORS false

const int PIN_DHT = 15;
const int PIN_POT = 34;
const int PIN_BTN = 4;
const int PIN_BUZZER = 27;
const int PIN_LED_R = 26;
const int PIN_LED_G = 25;
const int PIN_LED_B = 33;

const unsigned long SEND_INTERVAL_MS = 2000;
const int SCENARIO_COUNT = 10;

const char* SCENARIO_NAMES[SCENARIO_COUNT] = {
  "normal", "voltage_warning", "current_warning", "temperature_critical", "power_critical",
  "meter_alert", "energy_rollback", "tampered_signature", "replay", "unauthorized"
};

// =============================
// OBJECTS / STATE
// =============================
DHT dht(PIN_DHT, DHT22);
U8G2_SSD1306_128X64_NONAME_F_HW_I2C u8g2(U8G2_R0, U8X8_PIN_NONE);

bool lastBtnState = HIGH;
bool currentBtnState = HIGH;
bool btnHandled = false;
unsigned long lastDebounceTime = 0;
const unsigned long debounceDelay = 50;

int activeScenario = 0;

// Gateway-provided state (via bridge)
bool synced = false;
uint32_t epochBase = 0;        // unix time at syncMillis
unsigned long syncMillis = 0;
uint32_t seqCounter = 0;
double energyWh = 0.0;
bool isolatedByGateway = false;

unsigned long lastSend = 0;
char lastLine[320] = "";

char rxBuf[96];
size_t rxLen = 0;

// =============================
// HELPERS
// =============================
void setLedColor(bool r, bool g, bool b) {
  digitalWrite(PIN_LED_R, r ? HIGH : LOW);
  digitalWrite(PIN_LED_G, g ? HIGH : LOW);
  digitalWrite(PIN_LED_B, b ? HIGH : LOW);
}

void updateOLED(const char* id, float temp, float voltage, float current, const char* status) {
  u8g2.clearBuffer();
  u8g2.setFont(u8g2_font_ncenB08_tr);
  u8g2.setCursor(0, 12);
  u8g2.print("ID: ");
  u8g2.print(id);
  u8g2.setCursor(0, 28);
  u8g2.print("Temp: ");
  u8g2.print(temp, 1);
  u8g2.print(" C");
  u8g2.setCursor(0, 44);
  u8g2.print("V: ");
  u8g2.print(voltage, 1);
  u8g2.print(" V");
  u8g2.setCursor(0, 60);
  u8g2.print("I: ");
  u8g2.print(current, 1);
  u8g2.print(" A ");
  u8g2.print(status);
  u8g2.sendBuffer();
}

float randGauss(float sd) {
  float u = random(1, 10000) / 10000.0f;
  float v = random(0, 10000) / 10000.0f;
  return sd * sqrtf(-2.0f * logf(u)) * cosf(6.2831853f * v);
}

uint32_t nowEpoch() {
  return epochBase + (millis() - syncMillis) / 1000UL;
}

void hmacHex(const char* key, const char* msg, char* out65) {
  uint8_t h[32];
  const mbedtls_md_info_t* info = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  mbedtls_md_context_t ctx;
  mbedtls_md_init(&ctx);
  mbedtls_md_setup(&ctx, info, 1);
  mbedtls_md_hmac_starts(&ctx, (const unsigned char*)key, strlen(key));
  mbedtls_md_hmac_update(&ctx, (const unsigned char*)msg, strlen(msg));
  mbedtls_md_hmac_finish(&ctx, h);
  mbedtls_md_free(&ctx);
  for (int i = 0; i < 32; i++) sprintf(out65 + i * 2, "%02x", h[i]);
  out65[64] = 0;
}

// ---- BEGIN PACKET CORE (host-tested against the gateway) ----
// The gateway verifies the HMAC over the exact text printed below, so what is signed and
// what is printed must come from the same strings.
void buildPacket(char* out, size_t outSize, const char* id, uint32_t seq, uint32_t ts,
                 float temp, float volt, float cur, float power, bool alert, double energy,
                 bool tamperAfterSigning, const char* scenario) {
  char t[16], v[16], c[16], p[16], e[24], c2[16];
  snprintf(t, sizeof(t), "%.1f", temp);
  snprintf(v, sizeof(v), "%.1f", volt);
  snprintf(c, sizeof(c), "%.2f", cur);
  snprintf(p, sizeof(p), "%.2f", power);
  snprintf(e, sizeof(e), "%.2f", energy);

  char msg[160];
  snprintf(msg, sizeof(msg), "%s|%lu|%lu|%s|%s|%s|%s|%s|%s", id, (unsigned long)seq,
           (unsigned long)ts, t, v, c, p, alert ? "true" : "false", e);

  char sig[65];
  hmacHex(METER_KEY, msg, sig);

  // Tamper demo: edit the current AFTER signing, so the signature no longer matches.
  const char* printedCur = c;
  if (tamperAfterSigning) {
    snprintf(c2, sizeof(c2), "%.2f", cur * 0.1f);
    printedCur = c2;
  }

  snprintf(out, outSize,
           "{\"meter_id\":\"%s\",\"seq\":%lu,\"ts\":%lu,\"temp_c\":%s,\"voltage_v\":%s,"
           "\"current_a\":%s,\"power_kw\":%s,\"alert\":%s,\"energy_wh\":%s,\"hmac\":\"%s\","
           "\"scenario\":\"%s\"}",
           id, (unsigned long)seq, (unsigned long)ts, t, v, printedCur, p,
           alert ? "true" : "false", e, sig, scenario);
}
// ---- END PACKET CORE ----

// Lines from the bridge:  "SYNC <epoch> <last_seq> <energy_wh>"   "STATE ISOLATED|ONLINE"
void handleLine(char* l) {
  if (strncmp(l, "SYNC ", 5) == 0) {
    char* p;
    uint32_t e = strtoul(l + 5, &p, 10);
    uint32_t s = strtoul(p, &p, 10);
    double wh = strtod(p, &p);
    epochBase = e;
    syncMillis = millis();
    if (s > seqCounter) seqCounter = s;
    if (wh > energyWh) energyWh = wh;
    synced = true;
  } else if (strncmp(l, "STATE ", 6) == 0) {
    isolatedByGateway = (strcmp(l + 6, "ISOLATED") == 0);
  }
}

void pollSerial() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      if (rxLen > 0) {
        rxBuf[rxLen] = 0;
        handleLine(rxBuf);
        rxLen = 0;
      }
    } else if (rxLen < sizeof(rxBuf) - 1) {
      rxBuf[rxLen++] = c;
    }
  }
}

// =============================
// SETUP
// =============================
void setup() {
  Serial.begin(115200);

  pinMode(PIN_BTN, INPUT_PULLUP);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_LED_R, OUTPUT);
  pinMode(PIN_LED_G, OUTPUT);
  pinMode(PIN_LED_B, OUTPUT);
  digitalWrite(PIN_BUZZER, LOW);
  setLedColor(false, false, true);  // blue = waiting for gateway

  dht.begin();
  randomSeed(micros());
  Wire.begin();
  u8g2.begin();

  updateOLED(METER_ID_STR, 0.0, 0.0, 0.0, "WAIT");
  Serial.println("# GridGuard meter " METER_ID_STR " booted - waiting for gateway SYNC (run: npm run bridge)");
}

// =============================
// LOOP
// =============================
void loop() {
  pollSerial();

  // Button debounce + scenario cycling
  bool reading = digitalRead(PIN_BTN);
  if (reading != lastBtnState) lastDebounceTime = millis();
  if ((millis() - lastDebounceTime) > debounceDelay) currentBtnState = reading;
  lastBtnState = reading;
  if (currentBtnState == LOW && !btnHandled) {
    activeScenario = (activeScenario + 1) % SCENARIO_COUNT;
    btnHandled = true;
    Serial.print("# scenario -> ");
    Serial.println(SCENARIO_NAMES[activeScenario]);
  } else if (currentBtnState == HIGH) {
    btnHandled = false;
  }

  // ---- readings for this scenario ----
  float secs = millis() / 1000.0f;
  float temp = BASE_TEMP + 1.6f * sinf(secs / 47.0f + PHASE) + randGauss(0.15f);
  float volt = 230.0f + 2.2f * sinf(secs / 31.0f + PHASE) + randGauss(0.5f);
  float cur = BASE_CUR + CUR_AMP * sinf(secs / 18.0f + PHASE) + randGauss(0.05f);
#if USE_SENSORS
  if (activeScenario == 0) {
    float t = dht.readTemperature();
    if (!isnan(t)) temp = t;
    cur = 0.5f + (analogRead(PIN_POT) / 4095.0f) * 8.0f;
  }
#endif
  if (cur < 0.1f) cur = 0.1f;

  bool alertFlag = false;
  const char* idOut = METER_ID_STR;
  switch (activeScenario) {
    case 1: volt = 246.0f; break;
    case 2: temp = 35.0f; volt = 235.0f; cur = 4.0f; break;
    case 3: temp = 45.0f; break;
    case 4: temp = 45.0f; volt = 250.0f; cur = 9.5f; break;
    case 5: alertFlag = true; break;
    case 9: idOut = "MTR-999"; break;
    default: break;
  }
  float power = volt * cur / 1000.0f;

  // ---- local indication ----
  const char* status = "OK";
  if (!synced) {
    status = "WAIT";
    setLedColor(false, false, true);
    digitalWrite(PIN_BUZZER, LOW);
  } else if (isolatedByGateway) {
    status = "ISOL";
    setLedColor(true, false, false);
    digitalWrite(PIN_BUZZER, (millis() / 500) % 2 ? HIGH : LOW);  // slow beep
  } else if (alertFlag || currentBtnState == LOW) {
    status = "ALERT";
    setLedColor(true, false, false);
    digitalWrite(PIN_BUZZER, HIGH);
  } else {
    setLedColor(false, true, false);
    digitalWrite(PIN_BUZZER, LOW);
  }
  updateOLED(idOut, temp, volt, cur, status);

  // ---- telemetry ----
  if (synced && millis() - lastSend >= SEND_INTERVAL_MS) {
    lastSend = millis();

    char line[320];
    if (activeScenario == 8 && lastLine[0]) {
      // replay: re-send the previous packet byte-for-byte
      strncpy(line, lastLine, sizeof(line));
      line[sizeof(line) - 1] = 0;
    } else {
      seqCounter++;
      energyWh += (double)power * 1000.0 * (SEND_INTERVAL_MS / 1000.0) / 3600.0;
      double reportedWh = (activeScenario == 6) ? energyWh * 0.2 : energyWh;
      buildPacket(line, sizeof(line), idOut, seqCounter, nowEpoch(), temp, volt, cur, power,
                  alertFlag, reportedWh, activeScenario == 7, SCENARIO_NAMES[activeScenario]);
      strncpy(lastLine, line, sizeof(lastLine));
      lastLine[sizeof(lastLine) - 1] = 0;
    }
    Serial.println(line);
  }

  delay(50);
}
