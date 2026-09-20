(function(){const n=document.createElement("link").relList;if(n&&n.supports&&n.supports("modulepreload"))return;for(const o of document.querySelectorAll('link[rel="modulepreload"]'))r(o);new MutationObserver(o=>{for(const a of o)if(a.type==="childList")for(const l of a.addedNodes)l.tagName==="LINK"&&l.rel==="modulepreload"&&r(l)}).observe(document,{childList:!0,subtree:!0});function i(o){const a={};return o.integrity&&(a.integrity=o.integrity),o.referrerPolicy&&(a.referrerPolicy=o.referrerPolicy),o.crossOrigin==="use-credentials"?a.credentials="include":o.crossOrigin==="anonymous"?a.credentials="omit":a.credentials="same-origin",a}function r(o){if(o.ep)return;o.ep=!0;const a=i(o);fetch(o.href,a)}})();const Y=`/*
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
`,e={ch4:.45,co:12,o2:20.9,temp:24.2,fanSpeed:1800,fanOverride:!1,activeMiners:8,fallCount:0,sirenEnabled:!0,sirenPlaying:!1,status:"SAFE",preset:"normal",logs:[]},N=[{id:"M-101",name:"John Doe",zone:"Zone A",x:.22,y:.65,status:"NORMAL",hr:78},{id:"M-102",name:"Alex Smith",zone:"Zone A",x:.28,y:.72,status:"NORMAL",hr:84},{id:"M-103",name:"Robert Chen",zone:"Zone B",x:.5,y:.48,status:"NORMAL",hr:72},{id:"M-104",name:"David Miller",zone:"Zone B",x:.56,y:.52,status:"NORMAL",hr:76},{id:"M-105",name:"James Wilson",zone:"Zone C",x:.78,y:.35,status:"NORMAL",hr:80},{id:"M-106",name:"Carlos Ramos",zone:"Zone C",x:.82,y:.42,status:"NORMAL",hr:88},{id:"M-107",name:"Vikram Singh",zone:"Zone D",x:.42,y:.25,status:"NORMAL",hr:75},{id:"M-108",name:"Marcus Vance",zone:"Zone D",x:.15,y:.4,status:"NORMAL",hr:82}],s={CH4_WARN:1.25,CH4_DANGER:2,CO_WARN:50,CO_DANGER:150,O2_WARN:19.5,O2_DANGER:18,TEMP_WARN:35,TEMP_DANGER:42};let d=null,g=null,f=null,S=null,W=null;function q(){if(!d){const t=window.AudioContext||window.webkitAudioContext;d=new t}}function te(){if(!e.sirenEnabled||e.sirenPlaying||(q(),!d))return;d.state==="suspended"&&d.resume(),g=d.createOscillator(),f=d.createOscillator(),S=d.createGain(),g.type="sawtooth",f.type="sine",S.gain.setValueAtTime(.08,d.currentTime),g.connect(S),f.connect(S),S.connect(d.destination),g.start(),f.start(),e.sirenPlaying=!0;let t=!0;W=setInterval(()=>{if(!e.sirenPlaying||!d)return;const n=d.currentTime,i=t?950:650,r=t?1200:800;g.frequency.exponentialRampToValueAtTime(i,n+.3),f.frequency.exponentialRampToValueAtTime(r,n+.3),t=!t},400)}function k(){if(e.sirenPlaying){if(W&&clearInterval(W),g)try{g.stop()}catch{}if(f)try{f.stop()}catch{}e.sirenPlaying=!1}}function ne(){if(!e.sirenEnabled||(q(),!d))return;const t=d.createOscillator(),n=d.createGain();t.type="triangle",t.frequency.setValueAtTime(880,d.currentTime),n.gain.setValueAtTime(.05,d.currentTime),n.gain.exponentialRampToValueAtTime(.001,d.currentTime+.3),t.connect(n),n.connect(d.destination),t.start(),t.stop(d.currentTime+.3)}const ae=document.getElementById("live-clock"),P=document.getElementById("system-status-banner"),B=document.getElementById("system-status-text"),oe=document.getElementById("val-ch4"),ie=document.getElementById("val-ch4-ppm"),L=document.getElementById("bar-ch4"),b=document.getElementById("ch4-status"),le=document.getElementById("val-co"),D=document.getElementById("val-co-level"),M=document.getElementById("bar-co"),F=document.getElementById("co-status"),re=document.getElementById("val-o2"),y=document.getElementById("bar-o2"),x=document.getElementById("o2-status"),se=document.getElementById("val-temp");document.getElementById("val-humidity");const _=document.getElementById("bar-temp"),w=document.getElementById("temp-status"),ce=document.getElementById("val-fan-rpm"),de=document.getElementById("val-airflow"),me=document.getElementById("bar-fan"),A=document.getElementById("fan-status"),ue=document.getElementById("val-active-miners"),Ee=document.getElementById("val-fall-count"),V=document.getElementById("miner-status"),Q=document.getElementById("sim-ch4"),X=document.getElementById("sim-co"),K=document.getElementById("sim-o2"),J=document.getElementById("sim-temp"),ge=document.getElementById("sim-ch4-val"),fe=document.getElementById("sim-co-val"),he=document.getElementById("sim-o2-val"),Ae=document.getElementById("sim-temp-val"),H=document.getElementById("siren-toggle-btn"),U=document.getElementById("siren-icon"),z=document.getElementById("siren-btn-text"),pe=document.getElementById("hardware-code-btn"),Ne=document.getElementById("evacuate-all-btn"),$=document.getElementById("toggle-fan-btn"),Re=document.getElementById("trigger-fall-btn"),Se=document.getElementById("clear-logs-btn"),Ie=document.getElementById("export-csv-btn"),Z=document.getElementById("log-table-body"),I=document.getElementById("hardware-modal"),Ce=document.getElementById("close-modal-btn"),G=document.getElementById("copy-code-btn"),Le=document.getElementById("hardware-code-block");function Me(){Le.textContent=Y.trim(),Oe(),u("SYSTEM_INIT","Environment Monitor","Initialization","All Nodes Online","SAFE","Baseline telemetry verified."),ye(),Te(),ve()}function ye(){setInterval(()=>{const t=new Date;ae.textContent=t.toLocaleTimeString()},1e3)}function E(){const t=Math.round(e.ch4*5e3);oe.textContent=e.ch4.toFixed(2),ie.textContent=t,ge.textContent=e.ch4.toFixed(2)+"%",Q.value=e.ch4;let n=e.ch4/3.5*100;L.style.width=`${Math.min(100,Math.max(5,n))}%`,e.ch4>=s.CH4_DANGER?m("card-ch4",b,L,"EXPLOSION DANGER","danger"):e.ch4>=s.CH4_WARN?m("card-ch4",b,L,"HIGH METHANE","warn"):m("card-ch4",b,L,"NORMAL","normal"),le.textContent=Math.round(e.co),fe.textContent=Math.round(e.co)+" ppm",X.value=e.co;let i=e.co/250*100;M.style.width=`${Math.min(100,Math.max(5,i))}%`,e.co>=s.CO_DANGER?(D.textContent="TOXIC FIRE RISK",m("card-co",F,M,"CRITICAL CO","danger")):e.co>=s.CO_WARN?(D.textContent="Elevated",m("card-co",F,M,"WARNING","warn")):(D.textContent="Low / Safe",m("card-co",F,M,"NORMAL","normal")),re.textContent=e.o2.toFixed(1),he.textContent=e.o2.toFixed(1)+"%",K.value=e.o2;let r=(e.o2-14)/9.5*100;y.style.width=`${Math.min(100,Math.max(5,r))}%`,e.o2<=s.O2_DANGER?m("card-o2",x,y,"ASPHYXIATION","danger"):e.o2<=s.O2_WARN?m("card-o2",x,y,"LOW O₂","warn"):m("card-o2",x,y,"OPTIMAL","normal"),se.textContent=e.temp.toFixed(1),Ae.textContent=e.temp.toFixed(1)+"°C",J.value=e.temp;let o=(e.temp-15)/40*100;_.style.width=`${Math.min(100,Math.max(5,o))}%`,e.temp>=s.TEMP_DANGER?m("card-temp",w,_,"OVERHEAT","danger"):e.temp>=s.TEMP_WARN?m("card-temp",w,_,"HIGH HEAT","warn"):m("card-temp",w,_,"NORMAL","normal");let a=1800;e.fanOverride?(a=3600,A.textContent="MANUAL BOOST: 100%",A.className="badge-threshold badge-danger"):e.ch4>=s.CH4_WARN||e.co>=s.CO_WARN||e.o2<=s.O2_WARN?(a=3200,A.textContent="AUTO PURGE BOOST",A.className="badge-threshold badge-warn"):(a=1800,A.textContent="AUTO: NORMAL",A.className="badge-threshold badge-active"),e.fanSpeed+=(a-e.fanSpeed)*.1;const l=e.fanSpeed/1800*4.2;ce.textContent=Math.round(e.fanSpeed),de.textContent=l.toFixed(1),me.style.width=`${e.fanSpeed/3600*100}%`,ue.textContent=e.activeMiners,Ee.textContent=e.fallCount,e.fallCount>0?m("card-miners",V,document.getElementById("bar-miners"),`${e.fallCount} SOS FALL`,"danger"):m("card-miners",V,document.getElementById("bar-miners"),"ALL CLEAR","normal");const h=e.ch4>=s.CH4_DANGER||e.co>=s.CO_DANGER||e.o2<=s.O2_DANGER||e.fallCount>0,c=e.ch4>=s.CH4_WARN||e.co>=s.CO_WARN||e.o2<=s.O2_WARN||e.temp>=s.TEMP_WARN,R=e.status;h?(e.status="DANGER",P.className="status-banner status-danger",B.textContent="CRITICAL HAZARD - EVACUATION ADVISED",te(),R!=="DANGER"&&u("HAZARD_CRITICAL","Central Node","Global Alert","Threshold Exceeded","DANGER","Evacuation sirens active & Exhaust fan boosted.")):c?(e.status="WARNING",P.className="status-banner status-warning",B.textContent="ENVIRONMENTAL SAFETY WARNING",k(),R==="SAFE"&&(ne(),u("SAFETY_WARN","Sensor Suite","Gas/Temp Spike","Warning Threshold","WARNING","Automated exhaust purge triggered."))):(e.status="SAFE",P.className="status-banner status-normal",B.textContent="MINE ENVIRONMENT SAFE",k())}function m(t,n,i,r,o){const a=document.getElementById(t);n.textContent=r,o==="danger"?(n.className="badge-threshold badge-danger",i.className="progress-bar-fill fill-danger",a.classList.add("alert-active")):o==="warn"?(n.className="badge-threshold badge-warn",i.className="progress-bar-fill fill-warning",a.classList.remove("alert-active")):(n.className="badge-threshold",i.className="progress-bar-fill fill-normal",a.classList.remove("alert-active"))}function u(t,n,i,r,o,a){const l=new Date,c={timestamp:l.toTimeString().split(" ")[0]+"."+String(l.getMilliseconds()).padStart(3,"0"),code:t,node:n,param:i,value:r,status:o,action:a};e.logs.unshift(c),e.logs.length>50&&e.logs.pop(),j()}function j(){Z.innerHTML="",e.logs.forEach(t=>{const n=document.createElement("tr");let i="info";t.status==="WARNING"&&(i="warn"),t.status==="DANGER"&&(i="danger"),n.innerHTML=`
      <td class="mono-val">${t.timestamp}</td>
      <td><strong>${t.node}</strong></td>
      <td>${t.param}</td>
      <td class="mono-val">${t.value}</td>
      <td><span class="badge-log ${i}">${t.status}</span></td>
      <td class="text-sm">${t.action}</td>
    `,Z.appendChild(n)})}function _e(){if(e.logs.length===0){alert("No incident logs to export.");return}let t=`Timestamp,Node,Parameter,ObservedValue,Status,Action
`;e.logs.forEach(o=>{t+=`"${o.timestamp}","${o.node}","${o.param}","${o.value}","${o.status}","${o.action}"
`});const n=new Blob([t],{type:"text/csv"}),i=window.URL.createObjectURL(n),r=document.createElement("a");r.setAttribute("href",i),r.setAttribute("download",`coal_mine_safety_logs_${Date.now()}.csv`),r.click()}function Oe(){document.getElementById("preset-normal").addEventListener("click",()=>p("normal")),document.getElementById("preset-methane").addEventListener("click",()=>p("methane")),document.getElementById("preset-fire").addEventListener("click",()=>p("fire")),document.getElementById("preset-collapse").addEventListener("click",()=>p("collapse")),document.getElementById("preset-fan-fail").addEventListener("click",()=>p("fan-fail")),Q.addEventListener("input",t=>{e.ch4=parseFloat(t.target.value),E()}),X.addEventListener("input",t=>{e.co=parseFloat(t.target.value),E()}),K.addEventListener("input",t=>{e.o2=parseFloat(t.target.value),E()}),J.addEventListener("input",t=>{e.temp=parseFloat(t.target.value),E()}),H.addEventListener("click",()=>{e.sirenEnabled=!e.sirenEnabled,e.sirenEnabled?(H.classList.add("active"),U.className="fa-solid fa-volume-high",z.textContent="Audio Alarm"):(H.classList.remove("active"),U.className="fa-solid fa-volume-xmark",z.textContent="Muted",k())}),pe.addEventListener("click",()=>{I.classList.remove("hidden")}),Ce.addEventListener("click",()=>{I.classList.add("hidden")}),I.addEventListener("click",t=>{t.target===I&&I.classList.add("hidden")}),G.addEventListener("click",()=>{navigator.clipboard.writeText(Y.trim()),G.innerHTML='<i class="fa-solid fa-check"></i> Copied!',setTimeout(()=>{G.innerHTML='<i class="fa-regular fa-copy"></i> Copy C++ Code'},2e3)}),Ne.addEventListener("click",()=>{p("fire"),u("EVACUATION_MANUAL","Control Room","Manual Override","EVACUATE ALL","DANGER","Manual mine evacuation order broadcasted.")}),$.addEventListener("click",()=>{e.fanOverride=!e.fanOverride,$.textContent=e.fanOverride?"Release Fan Override":"Override Fan Boost",u("FAN_OVERRIDE","Control Center","Relay Control",e.fanOverride?"BOOST 100%":"AUTO","INFO","Manual ventilation fan state updated."),E()}),Re.addEventListener("click",()=>{e.fallCount+=1;const t=N.find(n=>n.status==="NORMAL")||N[0];t.status="FALL_SOS",u("FALL_SOS",t.id,"MPU6050 Accelerometer","Impact > 3.8g","DANGER",`Miner ${t.name} reported fall emergency in ${t.zone}.`),E()}),Se.addEventListener("click",()=>{e.logs=[],j()}),Ie.addEventListener("click",_e)}function p(t){e.preset=t,document.querySelectorAll(".preset-btn").forEach(i=>i.classList.remove("active"));const n=document.getElementById(`preset-${t}`);n&&n.classList.add("active"),t==="normal"?(e.ch4=.45,e.co=12,e.o2=20.9,e.temp=24.2,e.fallCount=0,N.forEach(i=>i.status="NORMAL"),u("PRESET","Simulator","Scenario Change","Normal Working Ops","SAFE","All environmental parameters restored to baseline.")):t==="methane"?(e.ch4=2.45,e.co=25,e.o2=19.8,e.temp=27.5,u("PRESET","Simulator","Scenario Change","Methane Leak Spike","DANGER","High CH4 gas accumulation in Deep Shaft.")):t==="fire"?(e.ch4=1.8,e.co=185,e.o2=17.2,e.temp=44.5,u("PRESET","Simulator","Scenario Change","Fire & CO Hazard","DANGER","Coal combustion detected. High CO toxicity risk.")):t==="collapse"?(e.fallCount=2,N[0].status="FALL_SOS",N[1].status="FALL_SOS",u("PRESET","Simulator","Scenario Change","Miner Collapse / SOS","DANGER","2 Miners reported non-responsive via LoRa beacons.")):t==="fan-fail"&&(e.fanSpeed=0,e.o2=18.2,e.ch4=1.45,u("PRESET","Simulator","Scenario Change","Ventilation Fan Fault","WARNING","Airflow rate dropped to 0.0 m/s.")),E()}function Te(){setInterval(()=>{e.preset==="normal"&&(e.ch4=Math.max(.1,Math.min(.8,e.ch4+(Math.random()-.5)*.02)),e.co=Math.max(5,Math.min(25,e.co+(Math.random()-.5)*.5)),e.temp=Math.max(22,Math.min(28,e.temp+(Math.random()-.5)*.1))),E()},2e3)}function ve(){const t=document.getElementById("mine-canvas"),n=t.getContext("2d");function i(){t.width=t.parentElement.clientWidth,t.height=t.parentElement.clientHeight}i(),window.addEventListener("resize",i);let r=0;function o(){r++,n.clearRect(0,0,t.width,t.height);const a=t.width,l=t.height;if(n.strokeStyle="rgba(255, 255, 255, 0.08)",n.lineWidth=36,n.lineCap="round",n.lineJoin="round",n.beginPath(),n.moveTo(a*.1,l*.2),n.lineTo(a*.5,l*.2),n.lineTo(a*.5,l*.8),n.lineTo(a*.9,l*.8),n.stroke(),n.beginPath(),n.moveTo(a*.5,l*.5),n.lineTo(a*.2,l*.65),n.stroke(),n.beginPath(),n.moveTo(a*.5,l*.5),n.lineTo(a*.8,l*.35),n.stroke(),n.strokeStyle="rgba(59, 130, 246, 0.25)",n.lineWidth=4,n.stroke(),e.ch4>s.CH4_WARN||e.co>s.CO_WARN){const c=n.createRadialGradient(a*.2,l*.65,10,a*.2,l*.65,90),R=e.ch4>=s.CH4_DANGER||e.co>=s.CO_DANGER;c.addColorStop(0,R?"rgba(239, 68, 68, 0.45)":"rgba(245, 158, 11, 0.35)"),c.addColorStop(1,"transparent"),n.fillStyle=c,n.beginPath(),n.arc(a*.2,l*.65,90,0,Math.PI*2),n.fill()}const h=r*1.5%40;n.strokeStyle="rgba(56, 189, 248, 0.5)",n.lineWidth=2;for(let c=a*.15+h;c<a*.45;c+=40)Pe(n,c,l*.2,c+10,l*.2);O(n,a*.2,l*.65,"Node 1 (Deep Shaft)",e.ch4>s.CH4_WARN?"WARN":"SAFE"),O(n,a*.5,l*.5,"Node 2 (Tunnel B)",e.co>s.CO_WARN?"WARN":"SAFE"),O(n,a*.8,l*.35,"Node 3 (Vent Duct)",e.status),O(n,a*.1,l*.2,"Surface Gateway","SAFE"),N.forEach((c,R)=>{const T=a*c.x,v=l*c.y,C=c.status==="FALL_SOS";if(n.fillStyle=C?"#EF4444":"#38BDF8",C){n.beginPath();const ee=10+Math.sin(r*.2)*6;n.arc(T,v,ee,0,Math.PI*2),n.fillStyle="rgba(239, 68, 68, 0.3)",n.fill()}n.beginPath(),n.arc(T,v,6,0,Math.PI*2),n.fillStyle=C?"#EF4444":"#38BDF8",n.fill(),n.strokeStyle="#FFF",n.lineWidth=1.5,n.stroke(),n.font="10px Inter, sans-serif",n.fillStyle=C?"#F87171":"#9CA3AF",n.fillText(`${c.name} (${c.id})`,T+10,v+3)}),requestAnimationFrame(o)}o()}function O(t,n,i,r,o){t.beginPath(),t.arc(n,i,9,0,Math.PI*2),t.fillStyle=o==="DANGER"?"#EF4444":o==="WARN"?"#F59E0B":"#10B981",t.fill(),t.strokeStyle="#1E293B",t.lineWidth=2,t.stroke(),t.font="11px Inter, sans-serif",t.fillStyle="#E2E8F0",t.fillText(r,n+14,i+4)}function Pe(t,n,i,r,o){const l=r-n,h=o-i,c=Math.atan2(h,l);t.beginPath(),t.moveTo(n,i),t.lineTo(r,o),t.lineTo(r-6*Math.cos(c-Math.PI/6),o-6*Math.sin(c-Math.PI/6)),t.moveTo(r,o),t.lineTo(r-6*Math.cos(c+Math.PI/6),o-6*Math.sin(c+Math.PI/6)),t.stroke()}document.addEventListener("DOMContentLoaded",Me);
