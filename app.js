(() => {
  "use strict";

  const UART_SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
  const UART_RX_CHARACTERISTIC_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
  const UART_TX_CHARACTERISTIC_UUID = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

  const MAX_BUFFER_CHARS = 500;
  const MAX_WAVE_SAMPLES = 1000;
  const MAX_RAW_CALIBRATION_SAMPLES = 200;
  const MAX_CSV_ROWS = 20000;

  const telemetryPattern = /^([a-zA-Z]+)\s*:\s*(-?(?:\d+(?:[.,]\d+)?|[.,]\d+))\s*$/;
  const decoder = new TextDecoder("utf-8");

  const ui = {};

  let bluetoothDevice = null;
  let txCharacteristic = null;
  let rxCharacteristic = null;
  let receiveBuffer = "";
  let hasBluetoothSupport = false;

  let zeroOffset = 0;
  let lastWave = 0;
  let lastTotal = 0;
  let rmsSumSquares = 0;
  let currentScale = 10;

  const waveSamples = new Array(MAX_WAVE_SAMPLES);
  let waveStart = 0;
  let waveCount = 0;

  const rawWaveSamples = new Array(MAX_RAW_CALIBRATION_SAMPLES);
  let rawWaveStart = 0;
  let rawWaveCount = 0;

  const csvRows = new Array(MAX_CSV_ROWS);
  let csvStart = 0;
  let csvCount = 0;

  let animationFrameId = 0;

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    bindElements();
    bindActions();
    setupCanvas();
    checkBluetoothSupport();
    updateMetrics();
    drawGraph();
  }

  function bindElements() {
    ui.body = document.body;
    ui.status = document.getElementById("connectionStatus");
    ui.connectButton = document.getElementById("connectButton");
    ui.disconnectButton = document.getElementById("disconnectButton");
    ui.calibrateButton = document.getElementById("calibrateButton");
    ui.clearButton = document.getElementById("clearButton");
    ui.downloadButton = document.getElementById("downloadButton");
    ui.waveMetric = document.getElementById("waveMetric");
    ui.totalMetric = document.getElementById("totalMetric");
    ui.rmsMetric = document.getElementById("rmsMetric");
    ui.samplesMetric = document.getElementById("samplesMetric");
    ui.scaleMetric = document.getElementById("scaleMetric");
    ui.offsetBadge = document.getElementById("offsetBadge");
    ui.canvas = document.getElementById("waveCanvas");
    ui.context = ui.canvas.getContext("2d");
  }

  function bindActions() {
    ui.connectButton.addEventListener("click", connectMicrobit);
    ui.disconnectButton.addEventListener("click", disconnectMicrobit);
    ui.calibrateButton.addEventListener("click", calibrateApp);
    ui.clearButton.addEventListener("click", clearData);
    ui.downloadButton.addEventListener("click", downloadCsv);
  }

  function setupCanvas() {
    if ("ResizeObserver" in window) {
      const resizeObserver = new ResizeObserver(() => scheduleDraw());
      resizeObserver.observe(ui.canvas);
      return;
    }

    window.addEventListener("resize", scheduleDraw);
  }

  function checkBluetoothSupport() {
    hasBluetoothSupport = Boolean(navigator.bluetooth);

    if (!hasBluetoothSupport) {
      setStatus(
        "Este navegador não expõe Web Bluetooth. Use Chrome/Edge ou Bluefy no iPhone.",
        "error",
      );
      ui.connectButton.disabled = true;
      return;
    }

    if (!window.isSecureContext) {
      setStatus("Web Bluetooth exige HTTPS ou localhost. Abra por GitHub Pages ou servidor local.", "error");
      ui.connectButton.disabled = true;
      return;
    }

    setStatus("Pronto para conectar ao micro:bit.", "idle");
    ui.connectButton.disabled = false;
  }

  async function connectMicrobit() {
    if (!hasBluetoothSupport) {
      checkBluetoothSupport();
      return;
    }

    setConnectingState(true);
    setStatus("Selecionando micro:bit...", "idle");

    try {
      bluetoothDevice = await navigator.bluetooth.requestDevice({
        filters: [
          { services: [UART_SERVICE_UUID] },
          { namePrefix: "BBC micro:bit" },
          { namePrefix: "micro:bit" },
        ],
        optionalServices: [UART_SERVICE_UUID],
      });

      bluetoothDevice.addEventListener("gattserverdisconnected", handleDisconnected);
      setStatus(`Conectando em ${bluetoothDevice.name || "micro:bit"}...`, "idle");

      const server = await bluetoothDevice.gatt.connect();
      const uartService = await server.getPrimaryService(UART_SERVICE_UUID);

      rxCharacteristic = await uartService.getCharacteristic(UART_RX_CHARACTERISTIC_UUID);
      txCharacteristic = await uartService.getCharacteristic(UART_TX_CHARACTERISTIC_UUID);
      txCharacteristic.addEventListener("characteristicvaluechanged", handleNotification);
      await txCharacteristic.startNotifications();

      setConnectedState(true);
      setStatus(`Conectado: ${bluetoothDevice.name || "micro:bit"}. Aguardando dados...`, "connected");
    } catch (error) {
      cleanupConnection();
      setConnectedState(false);
      setStatus(`Falha ao conectar: ${getErrorMessage(error)}`, "error");
    }
  }

  function disconnectMicrobit() {
    if (txCharacteristic) {
      txCharacteristic.removeEventListener("characteristicvaluechanged", handleNotification);
    }

    if (bluetoothDevice?.gatt?.connected) {
      bluetoothDevice.gatt.disconnect();
      return;
    }

    handleDisconnected();
  }

  function handleDisconnected() {
    cleanupConnection();
    setConnectedState(false);
    setStatus("micro:bit desconectado.", "idle");
  }

  function cleanupConnection() {
    if (txCharacteristic) {
      txCharacteristic.removeEventListener("characteristicvaluechanged", handleNotification);
    }

    receiveBuffer = "";
    txCharacteristic = null;
    rxCharacteristic = null;

    if (bluetoothDevice) {
      bluetoothDevice.removeEventListener("gattserverdisconnected", handleDisconnected);
    }
  }

  function setConnectingState(isConnecting) {
    ui.connectButton.disabled = isConnecting;
    ui.disconnectButton.disabled = true;
  }

  function setConnectedState(isConnected) {
    ui.connectButton.disabled = isConnected || !hasBluetoothSupport;
    ui.disconnectButton.disabled = !isConnected;
  }

  function handleNotification(event) {
    const chunk = decoder.decode(event.target.value);
    handleIncomingText(chunk);
  }

  function handleIncomingText(chunk) {
    receiveBuffer += chunk;

    const lines = receiveBuffer.split(/\r\n|\n|\r/);
    receiveBuffer = lines.pop() || "";

    for (const line of lines) {
      processTelemetryLine(line);
    }

    if (receiveBuffer.length > MAX_BUFFER_CHARS) {
      receiveBuffer = "";
      setStatus("Buffer BLE limpo: dados incompletos passaram de 500 caracteres.", "error");
    }
  }

  function processTelemetryLine(line) {
    const parsed = parseTelemetryLine(line);

    if (!parsed) {
      return;
    }

    const timestamp = Date.now();

    if (parsed.key === "wave") {
      const correctedValue = parsed.rawValue - zeroOffset;
      lastWave = correctedValue;
      addRawWaveSample(parsed.rawValue);
      addWaveSample(correctedValue);
      addCsvRow(timestamp, "wave", parsed.rawValue, correctedValue);
      updateMetrics();
      scheduleDraw();
      return;
    }

    lastTotal = parsed.rawValue;
    addCsvRow(timestamp, "total", parsed.rawValue, parsed.rawValue);
    updateMetrics();
  }

  function parseTelemetryLine(line) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.length > 80) {
      return null;
    }

    const match = trimmed.match(telemetryPattern);

    if (!match) {
      return null;
    }

    let key = match[1].toLowerCase();

    if (key === "vib") {
      key = "wave";
    }

    if (key !== "wave" && key !== "total") {
      return null;
    }

    const rawValue = Number(match[2].replace(",", "."));

    if (!Number.isFinite(rawValue)) {
      return null;
    }

    return { key, rawValue };
  }

  function addWaveSample(value) {
    if (waveCount < MAX_WAVE_SAMPLES) {
      const index = (waveStart + waveCount) % MAX_WAVE_SAMPLES;
      waveSamples[index] = value;
      waveCount += 1;
    } else {
      const removed = waveSamples[waveStart];
      rmsSumSquares -= removed * removed;
      waveSamples[waveStart] = value;
      waveStart = (waveStart + 1) % MAX_WAVE_SAMPLES;
    }

    rmsSumSquares += value * value;
  }

  function addRawWaveSample(value) {
    if (rawWaveCount < MAX_RAW_CALIBRATION_SAMPLES) {
      const index = (rawWaveStart + rawWaveCount) % MAX_RAW_CALIBRATION_SAMPLES;
      rawWaveSamples[index] = value;
      rawWaveCount += 1;
      return;
    }

    rawWaveSamples[rawWaveStart] = value;
    rawWaveStart = (rawWaveStart + 1) % MAX_RAW_CALIBRATION_SAMPLES;
  }

  function addCsvRow(timestamp, key, rawValue, correctedValue) {
    const row = { timestamp, key, rawValue, correctedValue };

    if (csvCount < MAX_CSV_ROWS) {
      const index = (csvStart + csvCount) % MAX_CSV_ROWS;
      csvRows[index] = row;
      csvCount += 1;
      return;
    }

    csvRows[csvStart] = row;
    csvStart = (csvStart + 1) % MAX_CSV_ROWS;
  }

  function calibrateApp() {
    if (rawWaveCount === 0) {
      setStatus("Sem amostras de wave para calibrar. Conecte e aguarde dados.", "error");
      return;
    }

    let sum = 0;

    for (let index = 0; index < rawWaveCount; index += 1) {
      sum += rawWaveSamples[(rawWaveStart + index) % MAX_RAW_CALIBRATION_SAMPLES];
    }

    zeroOffset = sum / rawWaveCount;
    clearWaveState();
    lastWave = 0;
    updateMetrics();
    scheduleDraw();
    setStatus(`App calibrado. Offset: ${formatNumber(zeroOffset)} mg.`, getConnectionStatusType());
  }

  function clearData() {
    clearWaveState();
    clearCsvRows();
    rawWaveStart = 0;
    rawWaveCount = 0;
    lastWave = 0;
    lastTotal = 0;
    updateMetrics();
    scheduleDraw();
    setStatus("Dados locais limpos. O offset de calibração foi mantido.", getConnectionStatusType());
  }

  function clearWaveState() {
    waveStart = 0;
    waveCount = 0;
    rmsSumSquares = 0;
    currentScale = 10;
  }

  function clearCsvRows() {
    csvStart = 0;
    csvCount = 0;
  }

  function downloadCsv() {
    if (csvCount === 0) {
      setStatus("Nenhuma linha CSV para baixar ainda.", "error");
      return;
    }

    const lines = ["timestamp_ms,key,raw_value,corrected_value"];

    for (let index = 0; index < csvCount; index += 1) {
      const row = csvRows[(csvStart + index) % MAX_CSV_ROWS];
      lines.push(
        `${row.timestamp},${row.key},${formatCsvNumber(row.rawValue)},${formatCsvNumber(row.correctedValue)}`,
      );
    }

    const blob = new Blob([`${lines.join("\n")}\n`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

    link.href = url;
    link.download = `microbit_sismografo_${timestamp}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setStatus(`CSV gerado com ${csvCount.toLocaleString("pt-BR")} linhas.`, getConnectionStatusType());
  }

  function updateMetrics() {
    const rms = waveCount > 0 ? Math.sqrt(rmsSumSquares / waveCount) : 0;

    ui.waveMetric.textContent = `${formatNumber(lastWave)} mg`;
    ui.totalMetric.textContent = `${formatNumber(lastTotal)} mg`;
    ui.rmsMetric.textContent = `${formatNumber(rms)} mg`;
    ui.samplesMetric.textContent = waveCount.toLocaleString("pt-BR");
    ui.scaleMetric.textContent = `±${formatNumber(currentScale)} mg`;
    ui.offsetBadge.textContent = `offset: ${formatNumber(zeroOffset)} mg`;
  }

  function scheduleDraw() {
    if (animationFrameId) {
      return;
    }

    animationFrameId = requestAnimationFrame(() => {
      animationFrameId = 0;
      drawGraph();
    });
  }

  function drawGraph() {
    const canvas = ui.canvas;
    const ctx = ui.context;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(320, rect.width);
    const height = Math.max(260, rect.height);

    if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#070b12";
    ctx.fillRect(0, 0, width, height);

    const paddingX = 18;
    const paddingY = 18;
    const chartWidth = width - paddingX * 2;
    const chartHeight = height - paddingY * 2;
    const centerY = paddingY + chartHeight / 2;

    drawGrid(ctx, width, height, paddingX, paddingY, chartWidth, chartHeight, centerY);

    currentScale = getVisibleScale();
    ui.scaleMetric.textContent = `±${formatNumber(currentScale)} mg`;

    if (waveCount < 2) {
      drawEmptyState(ctx, width, centerY);
      return;
    }

    ctx.save();
    ctx.beginPath();
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = "#2ee8b6";
    ctx.shadowColor = "rgba(46, 232, 182, 0.36)";
    ctx.shadowBlur = 10;

    for (let index = 0; index < waveCount; index += 1) {
      const value = waveSamples[(waveStart + index) % MAX_WAVE_SAMPLES];
      const x = paddingX + (index / (waveCount - 1)) * chartWidth;
      const normalized = clamp(value / currentScale, -1, 1);
      const y = centerY - normalized * (chartHeight / 2);

      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }

    ctx.stroke();
    ctx.restore();
  }

  function drawGrid(ctx, width, height, paddingX, paddingY, chartWidth, chartHeight, centerY) {
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";

    for (let index = 0; index <= 10; index += 1) {
      const x = paddingX + (chartWidth / 10) * index;
      ctx.beginPath();
      ctx.moveTo(x, paddingY);
      ctx.lineTo(x, height - paddingY);
      ctx.stroke();
    }

    for (let index = 0; index <= 6; index += 1) {
      const y = paddingY + (chartHeight / 6) * index;
      ctx.beginPath();
      ctx.moveTo(paddingX, y);
      ctx.lineTo(width - paddingX, y);
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(255, 255, 255, 0.28)";
    ctx.beginPath();
    ctx.moveTo(paddingX, centerY);
    ctx.lineTo(width - paddingX, centerY);
    ctx.stroke();
    ctx.restore();
  }

  function drawEmptyState(ctx, width, centerY) {
    ctx.save();
    ctx.fillStyle = "rgba(238, 244, 255, 0.62)";
    ctx.font = "600 15px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Aguardando amostras de wave...", width / 2, centerY - 14);
    ctx.fillStyle = "rgba(159, 176, 199, 0.78)";
    ctx.font = "400 13px system-ui, sans-serif";
    ctx.fillText("Conecte o micro:bit e faça uma vibração leve na mesa.", width / 2, centerY + 12);
    ctx.restore();
  }

  function getVisibleScale() {
    let maxAmplitude = 0;

    for (let index = 0; index < waveCount; index += 1) {
      const value = Math.abs(waveSamples[(waveStart + index) % MAX_WAVE_SAMPLES]);

      if (value > maxAmplitude) {
        maxAmplitude = value;
      }
    }

    return niceScale(Math.max(10, maxAmplitude * 1.15));
  }

  function niceScale(value) {
    const exponent = Math.floor(Math.log10(value));
    const base = 10 ** exponent;
    const fraction = value / base;

    if (fraction <= 1) return base;
    if (fraction <= 2) return 2 * base;
    if (fraction <= 5) return 5 * base;
    return 10 * base;
  }

  function setStatus(message, type) {
    ui.status.textContent = message;
    ui.body.dataset.connection = type === "connected" ? "connected" : type === "error" ? "error" : "idle";
  }

  function getConnectionStatusType() {
    return bluetoothDevice?.gatt?.connected ? "connected" : "idle";
  }

  function getErrorMessage(error) {
    if (!error) {
      return "erro desconhecido";
    }

    if (error.name === "NotFoundError") {
      return "nenhum micro:bit foi selecionado";
    }

    if (error.name === "NotAllowedError") {
      return "permissão de Bluetooth negada";
    }

    return error.message || String(error);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function formatNumber(value) {
    if (!Number.isFinite(value)) {
      return "0";
    }

    const rounded = Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1);
    return rounded.replace(".", ",");
  }

  function formatCsvNumber(value) {
    if (!Number.isFinite(value)) {
      return "";
    }

    return Number.isInteger(value)
      ? String(value)
      : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  }
})();
