export const ESP32_HARDWARE_CODE = `/*
 * IoT-Based Coal Mine Safety Monitoring & Emergency Alert System
 * Firmware: ESP32-WROOM-32 + LoRa SX1276 + Sensors
 * 
 * Hardware Pin Connections:
 * - MQ-4 Methane Sensor (Analog): GPIO 34 (ADC1_CH6)
 * - MQ-7 Carbon Monoxide (Analog): GPIO 35 (ADC1_CH7)
 * - DHT22 Temp/Humidity (Digital): GPIO 4
 * - MPU6050 Accelerometer (I2C):   SDA -> GPIO 21, SCL -> GPIO 22
 * - Relay 1 (Exhaust Fan):         GPIO 26
 * - Piezo Buzzer / Alarm Siren:    GPIO 27
 * - LoRa SX1276 (SPI):             NSS:5, RST:14, DIO0:2, SCK:18, MISO:19, MOSI:23
 */

#include <WiFi.h>
#include <Wire.h>
#include <DHT.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <SPI.h>
#include <LoRa.h>

// Pin Definitions
#define MQ4_PIN         34
#define MQ7_PIN         35
#define DHT_PIN         4
#define DHT_TYPE        DHT22
#define RELAY_FAN_PIN   26
#define BUZZER_PIN      27
#define LORA_SS         5
#define LORA_RST        14
#define LORA_DIO0       2

// Safety Threshold Definitions
#define METHANE_WARN_LEL 1.25    // 1.25% LEL Methane Warning
#define METHANE_EVAC_LEL 2.00    // 2.00% LEL Evacuation Trigger
#define CO_WARN_PPM      50.0    // 50 ppm CO Safe limit
#define CO_DANGER_PPM    150.0   // 150 ppm CO High hazard
#define TEMP_MAX_LIMIT   38.0    // 38°C High Heat Limit
#define FALL_G_THRESHOLD 3.2     // Acceleration spike for Miner fall (>3.2g)

// Sensor Objects
DHT dht(DHT_PIN, DHT_TYPE);
Adafruit_MPU6050 mpu;

// Node Identifier
const String MINE_NODE_ID = "NODE_DEEP_SHAFT_01";

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("==========================================");
  Serial.println("  MINEGUARD IoT Node Initializing...     ");
  Serial.println("==========================================");

  // Pin Configurations
  pinMode(MQ4_PIN, INPUT);
  pinMode(MQ7_PIN, INPUT);
  pinMode(RELAY_FAN_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);

  digitalWrite(RELAY_FAN_PIN, LOW); // Fan Normal Off/Low
  digitalWrite(BUZZER_PIN, LOW);    // Siren Silent

  // Initialize Sensors
  dht.begin();
  
  if (!mpu.begin()) {
    Serial.println("[ERROR] Could not find MPU6050 accelerometer!");
  } else {
    Serial.println("[OK] MPU6050 Motion Sensor Ready.");
    mpu.setAccelerometerRange(MPU6050_RANGE_8_G);
  }

  // Initialize LoRa Module (868 MHz)
  LoRa.setPins(LORA_SS, LORA_RST, LORA_DIO0);
  if (!LoRa.begin(868E6)) {
    Serial.println("[ERROR] LoRa Radio Initialization Failed!");
  } else {
    Serial.println("[OK] LoRa Transceiver Online @ 868MHz.");
  }
}

void loop() {
  // 1. Read Analog Gas Sensors
  int mq4_raw = analogRead(MQ4_PIN);
  int mq7_raw = analogRead(MQ7_PIN);

  // Convert Raw ADC to LEL % and PPM (Calibrated for MQ-4 and MQ-7)
  float methane_lel = (mq4_raw / 4095.0) * 3.5;   // 0 - 3.5% LEL
  float co_ppm = (mq7_raw / 4095.0) * 250.0;     // 0 - 250 ppm

  // 2. Read DHT22 Temperature and Humidity
  float temperature = dht.readTemperature();
  float humidity = dht.readHumidity();
  if (isnan(temperature)) temperature = 25.0;
  if (isnan(humidity)) humidity = 60.0;

  // 3. Read Accelerometer (Miner Fall Detection)
  sensors_event_t a, g, temp_mpu;
  mpu.getEvent(&a, &g, &temp_mpu);
  float total_g = sqrt(a.acceleration.x * a.acceleration.x + 
                       a.acceleration.y * a.acceleration.y + 
                       a.acceleration.z * a.acceleration.z) / 9.81;
  
  bool miner_fall_detected = (total_g > FALL_G_THRESHOLD);

  // 4. Safety Logic & Automated Emergency Relays
  bool warning = false;
  bool emergency = false;

  if (methane_lel >= METHANE_EVAC_LEL || co_ppm >= CO_DANGER_PPM || miner_fall_detected) {
    emergency = true;
  } else if (methane_lel >= METHANE_WARN_LEL || co_ppm >= CO_WARN_PPM || temperature > TEMP_MAX_LIMIT) {
    warning = true;
  }

  // Execute Local Emergency Control Actions
  if (emergency) {
    digitalWrite(RELAY_FAN_PIN, HIGH);  // Boost Exhaust Fan
    tone(BUZZER_PIN, 2400, 800);        // High Frequency Siren Alarm
    Serial.println("[ALERT] EMERGENCY! METHANE/CO EXCEEDED OR MINER FALL!");
  } else if (warning) {
    digitalWrite(RELAY_FAN_PIN, HIGH);  // Fan Boost for Gas Ventilation
    noTone(BUZZER_PIN);
    Serial.println("[WARNING] Gas Threshold Warning - Ventilation Triggered.");
  } else {
    digitalWrite(RELAY_FAN_PIN, LOW);   // Normal Operation
    noTone(BUZZER_PIN);
  }

  // 5. Package Telemetry & Broadcast via LoRa Packet
  String payload = "{" +
    String("\\"node\\":\\"") + MINE_NODE_ID + "\\"," +
    String("\\"ch4_lel\\":") + String(methane_lel, 2) + "," +
    String("\\"co_ppm\\":") + String(co_ppm, 1) + "," +
    String("\\"temp\\":") + String(temperature, 1) + "," +
    String("\\"hum\\":") + String(humidity, 1) + "," +
    String("\\"fall\\":") + (miner_fall_detected ? "true" : "false") + "," +
    String("\\"status\\":\\"") + (emergency ? "EMERGENCY" : (warning ? "WARNING" : "SAFE")) + "\\"" +
  "}";

  LoRa.beginPacket();
  LoRa.print(payload);
  LoRa.endPacket();

  Serial.print("LoRa Broadcast Sent: ");
  Serial.println(payload);

  delay(1000); // 1-second sampling period
}
`;
