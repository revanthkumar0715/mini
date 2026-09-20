import './style.css';
import { ESP32_HARDWARE_CODE } from './hardware_code.js';

// --- STATE MANAGEMENT ---
const state = {
  ch4: 0.45,       // % LEL (0 - 3.5%)
  co: 12,          // ppm (0 - 250)
  o2: 20.9,        // % (14.0 - 23.5)
  temp: 24.2,      // °C (15 - 55)
  humidity: 62,    // % RH
  fanSpeed: 1800,  // RPM (0 - 3600)
  fanOverride: false,
  activeMiners: 8,
  fallCount: 0,
  sirenEnabled: true,
  sirenPlaying: false,
  status: 'SAFE',  // 'SAFE', 'WARNING', 'DANGER'
  preset: 'normal',
  logs: []
};

// Miner Node Locations in Mine Canvas
const miners = [
  { id: 'M-101', name: 'John Doe', zone: 'Zone A', x: 0.22, y: 0.65, status: 'NORMAL', hr: 78 },
  { id: 'M-102', name: 'Alex Smith', zone: 'Zone A', x: 0.28, y: 0.72, status: 'NORMAL', hr: 84 },
  { id: 'M-103', name: 'Robert Chen', zone: 'Zone B', x: 0.50, y: 0.48, status: 'NORMAL', hr: 72 },
  { id: 'M-104', name: 'David Miller', zone: 'Zone B', x: 0.56, y: 0.52, status: 'NORMAL', hr: 76 },
  { id: 'M-105', name: 'James Wilson', zone: 'Zone C', x: 0.78, y: 0.35, status: 'NORMAL', hr: 80 },
  { id: 'M-106', name: 'Carlos Ramos', zone: 'Zone C', x: 0.82, y: 0.42, status: 'NORMAL', hr: 88 },
  { id: 'M-107', name: 'Vikram Singh', zone: 'Zone D', x: 0.42, y: 0.25, status: 'NORMAL', hr: 75 },
  { id: 'M-108', name: 'Marcus Vance', zone: 'Zone D', x: 0.15, y: 0.40, status: 'NORMAL', hr: 82 }
];

// Threshold Constants
const THRESHOLDS = {
  CH4_WARN: 1.25,   // % LEL
  CH4_DANGER: 2.00,
  CO_WARN: 50,      // ppm
  CO_DANGER: 150,
  O2_WARN: 19.5,    // %
  O2_DANGER: 18.0,
  TEMP_WARN: 35.0,  // °C
  TEMP_DANGER: 42.0
};

// --- AUDIO SYNTHESIZER (Web Audio API Siren) ---
let audioCtx = null;
let sirenOsc1 = null;
let sirenOsc2 = null;
let sirenGain = null;
let sirenTimer = null;

function initAudio() {
  if (!audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContext();
  }
}

function startEvacuationSiren() {
  if (!state.sirenEnabled || state.sirenPlaying) return;
  initAudio();
  if (!audioCtx) return;

  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }

  sirenOsc1 = audioCtx.createOscillator();
  sirenOsc2 = audioCtx.createOscillator();
  sirenGain = audioCtx.createGain();

  sirenOsc1.type = 'sawtooth';
  sirenOsc2.type = 'sine';

  sirenGain.gain.setValueAtTime(0.08, audioCtx.currentTime);

  sirenOsc1.connect(sirenGain);
  sirenOsc2.connect(sirenGain);
  sirenGain.connect(audioCtx.destination);

  sirenOsc1.start();
  sirenOsc2.start();
  state.sirenPlaying = true;

  // Dual tone frequency modulation (Emergency Siren)
  let high = true;
  sirenTimer = setInterval(() => {
    if (!state.sirenPlaying || !audioCtx) return;
    const now = audioCtx.currentTime;
    const f1 = high ? 950 : 650;
    const f2 = high ? 1200 : 800;
    sirenOsc1.frequency.exponentialRampToValueAtTime(f1, now + 0.3);
    sirenOsc2.frequency.exponentialRampToValueAtTime(f2, now + 0.3);
    high = !high;
  }, 400);
}

function stopEvacuationSiren() {
  if (!state.sirenPlaying) return;
  if (sirenTimer) clearInterval(sirenTimer);
  if (sirenOsc1) { try { sirenOsc1.stop(); } catch(e){} }
  if (sirenOsc2) { try { sirenOsc2.stop(); } catch(e){} }
  state.sirenPlaying = false;
}

// Single alert beep for warnings
function playWarningBeep() {
  if (!state.sirenEnabled) return;
  initAudio();
  if (!audioCtx) return;

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(880, audioCtx.currentTime);
  gain.gain.setValueAtTime(0.05, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.3);
}

// --- DOM ELEMENTS ---
const elClock = document.getElementById('live-clock');
const elSystemStatusBanner = document.getElementById('system-status-banner');
const elSystemStatusText = document.getElementById('system-status-text');

// Metric elements
const elValCh4 = document.getElementById('val-ch4');
const elValCh4Ppm = document.getElementById('val-ch4-ppm');
const elBarCh4 = document.getElementById('bar-ch4');
const elCh4Status = document.getElementById('ch4-status');

const elValCo = document.getElementById('val-co');
const elValCoLevel = document.getElementById('val-co-level');
const elBarCo = document.getElementById('bar-co');
const elCoStatus = document.getElementById('co-status');

const elValO2 = document.getElementById('val-o2');
const elBarO2 = document.getElementById('bar-o2');
const elO2Status = document.getElementById('o2-status');

const elValTemp = document.getElementById('val-temp');
const elValHumidity = document.getElementById('val-humidity');
const elBarTemp = document.getElementById('bar-temp');
const elTempStatus = document.getElementById('temp-status');

const elValFanRpm = document.getElementById('val-fan-rpm');
const elValAirflow = document.getElementById('val-airflow');
const elBarFan = document.getElementById('bar-fan');
const elFanStatus = document.getElementById('fan-status');

const elValActiveMiners = document.getElementById('val-active-miners');
const elValFallCount = document.getElementById('val-fall-count');
const elMinerStatus = document.getElementById('miner-status');

// Sim controls
const simCh4 = document.getElementById('sim-ch4');
const simCo = document.getElementById('sim-co');
const simO2 = document.getElementById('sim-o2');
const simTemp = document.getElementById('sim-temp');

const simCh4Val = document.getElementById('sim-ch4-val');
const simCoVal = document.getElementById('sim-co-val');
const simO2Val = document.getElementById('sim-o2-val');
const simTempVal = document.getElementById('sim-temp-val');

// Buttons
const sirenToggleBtn = document.getElementById('siren-toggle-btn');
const sirenIcon = document.getElementById('siren-icon');
const sirenBtnText = document.getElementById('siren-btn-text');
const hardwareCodeBtn = document.getElementById('hardware-code-btn');
const evacuateAllBtn = document.getElementById('evacuate-all-btn');
const toggleFanBtn = document.getElementById('toggle-fan-btn');
const triggerFallBtn = document.getElementById('trigger-fall-btn');

const clearLogsBtn = document.getElementById('clear-logs-btn');
const exportCsvBtn = document.getElementById('export-csv-btn');
const logTableBody = document.getElementById('log-table-body');

// Modal elements
const hardwareModal = document.getElementById('hardware-modal');
const closeModalBtn = document.getElementById('close-modal-btn');
const copyCodeBtn = document.getElementById('copy-code-btn');
const hardwareCodeBlock = document.getElementById('hardware-code-block');

// --- INITIALIZATION ---
function init() {
  // Populate hardware code modal
  hardwareCodeBlock.textContent = ESP32_HARDWARE_CODE.trim();

  // Setup Event Listeners
  setupEventListeners();

  // Add initial log
  addLog('SYSTEM_INIT', 'Environment Monitor', 'Initialization', 'All Nodes Online', 'SAFE', 'Baseline telemetry verified.');

  // Start Loops
  startClock();
  startSimulationLoop();
  initMineMapCanvas();
}

function startClock() {
  setInterval(() => {
    const now = new Date();
    elClock.textContent = now.toLocaleTimeString();
  }, 1000);
}

// --- TELEMETRY EVALUATION ENGINE ---
function evaluateTelemetry() {
  const ch4Ppm = Math.round(state.ch4 * 5000);
  elValCh4.textContent = state.ch4.toFixed(2);
  elValCh4Ppm.textContent = ch4Ppm;
  simCh4Val.textContent = state.ch4.toFixed(2) + '%';
  simCh4.value = state.ch4;

  let ch4Pct = (state.ch4 / 3.5) * 100;
  elBarCh4.style.width = `${Math.min(100, Math.max(5, ch4Pct))}%`;

  if (state.ch4 >= THRESHOLDS.CH4_DANGER) {
    setCardAlert('card-ch4', elCh4Status, elBarCh4, 'EXPLOSION DANGER', 'danger');
  } else if (state.ch4 >= THRESHOLDS.CH4_WARN) {
    setCardAlert('card-ch4', elCh4Status, elBarCh4, 'HIGH METHANE', 'warn');
  } else {
    setCardAlert('card-ch4', elCh4Status, elBarCh4, 'NORMAL', 'normal');
  }

  // Carbon Monoxide
  elValCo.textContent = Math.round(state.co);
  simCoVal.textContent = Math.round(state.co) + ' ppm';
  simCo.value = state.co;
  let coPct = (state.co / 250) * 100;
  elBarCo.style.width = `${Math.min(100, Math.max(5, coPct))}%`;

  if (state.co >= THRESHOLDS.CO_DANGER) {
    elValCoLevel.textContent = 'TOXIC FIRE RISK';
    setCardAlert('card-co', elCoStatus, elBarCo, 'CRITICAL CO', 'danger');
  } else if (state.co >= THRESHOLDS.CO_WARN) {
    elValCoLevel.textContent = 'Elevated';
    setCardAlert('card-co', elCoStatus, elBarCo, 'WARNING', 'warn');
  } else {
    elValCoLevel.textContent = 'Low / Safe';
    setCardAlert('card-co', elCoStatus, elBarCo, 'NORMAL', 'normal');
  }

  // Oxygen
  elValO2.textContent = state.o2.toFixed(1);
  simO2Val.textContent = state.o2.toFixed(1) + '%';
  simO2.value = state.o2;
  let o2Pct = ((state.o2 - 14) / 9.5) * 100;
  elBarO2.style.width = `${Math.min(100, Math.max(5, o2Pct))}%`;

  if (state.o2 <= THRESHOLDS.O2_DANGER) {
    setCardAlert('card-o2', elO2Status, elBarO2, 'ASPHYXIATION', 'danger');
  } else if (state.o2 <= THRESHOLDS.O2_WARN) {
    setCardAlert('card-o2', elO2Status, elBarO2, 'LOW O₂', 'warn');
  } else {
    setCardAlert('card-o2', elO2Status, elBarO2, 'OPTIMAL', 'normal');
  }

  // Temperature
  elValTemp.textContent = state.temp.toFixed(1);
  simTempVal.textContent = state.temp.toFixed(1) + '°C';
  simTemp.value = state.temp;
  let tempPct = ((state.temp - 15) / 40) * 100;
  elBarTemp.style.width = `${Math.min(100, Math.max(5, tempPct))}%`;

  if (state.temp >= THRESHOLDS.TEMP_DANGER) {
    setCardAlert('card-temp', elTempStatus, elBarTemp, 'OVERHEAT', 'danger');
  } else if (state.temp >= THRESHOLDS.TEMP_WARN) {
    setCardAlert('card-temp', elTempStatus, elBarTemp, 'HIGH HEAT', 'warn');
  } else {
    setCardAlert('card-temp', elTempStatus, elBarTemp, 'NORMAL', 'normal');
  }

  // Automated Fan Control Logic
  let targetFanRpm = 1800;
  if (state.fanOverride) {
    targetFanRpm = 3600;
    elFanStatus.textContent = 'MANUAL BOOST: 100%';
    elFanStatus.className = 'badge-threshold badge-danger';
  } else if (state.ch4 >= THRESHOLDS.CH4_WARN || state.co >= THRESHOLDS.CO_WARN || state.o2 <= THRESHOLDS.O2_WARN) {
    targetFanRpm = 3200;
    elFanStatus.textContent = 'AUTO PURGE BOOST';
    elFanStatus.className = 'badge-threshold badge-warn';
  } else {
    targetFanRpm = 1800;
    elFanStatus.textContent = 'AUTO: NORMAL';
    elFanStatus.className = 'badge-threshold badge-active';
  }
  
  state.fanSpeed += (targetFanRpm - state.fanSpeed) * 0.1;
  const airflow = (state.fanSpeed / 1800) * 4.2;
  elValFanRpm.textContent = Math.round(state.fanSpeed);
  elValAirflow.textContent = airflow.toFixed(1);
  elBarFan.style.width = `${(state.fanSpeed / 3600) * 100}%`;

  // Miner Fall Tracking
  elValActiveMiners.textContent = state.activeMiners;
  elValFallCount.textContent = state.fallCount;
  if (state.fallCount > 0) {
    setCardAlert('card-miners', elMinerStatus, document.getElementById('bar-miners'), `${state.fallCount} SOS FALL`, 'danger');
  } else {
    setCardAlert('card-miners', elMinerStatus, document.getElementById('bar-miners'), 'ALL CLEAR', 'normal');
  }

  // Global System Safety Status Calculation
  const isDanger = (state.ch4 >= THRESHOLDS.CH4_DANGER || state.co >= THRESHOLDS.CO_DANGER || state.o2 <= THRESHOLDS.O2_DANGER || state.fallCount > 0);
  const isWarning = (state.ch4 >= THRESHOLDS.CH4_WARN || state.co >= THRESHOLDS.CO_WARN || state.o2 <= THRESHOLDS.O2_WARN || state.temp >= THRESHOLDS.TEMP_WARN);

  const prevStatus = state.status;
  if (isDanger) {
    state.status = 'DANGER';
    elSystemStatusBanner.className = 'status-banner status-danger';
    elSystemStatusText.textContent = 'CRITICAL HAZARD - EVACUATION ADVISED';
    startEvacuationSiren();

    if (prevStatus !== 'DANGER') {
      addLog('HAZARD_CRITICAL', 'Central Node', 'Global Alert', 'Threshold Exceeded', 'DANGER', 'Evacuation sirens active & Exhaust fan boosted.');
    }
  } else if (isWarning) {
    state.status = 'WARNING';
    elSystemStatusBanner.className = 'status-banner status-warning';
    elSystemStatusText.textContent = 'ENVIRONMENTAL SAFETY WARNING';
    stopEvacuationSiren();
    if (prevStatus === 'SAFE') {
      playWarningBeep();
      addLog('SAFETY_WARN', 'Sensor Suite', 'Gas/Temp Spike', 'Warning Threshold', 'WARNING', 'Automated exhaust purge triggered.');
    }
  } else {
    state.status = 'SAFE';
    elSystemStatusBanner.className = 'status-banner status-normal';
    elSystemStatusText.textContent = 'MINE ENVIRONMENT SAFE';
    stopEvacuationSiren();
  }
}

function setCardAlert(cardId, badgeEl, barEl, text, type) {
  const card = document.getElementById(cardId);
  badgeEl.textContent = text;
  
  if (type === 'danger') {
    badgeEl.className = 'badge-threshold badge-danger';
    barEl.className = 'progress-bar-fill fill-danger';
    card.classList.add('alert-active');
  } else if (type === 'warn') {
    badgeEl.className = 'badge-threshold badge-warn';
    barEl.className = 'progress-bar-fill fill-warning';
    card.classList.remove('alert-active');
  } else {
    badgeEl.className = 'badge-threshold';
    barEl.className = 'progress-bar-fill fill-normal';
    card.classList.remove('alert-active');
  }
}

// --- EVENT LOGGING SYSTEM ---
function addLog(code, node, param, value, status, action) {
  const now = new Date();
  const timestamp = now.toTimeString().split(' ')[0] + '.' + String(now.getMilliseconds()).padStart(3, '0');
  
  const logItem = { timestamp, code, node, param, value, status, action };
  state.logs.unshift(logItem);

  if (state.logs.length > 50) state.logs.pop();

  renderLogTable();
}

function renderLogTable() {
  logTableBody.innerHTML = '';
  state.logs.forEach(log => {
    const tr = document.createElement('tr');
    
    let statusClass = 'info';
    if (log.status === 'WARNING') statusClass = 'warn';
    if (log.status === 'DANGER') statusClass = 'danger';

    tr.innerHTML = `
      <td class="mono-val">${log.timestamp}</td>
      <td><strong>${log.node}</strong></td>
      <td>${log.param}</td>
      <td class="mono-val">${log.value}</td>
      <td><span class="badge-log ${statusClass}">${log.status}</span></td>
      <td class="text-sm">${log.action}</td>
    `;
    logTableBody.appendChild(tr);
  });
}

function exportCsvLogs() {
  if (state.logs.length === 0) {
    alert('No incident logs to export.');
    return;
  }
  let csv = 'Timestamp,Node,Parameter,ObservedValue,Status,Action\n';
  state.logs.forEach(l => {
    csv += `"${l.timestamp}","${l.node}","${l.param}","${l.value}","${l.status}","${l.action}"\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.setAttribute('href', url);
  a.setAttribute('download', `coal_mine_safety_logs_${Date.now()}.csv`);
  a.click();
}

// --- EVENT LISTENERS ---
function setupEventListeners() {
  // Preset Buttons
  document.getElementById('preset-normal').addEventListener('click', () => setPreset('normal'));
  document.getElementById('preset-methane').addEventListener('click', () => setPreset('methane'));
  document.getElementById('preset-fire').addEventListener('click', () => setPreset('fire'));
  document.getElementById('preset-collapse').addEventListener('click', () => setPreset('collapse'));
  document.getElementById('preset-fan-fail').addEventListener('click', () => setPreset('fan-fail'));

  // Sliders
  simCh4.addEventListener('input', (e) => { state.ch4 = parseFloat(e.target.value); evaluateTelemetry(); });
  simCo.addEventListener('input', (e) => { state.co = parseFloat(e.target.value); evaluateTelemetry(); });
  simO2.addEventListener('input', (e) => { state.o2 = parseFloat(e.target.value); evaluateTelemetry(); });
  simTemp.addEventListener('input', (e) => { state.temp = parseFloat(e.target.value); evaluateTelemetry(); });

  // Buttons
  sirenToggleBtn.addEventListener('click', () => {
    state.sirenEnabled = !state.sirenEnabled;
    if (state.sirenEnabled) {
      sirenToggleBtn.classList.add('active');
      sirenIcon.className = 'fa-solid fa-volume-high';
      sirenBtnText.textContent = 'Audio Alarm';
    } else {
      sirenToggleBtn.classList.remove('active');
      sirenIcon.className = 'fa-solid fa-volume-xmark';
      sirenBtnText.textContent = 'Muted';
      stopEvacuationSiren();
    }
  });

  hardwareCodeBtn.addEventListener('click', () => { hardwareModal.classList.remove('hidden'); });
  closeModalBtn.addEventListener('click', () => { hardwareModal.classList.add('hidden'); });
  hardwareModal.addEventListener('click', (e) => { if (e.target === hardwareModal) hardwareModal.classList.add('hidden'); });

  copyCodeBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(ESP32_HARDWARE_CODE.trim());
    copyCodeBtn.innerHTML = '<i class="fa-solid fa-check"></i> Copied!';
    setTimeout(() => {
      copyCodeBtn.innerHTML = '<i class="fa-regular fa-copy"></i> Copy C++ Code';
    }, 2000);
  });

  evacuateAllBtn.addEventListener('click', () => {
    setPreset('fire');
    addLog('EVACUATION_MANUAL', 'Control Room', 'Manual Override', 'EVACUATE ALL', 'DANGER', 'Manual mine evacuation order broadcasted.');
  });

  toggleFanBtn.addEventListener('click', () => {
    state.fanOverride = !state.fanOverride;
    toggleFanBtn.textContent = state.fanOverride ? 'Release Fan Override' : 'Override Fan Boost';
    addLog('FAN_OVERRIDE', 'Control Center', 'Relay Control', state.fanOverride ? 'BOOST 100%' : 'AUTO', 'INFO', 'Manual ventilation fan state updated.');
    evaluateTelemetry();
  });

  triggerFallBtn.addEventListener('click', () => {
    state.fallCount += 1;
    // Mark one miner as fallen
    const targetMiner = miners.find(m => m.status === 'NORMAL') || miners[0];
    targetMiner.status = 'FALL_SOS';
    addLog('FALL_SOS', targetMiner.id, 'MPU6050 Accelerometer', 'Impact > 3.8g', 'DANGER', `Miner ${targetMiner.name} reported fall emergency in ${targetMiner.zone}.`);
    evaluateTelemetry();
  });

  clearLogsBtn.addEventListener('click', () => {
    state.logs = [];
    renderLogTable();
  });

  exportCsvBtn.addEventListener('click', exportCsvLogs);
}

function setPreset(name) {
  state.preset = name;
  document.querySelectorAll('.preset-btn').forEach(btn => btn.classList.remove('active'));
  const targetBtn = document.getElementById(`preset-${name}`);
  if (targetBtn) targetBtn.classList.add('active');

  if (name === 'normal') {
    state.ch4 = 0.45;
    state.co = 12;
    state.o2 = 20.9;
    state.temp = 24.2;
    state.fallCount = 0;
    miners.forEach(m => m.status = 'NORMAL');
    addLog('PRESET', 'Simulator', 'Scenario Change', 'Normal Working Ops', 'SAFE', 'All environmental parameters restored to baseline.');
  } else if (name === 'methane') {
    state.ch4 = 2.45;
    state.co = 25;
    state.o2 = 19.8;
    state.temp = 27.5;
    addLog('PRESET', 'Simulator', 'Scenario Change', 'Methane Leak Spike', 'DANGER', 'High CH4 gas accumulation in Deep Shaft.');
  } else if (name === 'fire') {
    state.ch4 = 1.80;
    state.co = 185;
    state.o2 = 17.2;
    state.temp = 44.5;
    addLog('PRESET', 'Simulator', 'Scenario Change', 'Fire & CO Hazard', 'DANGER', 'Coal combustion detected. High CO toxicity risk.');
  } else if (name === 'collapse') {
    state.fallCount = 2;
    miners[0].status = 'FALL_SOS';
    miners[1].status = 'FALL_SOS';
    addLog('PRESET', 'Simulator', 'Scenario Change', 'Miner Collapse / SOS', 'DANGER', '2 Miners reported non-responsive via LoRa beacons.');
  } else if (name === 'fan-fail') {
    state.fanSpeed = 0;
    state.o2 = 18.2;
    state.ch4 = 1.45;
    addLog('PRESET', 'Simulator', 'Scenario Change', 'Ventilation Fan Fault', 'WARNING', 'Airflow rate dropped to 0.0 m/s.');
  }

  evaluateTelemetry();
}

// --- LIVE SIMULATION LOOP (Micro Sensor Drift) ---
function startSimulationLoop() {
  setInterval(() => {
    // Subtle realistic random fluctuations
    if (state.preset === 'normal') {
      state.ch4 = Math.max(0.1, Math.min(0.8, state.ch4 + (Math.random() - 0.5) * 0.02));
      state.co = Math.max(5, Math.min(25, state.co + (Math.random() - 0.5) * 0.5));
      state.temp = Math.max(22, Math.min(28, state.temp + (Math.random() - 0.5) * 0.1));
    }
    evaluateTelemetry();
  }, 2000);
}

// --- UNDERGROUND MINE CANVAS MAP RENDERER ---
function initMineMapCanvas() {
  const canvas = document.getElementById('mine-canvas');
  const ctx = canvas.getContext('2d');

  function resizeCanvas() {
    canvas.width = canvas.parentElement.clientWidth;
    canvas.height = canvas.parentElement.clientHeight;
  }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  let animFrame = 0;

  function renderMap() {
    animFrame++;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const w = canvas.width;
    const h = canvas.height;

    // Draw Mine Tunnels (Schematic Paths)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 36;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Main Access Shaft
    ctx.beginPath();
    ctx.moveTo(w * 0.1, h * 0.2);
    ctx.lineTo(w * 0.5, h * 0.2);
    ctx.lineTo(w * 0.5, h * 0.8);
    ctx.lineTo(w * 0.9, h * 0.8);
    ctx.stroke();

    // Side Shafts
    ctx.beginPath();
    ctx.moveTo(w * 0.5, h * 0.5);
    ctx.lineTo(w * 0.2, h * 0.65);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(w * 0.5, h * 0.5);
    ctx.lineTo(w * 0.8, h * 0.35);
    ctx.stroke();

    // Inner Tunnel Track Glow
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.25)';
    ctx.lineWidth = 4;
    ctx.stroke();

    // Draw Hazard Heatmap Overlay
    if (state.ch4 > THRESHOLDS.CH4_WARN || state.co > THRESHOLDS.CO_WARN) {
      const gradient = ctx.createRadialGradient(w * 0.2, h * 0.65, 10, w * 0.2, h * 0.65, 90);
      const isDanger = state.ch4 >= THRESHOLDS.CH4_DANGER || state.co >= THRESHOLDS.CO_DANGER;
      gradient.addColorStop(0, isDanger ? 'rgba(239, 68, 68, 0.45)' : 'rgba(245, 158, 11, 0.35)');
      gradient.addColorStop(1, 'transparent');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(w * 0.2, h * 0.65, 90, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw Airflow Arrows
    const arrowOffset = (animFrame * 1.5) % 40;
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.5)';
    ctx.lineWidth = 2;
    for (let x = w * 0.15 + arrowOffset; x < w * 0.45; x += 40) {
      drawArrow(ctx, x, h * 0.2, x + 10, h * 0.2);
    }

    // Draw Mine Nodes / LoRa Base Stations
    drawNode(ctx, w * 0.2, h * 0.65, 'Node 1 (Deep Shaft)', state.ch4 > THRESHOLDS.CH4_WARN ? 'WARN' : 'SAFE');
    drawNode(ctx, w * 0.5, h * 0.5, 'Node 2 (Tunnel B)', state.co > THRESHOLDS.CO_WARN ? 'WARN' : 'SAFE');
    drawNode(ctx, w * 0.8, h * 0.35, 'Node 3 (Vent Duct)', state.status);
    drawNode(ctx, w * 0.1, h * 0.2, 'Surface Gateway', 'SAFE');

    // Draw Miners
    miners.forEach((m, idx) => {
      const mx = w * m.x;
      const my = h * m.y;
      
      const isFall = m.status === 'FALL_SOS';
      ctx.fillStyle = isFall ? '#EF4444' : '#38BDF8';

      // Pulse circle for fallen miner
      if (isFall) {
        ctx.beginPath();
        const pulse = 10 + Math.sin(animFrame * 0.2) * 6;
        ctx.arc(mx, my, pulse, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(239, 68, 68, 0.3)';
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(mx, my, 6, 0, Math.PI * 2);
      ctx.fillStyle = isFall ? '#EF4444' : '#38BDF8';
      ctx.fill();
      ctx.strokeStyle = '#FFF';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Miner Name Tag
      ctx.font = '10px Inter, sans-serif';
      ctx.fillStyle = isFall ? '#F87171' : '#9CA3AF';
      ctx.fillText(`${m.name} (${m.id})`, mx + 10, my + 3);
    });

    requestAnimationFrame(renderMap);
  }

  renderMap();
}

function drawNode(ctx, x, y, label, status) {
  ctx.beginPath();
  ctx.arc(x, y, 9, 0, Math.PI * 2);
  ctx.fillStyle = status === 'DANGER' ? '#EF4444' : (status === 'WARN' ? '#F59E0B' : '#10B981');
  ctx.fill();
  ctx.strokeStyle = '#1E293B';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.font = '11px Inter, sans-serif';
  ctx.fillStyle = '#E2E8F0';
  ctx.fillText(label, x + 14, y + 4);
}

function drawArrow(ctx, fromx, fromy, tox, toy) {
  const headlen = 6;
  const dx = tox - fromx;
  const dy = toy - fromy;
  const angle = Math.atan2(dy, dx);
  ctx.beginPath();
  ctx.moveTo(fromx, fromy);
  ctx.lineTo(tox, toy);
  ctx.lineTo(tox - headlen * Math.cos(angle - Math.PI / 6), toy - headlen * Math.sin(angle - Math.PI / 6));
  ctx.moveTo(tox, toy);
  ctx.lineTo(tox - headlen * Math.cos(angle + Math.PI / 6), toy - headlen * Math.sin(angle + Math.PI / 6));
  ctx.stroke();
}

// Run Initialization
document.addEventListener('DOMContentLoaded', init);
