/*
 * SmartEnergy Meter — ESP32 Firmware
 * Sensor: PZEM-004T v3.0 (recommended) or ACS712 + ZMPT101B
 *
 * Wiring (PZEM-004T):
 *   PZEM TX → ESP32 GPIO 16 (RX2)
 *   PZEM RX → ESP32 GPIO 17 (TX2)
 *   PZEM VCC → 5V, GND → GND
 *
 * Libraries needed (install via Arduino Library Manager):
 *   - PZEM004Tv30  by Olexa Prokopenko
 *   - ArduinoJson  by Benoit Blanchon
 *   - WiFi         (built-in ESP32)
 *   - HTTPClient   (built-in ESP32)
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <PZEM004Tv30.h>

// ── CONFIG — change these ─────────────────────────────────────────────────────
const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// Your server IP (same network as ESP32)
// If running on laptop: find IP with   ipconfig (Windows) / ifconfig (Mac/Linux)
const char* SERVER_URL    = "http://192.168.1.100:5000/api/readings";

// Must match ESP_SECRET in server/.env
const char* ESP_TOKEN     = "esp32_secret_token_change_this";

// Your MSEDCL consumer number — must match a registered user in MongoDB
const char* CONSUMER_NO   = "170213894059";

// How often to send data (milliseconds)
const int   SEND_INTERVAL = 5000;   // 5 seconds
// ─────────────────────────────────────────────────────────────────────────────

// PZEM on Serial2 (GPIO 16=RX, 17=TX)
PZEM004Tv30 pzem(Serial2, 16, 17);

unsigned long lastSend = 0;

void setup() {
  Serial.begin(115200);
  Serial2.begin(9600, SERIAL_8N1, 16, 17);

  Serial.println("\n[SmartEnergy] Connecting to WiFi...");
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500); Serial.print(".");
  }
  Serial.println("\n[SmartEnergy] WiFi connected: " + WiFi.localIP().toString());
}

void loop() {
  if (millis() - lastSend < SEND_INTERVAL) return;
  lastSend = millis();

  // Read from PZEM-004T
  float voltage     = pzem.voltage();
  float current     = pzem.current();
  float power       = pzem.power();
  float energy      = pzem.energy();    // kWh cumulative
  float frequency   = pzem.frequency();
  float powerFactor = pzem.pf();

  // Check for NaN (sensor not connected or error)
  if (isnan(voltage) || isnan(current) || isnan(power)) {
    Serial.println("[SmartEnergy] Sensor read error — check PZEM wiring");
    return;
  }

  float reactivePower = 0;
  if (powerFactor > 0 && powerFactor <= 1) {
    float phi = acos(powerFactor);
    reactivePower = power * tan(phi);
  }

  Serial.printf("[SmartEnergy] V=%.1f A=%.3f W=%.1f kWh=%.3f Hz=%.1f PF=%.2f\n",
                voltage, current, power, energy, frequency, powerFactor);

  // Send to server
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[SmartEnergy] WiFi lost — reconnecting...");
    WiFi.reconnect();
    return;
  }

  HTTPClient http;
  http.begin(SERVER_URL);
  http.addHeader("Content-Type",  "application/json");
  http.addHeader("x-esp-token",   ESP_TOKEN);

  StaticJsonDocument<256> doc;
  doc["consumerNo"]    = CONSUMER_NO;
  doc["voltage"]       = voltage;
  doc["current"]       = current;
  doc["power"]         = power;
  doc["energy"]        = energy;
  doc["frequency"]     = frequency;
  doc["powerFactor"]   = powerFactor;
  doc["reactivePower"] = reactivePower;
  doc["source"]        = "esp";

  String body;
  serializeJson(doc, body);

  int code = http.POST(body);
  if (code == 201) {
    Serial.println("[SmartEnergy] ✓ Data sent successfully");
  } else {
    Serial.printf("[SmartEnergy] ✗ HTTP %d — %s\n", code, http.getString().c_str());
  }

  http.end();
}
