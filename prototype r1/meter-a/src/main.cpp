// Meter A - Smart Meter MTR-001
// Normal meter with demo scenarios.
#include <Arduino.h>
#include <DHT.h>
#include <Wire.h>
#include <U8g2lib.h>

// =============================
// CONFIG
// =============================

const String METER_ID = "MTR-001";

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
// Set to true for a button-controlled viva demo.
// Set to false for live sensor/random readings.
#define DEMO_MODE false
#define RANDOM_VALUES true

// Starting scenario. Press the button to cycle through all scenarios.
#define DEMO_SCENARIO 0
#define DEMO_SCENARIO_COUNT 7

// =============================
// OBJECTS
// =============================

DHT dht(PIN_DHT, DHT22);
U8G2_SSD1306_128X64_NONAME_F_HW_I2C u8g2(U8G2_R0, U8X8_PIN_NONE);

// =============================
// STATE
// =============================

bool alertMode = false;

// Button debounce state
bool lastBtnState = HIGH;
bool currentBtnState = HIGH;
unsigned long lastDebounceTime = 0;
const unsigned long debounceDelay = 50;
int activeScenario = DEMO_SCENARIO;

// =============================
// HELPERS
// =============================

void setLedColor(bool r, bool g, bool b) {
  digitalWrite(PIN_LED_R, r ? HIGH : LOW);
  digitalWrite(PIN_LED_G, g ? HIGH : LOW);
  digitalWrite(PIN_LED_B, b ? HIGH : LOW);
}

void updateOLED(const String& displayId, float temp, float voltage, float current, const char* status) {
  u8g2.clearBuffer();
  u8g2.setFont(u8g2_font_ncenB08_tr);

  u8g2.setCursor(0, 12);
  u8g2.print("ID: ");
  u8g2.print(displayId.c_str());

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
  setLedColor(true, false, false); // red
  digitalWrite(PIN_BUZZER, HIGH);
  delay(200);                      // short beep
  digitalWrite(PIN_BUZZER, LOW);
}

void clearAlert() {
  alertMode = false;
  setLedColor(false, true, false); // green
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

  // Start in normal state
  digitalWrite(PIN_BUZZER, LOW);
  setLedColor(false, true, false); // green

  dht.begin();
  randomSeed(micros());
  Wire.begin();
  u8g2.begin();

  updateOLED(METER_ID, 0.0, 0.0, 0.0, "Booting...");
  delay(1000);
}


// =============================
// LOOP
// =============================

unsigned long lastSend = 0;
const unsigned long SEND_INTERVAL_MS = 2000;

void loop() {
  float temp = 0.0;
  float simVoltage = 230.0;
  float simCurrent = 1.0;
  bool simulatedAlert = false;
  String outputMeterId = METER_ID;
  const char* scenarioName = "live";

  bool reading = digitalRead(PIN_BTN);
  if (reading != lastBtnState) {
    lastDebounceTime = millis();
  }
  if ((millis() - lastDebounceTime) > debounceDelay) {
    currentBtnState = reading;
  }
  lastBtnState = reading;

#if DEMO_MODE == true
  // Press the button once to move to the next viva scenario.
  static bool scenarioButtonHandled = false;
  if (currentBtnState == LOW && !scenarioButtonHandled) {
    activeScenario = (activeScenario + 1) % DEMO_SCENARIO_COUNT;
    scenarioButtonHandled = true;
  } else if (currentBtnState == HIGH) {
    scenarioButtonHandled = false;
  }

  switch (activeScenario) {
    case 0: // Normal baseline
      temp = 28.0; simVoltage = 230.0; simCurrent = 1.2; scenarioName = "normal"; break;
    case 1: // Voltage warning: outside 216-244 V, below critical 200-255 V
      temp = 28.0; simVoltage = 246.0; simCurrent = 1.2; scenarioName = "voltage_warning"; break;
    case 2: // Current and power warning
      temp = 35.0; simVoltage = 235.0; simCurrent = 4.0; scenarioName = "current_warning"; break;
    case 3: // Temperature critical
      temp = 45.0; simVoltage = 230.0; simCurrent = 1.2; scenarioName = "temperature_critical"; break;
    case 4: // Power and current critical
      temp = 45.0; simVoltage = 250.0; simCurrent = 9.5; scenarioName = "power_critical"; break;
    case 5: // Allow-list rejection demonstration
      temp = 30.0; simVoltage = 230.0; simCurrent = 2.0;
      outputMeterId = "MTR-999"; scenarioName = "unauthorized"; break;
    case 6: // Meter-local alert demonstration
      temp = 30.0; simVoltage = 230.0; simCurrent = 2.0;
      simulatedAlert = true; scenarioName = "meter_alert"; break;
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

  float simPower = simVoltage * simCurrent / 1000.0; // kW (demo scaling)

  bool buttonPressed = (currentBtnState == LOW) || simulatedAlert;

  if (buttonPressed) {
    // Alert condition: red LED + buzzer ON
    setLedColor(true, false, false); // red
    digitalWrite(PIN_BUZZER, HIGH);
  } else {
    // Normal condition: green LED + buzzer OFF
    setLedColor(false, true, false); // green
    digitalWrite(PIN_BUZZER, LOW);
  }

  const char* status = buttonPressed ? "ALERT" : "OK";
  updateOLED(outputMeterId, temp, simVoltage, simCurrent, status);

  unsigned long now = millis();
  if (now - lastSend >= SEND_INTERVAL_MS) {
    lastSend = now;

    // JSON telemetry
    Serial.print("{\"meter_id\":\"");
    Serial.print(outputMeterId);
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
    Serial.print(",\"scenario\":\"");
    Serial.print(scenarioName);
    Serial.print("\"");
    Serial.println("}");
  }

  delay(50);
}