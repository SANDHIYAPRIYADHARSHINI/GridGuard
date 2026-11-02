#include <Arduino.h>
#include <WiFiS3.h>
#include <ArduinoHttpClient.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include <SHA256.h>

// Change these four settings for your phone hotspot and laptop.
const char WIFI_SSID[] = "YOUR_HOTSPOT_SSID";
const char WIFI_PASSWORD[] = "YOUR_HOTSPOT_PASSWORD";
const char LAPTOP_IP[] = "192.168.1.100"; // IPv4 address, without http://
const uint16_t GATEWAY_PORT = 3000;
// Select the PlatformIO environment, or change BOTH meter ID and HMAC key here.
#ifdef GRIDGUARD_METER_B
const char METER_ID[] = "MTR-002";
const char HMAC_KEY[] = "GG_KEY_MTR002";
#else
const char METER_ID[] = "MTR-001";
const char HMAC_KEY[] = "GG_KEY_MTR001";
#endif
const uint8_t DHT_PIN = 2, GREEN_PIN = 5, RED_PIN = 6;
const uint32_t SAMPLE_MS = 2000;
DHT dht(DHT_PIN, DHT22);
bool synced = false, connectionFault = true;
bool sessionStarted = false;
uint32_t epoch = 0, clockTick = 0, lastSync = 0, lastSample = 0;
uint32_t seq = 1;
double energyWh = 0;

void leds(bool green, bool red) {
  digitalWrite(GREEN_PIN, green);
  digitalWrite(RED_PIN, red);
}

// Bounded HTTP requests; close each socket so stale keep-alive connections cannot linger.
bool request(const String &path, const String &body, String &response) {
  WiFiClient socket;
  HttpClient http(socket, LAPTOP_IP, GATEWAY_PORT);
  http.setHttpResponseTimeout(3000);
  int err = body.length() ? http.post(path, "application/json", body) : http.get(path);
  int status = err == 0 ? http.responseStatusCode() : -1;
  response = status > 0 ? http.responseBody() : "";
  http.stop();
  return status >= 200 && status < 300 && response.length() > 0;
}

bool startHardwareSession() {
  String response;
  String body = String("{\"meter_id\":\"") + METER_ID + "\",\"source\":\"arduino-live\"}";
  if (!request("/api/session/start", body, response)) return false;
  JsonDocument doc;
  if (deserializeJson(doc, response) ||
      doc["verdict"].as<String>() != "SESSION_STARTED" ||
      doc["meter_id"].as<String>() != METER_ID) return false;
  seq = 1;
  sessionStarted = true;
  return true;
}

bool synchronize() {
  String response;
  if (!request("/api/time", "", response)) return false;
  uint32_t serverEpoch = strtoul(response.c_str(), nullptr, 10);
  if (serverEpoch < 1700000000UL) return false;
  epoch = serverEpoch;
  clockTick = millis();
  // Claim before first packet: simulator must stop before we read its last counters.
  String url = String("/api/sync/") + METER_ID + "?claim=1&source=arduino";
  if (!request(url, "", response)) return false;
  JsonDocument doc;
  if (deserializeJson(doc, response) || !doc["last_seq"].is<uint32_t>() ||
      !doc["reported_wh"].is<double>()) return false;
  seq = doc["last_seq"].as<uint32_t>() + 1;
  energyWh = doc["reported_wh"].as<double>();
  // Only boot opens a new session. Clock refreshes and HTTP retries keep it.
  if (!sessionStarted && !startHardwareSession()) return false;
  lastSync = millis();
  lastSample = millis();
  return true;
}

String signature(const String &message) {
  SHA256 hash;
  uint8_t digest[32];
  hash.resetHMAC(HMAC_KEY, strlen(HMAC_KEY));
  hash.update(message.c_str(), message.length());
  hash.finalizeHMAC(HMAC_KEY, strlen(HMAC_KEY), digest, sizeof(digest));
  const char hex[] = "0123456789abcdef";
  String result;
  result.reserve(64);
  for (uint8_t b : digest) { result += hex[b >> 4]; result += hex[b & 15]; }
  return result;
}

void setup() {
  pinMode(GREEN_PIN, OUTPUT);
  pinMode(RED_PIN, OUTPUT);
  Serial.begin(115200); // Do not wait for USB serial; boards also run unattended.
  dht.begin();
}

void loop() {
  uint32_t now = millis();
  if (connectionFault) leds(false, (now / 300) % 2);
  if (WiFi.status() != WL_CONNECTED) {
    connectionFault = true;
    synced = false;
    static uint32_t lastAttempt = 0;
    if (now - lastAttempt >= 5000 || lastAttempt == 0) {
      lastAttempt = now;
      leds(false, true);
      WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    }
    return;
  }
  static uint32_t lastSyncAttempt = 0;
  if (!synced) {
    if (now - lastSyncAttempt < 2000) return;
    lastSyncAttempt = now;
    synced = synchronize();
    connectionFault = !synced;
    return;
  }
  // Accumulate unsigned millis differences to tolerate the millis() wraparound.
  uint32_t seconds = (now - clockTick) / 1000;
  epoch += seconds;
  clockTick += seconds * 1000;
  if (now - lastSample < SAMPLE_MS) return;
  uint32_t elapsed = now - lastSample;
  lastSample = now;
  float temp = dht.readTemperature(), humidity = dht.readHumidity();
  if (isnan(temp) || isnan(humidity)) {
    leds(false, true);
    Serial.println("DHT22 read failed: check wiring and pull-up");
    return;
  }
  // Electrical values are simulated until a current/voltage sensor is fitted.
  String voltage = "230.0";
  String current = String(String(METER_ID) == "MTR-002" ? 1.70 : 1.25, 2);
  double power = voltage.toFloat() * current.toFloat() / 1000.0;
  energyWh += power * elapsed / 3600.0;
  String temperature(temp, 1), watts(power, 4), energy(energyWh, 4);
  String alert = temp >= 33.0 ? "true" : "false";
  String canonical = String(METER_ID) + "|" + seq + "|" + epoch + "|" + temperature +
    "|" + voltage + "|" + current + "|" + watts + "|" + alert + "|" + energy;
  // Reuse identical number strings in the canonical message and raw JSON.
  String packet = String("{\"meter_id\":\"") + METER_ID + "\",\"seq\":" + seq +
    ",\"ts\":" + epoch + ",\"temp_c\":" + temperature + ",\"humidity\":" + String(humidity, 1) +
    ",\"voltage_v\":" + voltage + ",\"current_a\":" + current + ",\"power_kw\":" + watts +
    ",\"alert\":" + alert + ",\"energy_wh\":" + energy + ",\"hmac\":\"" + signature(canonical) +
    "\",\"source\":\"arduino-live\"}";
  String response;
  if (!request("/api/telemetry", packet, response)) {
    connectionFault = true;
    synced = false; // Response may be lost after acceptance: resync before retrying.
    return;
  }
  JsonDocument doc;
  if (deserializeJson(doc, response) || !doc["verdict"].is<const char *>()) {
    connectionFault = true;
    synced = false;
    return;
  }
  ++seq; // Successfully delivered and acknowledged, including a security rejection.
  connectionFault = false;
  const String verdict = doc["verdict"].as<String>();
  leds(verdict == "ACCEPTED", verdict != "ACCEPTED");
  Serial.println(response);
  // Reconcile after gateway reset/fallback and refresh clock at least once a minute.
  if (verdict == "REJECTED" || millis() - lastSync >= 60000) synced = false;
}
