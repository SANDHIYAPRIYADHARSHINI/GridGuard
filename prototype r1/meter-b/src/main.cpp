// Meter B - Smart Meter MTR-002
// Unauthorized / Secondary Meter with Demo Scenarios
#include <Arduino.h>
#include <DHT.h>
#include <Wire.h>
#include <U8g2lib.h>

// =============================
// CONFIG
// =============================

const String METER_ID = "MTR-999";

const int PIN_DHT = 15;
const int PIN_POT = 34;
const int PIN_BTN = 4;
const int PIN_BUZZER = 27;
const int PIN_LED_R = 26;
const int PIN_LED_G = 25;
const int PIN_LED_B = 33;

// -----------------------------
// DEMO MODE (HARDCODED VALUES)
// -----------------------------
// Set to true for panel demo (hardcoded values).
// Set to false for live sensor/random readings.
#define DEMO_MODE false
#define RANDOM_VALUES true

// Choose one scenario for demo:
// 0 = Normal operation
// 1 = Slightly high power (suspicious)
// 2 = Extreme power spike (clear anomaly)
// 3 = Unauthorized / fake meter (e.g., set METER_ID = "UNKNOWN")
#define DEMO_SCENARIO 0

// =============================
// OBJECTS
// =============================

DHT dht(PIN_DHT, DHT22);
U8G2_SSD1306_128X64_NONAME_F_HW_I2C u8g2(U8G2_R0, U8X8_PIN_NONE);

// =============================
// STATE & TIMING
// =============================

bool alertMode = false;

// Button state
bool lastBtnState = HIGH;
bool currentBtnState = HIGH;
unsigned long lastDebounceTime = 0;
const unsigned long DEBOUNCE_DELAY_MS = 50;

unsigned long lastSend = 0;
const unsigned long SEND_INTERVAL_MS = 2000;

// =============================
// HELPERS
// =============================

void setLedColor(bool r, bool g, bool b) {
  digitalWrite(PIN_LED_R, r ? HIGH : LOW);
  digitalWrite(PIN_LED_G, g ? HIGH : LOW);
  digitalWrite(PIN_LED_B, b ? HIGH : LOW);
}

void updateOLED(float temp, float voltage, float current, const char* status) {
  u8g2.clearBuffer();
  u8g2.setFont(u8g2_font_ncenB08_tr);

  u8g2.setCursor(0, 12);
  u8g2.print("ID: ");
  u8g2.print(METER_ID.c_str());

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
  u8g2.print(" A  ");
  u8g2.print(status);

  u8g2.sendBuffer();
}

void triggerAlert() {
  alertMode = true;
  setLedColor(true, false, false); // Red
  digitalWrite(PIN_BUZZER, HIGH);
  delay(200);                      // Short beep
  digitalWrite(PIN_BUZZER, LOW);
}

void clearAlert() {
  alertMode = false;
  setLedColor(false, true, false); // Green
  digitalWrite(PIN_BUZZER, LOW);
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

  // Initial normal status
  digitalWrite(PIN_BUZZER, LOW);
  setLedColor(false, true, false); // Green

  dht.begin();
  randomSeed(micros());
  Wire.begin();
  u8g2.begin();

  updateOLED(0.0, 0.0, 0.0, "Booting...");
  delay(1000);
}

// =============================
// LOOP
// =============================

void loop() {
  float temp = 0.0;
  float simVoltage = 230.0;
  float simCurrent = 1.0;

#if DEMO_MODE == true
  // HARDCODED DEMO VALUES
  if (DEMO_SCENARIO == 0) {
    // Normal operation
    temp = 28.0;
    simVoltage = 230.0;
    simCurrent = 1.2;
  } else if (DEMO_SCENARIO == 1) {
    // Slightly high power (suspicious)
    temp = 35.0;
    simVoltage = 235.0;
    simCurrent = 4.0;
  } else if (DEMO_SCENARIO == 2) {
    // Extreme power spike (clear anomaly)
    temp = 45.0;
    simVoltage = 250.0;
    simCurrent = 9.5;
  } else if (DEMO_SCENARIO == 3) {
    // Unauthorized meter scenario
    temp = 30.0;
    simVoltage = 230.0;
    simCurrent = 2.0;
  }
#else
  // LIVE SENSOR MODE: use random values for a self-running presentation.
#if RANDOM_VALUES
  temp = random(200, 351) / 10.0;                // 20.0–35.0 °C
  simVoltage = random(2200, 2401) / 10.0;         // 220.0–240.0 V
  simCurrent = random(50, 551) / 100.0;           // 0.50–5.50 A
#else
  float t = dht.readTemperature();
  if (!isnan(t)) {
    temp = t;
  }
  int potVal = analogRead(PIN_POT);
  simVoltage = 220.0 + (potVal / 4095.0) * 20.0;
  simCurrent = 0.5 + (potVal / 4095.0) * 5.0;
#endif
#endif

  float simPower = (simVoltage * simCurrent) / 1000.0; // kW

  // Button Read & Debounce Logic
  bool reading = digitalRead(PIN_BTN);
  if (reading != lastBtnState) {
    lastDebounceTime = millis();
  }

  if ((millis() - lastDebounceTime) > DEBOUNCE_DELAY_MS) {
    currentBtnState = reading;
  }
  lastBtnState = reading;

  // Active-LOW button detection
  bool buttonPressed = (currentBtnState == LOW);

  if (buttonPressed) {
    setLedColor(true, false, false); // Red
    digitalWrite(PIN_BUZZER, HIGH);
  } else {
    setLedColor(false, true, false); // Green
    digitalWrite(PIN_BUZZER, LOW);
  }

  const char* status = buttonPressed ? "ALERT" : "OK";
  updateOLED(temp, simVoltage, simCurrent, status);

  // Send Telemetry Payload
  unsigned long now = millis();
  if (now - lastSend >= SEND_INTERVAL_MS) {
    lastSend = now;

    Serial.print("{\"meter_id\":\"");
    Serial.print(METER_ID);
    Serial.print("\",\"temp_c\":");
    Serial.print(temp, 1);
    Serial.print(",\"voltage_v\":");
    Serial.print(simVoltage, 1);
    Serial.print(",\"current_a\":");
    Serial.print(simCurrent, 1);
    Serial.print(",\"power_kw\":");
    Serial.print(simPower, 2);
    Serial.print(",\"alert\":");
    Serial.print(buttonPressed ? "true" : "false");
    Serial.println("}");
  }

  delay(20);
}