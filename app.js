(() => {
  "use strict";

  const UART_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
  const UART_TX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
  const UART_RX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

  const MAX_BUFFER_CHARS = 500;
  const MAX_RAW_CALIBRATION_SAMPLES = 200;
  const MAX_CSV_ROWS = 20000;
  const VISIBLE_SECONDS = 10;
  const VISIBLE_MS = VISIBLE_SECONDS * 1000;
  const SIMULATION_INTERVAL_MS = 20;

  const telemetryPattern = /^([a-zA-Z]+)\s*:\s*(-?(?:\d+(?:[.,]\d+)?|[.,]\d+))\s*$/;
  const decoder = new TextDecoder("utf-8");

  const ui = {};

  let device = null;
  let txChar = null;
  let receiveBuffer = "";
  let zeroOffset = 0;
  let lastWave = 0;
  let lastTotal = 0;
  let currentScale = 10;
  let packetCount = 0;
  let lastLine = "";
  let simulationTimer = 0;
  let fakeFullscreen = false;
  let animationFrameId = 0;

  let waveSamples = [];
  let totalSamples = [];

  const rawWaveSamples = new Array(MAX_RAW_CALIBRATION_SAMPLES);
  let rawWaveStart = 0;
  let rawWaveCount = 0;

  const csvRows = new Array(MAX_CSV_ROWS);
  let csvStart = 0;
  let csvCount = 0;

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    bindElements();
    bindActions();
    setupCanvas();
    checkSupport();
    updateMetrics();
    updateUartPanel();
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
    ui.fullscreenButton = document.getElementById("fullscreenButton");
    ui.simulateButton = document.getElementById("simulateButton");
    ui.waveMetric = document.getElementById("waveMetric");
    ui.totalMetric = document.getElementById("totalMetric");
    ui.rmsMetric = document.getElementById("rmsMetric");
    ui.samplesMetric = document.getElementById("samplesMetric");
    ui.scaleMetric = document.getElementById("scaleMetric");
    ui.offsetBadge = document.getElementById("offsetBadge");
    ui.lastPacket = document.getElementById("lastPacket");
    ui.lastLine = document.getElementById("lastLine");
    ui.uartWave = document.getElementById("uartWave");
    ui.packetCount = document.getElementById("packetCount");
    ui.canvas = document.getElementById("waveCanvas");
    ui.context = ui.canvas.getContext("2d");
  }

  function bindActions() {
    ui.connectButton.addEventListener("click", connectMicrobit);
    ui.disconnectButton.addEventListener("click", disconnectMicrobit);
    ui.calibrateButton.addEventListener("click", calibrateApp);
    ui.clearButton.addEventListener("click", clearData);
    ui.downloadButton.addEventListener("click", downloadCsv);
    ui.fullscreenButton.addEventListener("click", toggleFullscreen);
    ui.simulateButton.addEventListener("click", toggleSimulation);
  }

  function setupCanvas() {
    if ("ResizeObserver" in window) {
      const resizeObserver = new ResizeObserver(() => scheduleDraw());
      resizeObserver.observe(ui.canvas);
    } else {
      window.addEventListener("resize", scheduleDraw);
    }

    document.addEventListener("fullscreenchange", () => {
      fakeFullscreen = false;
      ui.body.classList.toggle("fake-fullscreen", false);
      ui.fullscreenButton.textContent = document.fullscreenElement ? "Sair tela cheia" : "Tela cheia";
      scheduleDraw();
    });
  }

  function checkSupport() {
    if (!navigator.bluetooth) {
      setStatus("Este navegador não expõe Web Bluetooth. Use Chrome/Edge ou Bluefy no iPhone.", "error");
      ui.connectButton.disabled = true;
      return;
    }

    if (!window.isSecureContext) {
      setStatus("Web Bluetooth exige HTTPS ou localhost.", "error");
      ui.connectButton.disabled = true;
      return;
    }

    setStatus("Pronto para conectar ao micro:bit.", "idle");
  }

  async function connectMicrobit() {
    if (!navigator.bluetooth || !window.isSecureContext) {
      checkSupport();
      return;
    }

    setStatus("Abrindo seletor BLE...", "idle");
    ui.connectButton.disabled = true;
    ui.disconnectButton.disabled = true;

    try {
      device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [UART_SERVICE],
      });

      device.addEventListener("gattserverdisconnected", handleDisconnected);

      const server = await device.gatt.connect();
      setStatus("Conectado. Procurando serviço UART...", "idle");

      const service = await server.getPrimaryService(UART_SERVICE);
      const chars = await service.getCharacteristics();
      const selectedTxChar = chars.find((char) => char.properties.notify || char.properties.indicate);

      if (!selectedTxChar) {
        throw new Error("Nenhuma característica notify/indicate encontrada.");
      }

      selectedTxChar.addEventListener("characteristicvaluechanged", handleBleData);
      await selectedTxChar.startNotifications();
      txChar = selectedTxChar;

      setConnectedState(true);
      setStatus(`Conectado a ${device.name || "micro:bit"}. Ouvindo ${shortUuid(txChar.uuid)}...`, "connected");
    } catch (error) {
      cleanupConnection();
      setConnectedState(false);
      setStatus(`Falha BLE: ${getErrorMessage(error)}`, "error");
    }
  }

  function disconnectMicrobit() {
    if (device?.gatt?.connected) {
      device.gatt.disconnect();
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
    if (txChar) {
      txChar.removeEventListener("characteristicvaluechanged", handleBleData);
    }

    if (device) {
      device.removeEventListener("gattserverdisconnected", handleDisconnected);
    }

    txChar = null;
    device = null;
    receiveBuffer = "";
  }

  function setConnectedState(isConnected) {
    ui.connectButton.disabled = isConnected;
    ui.disconnectButton.disabled = !isConnected;
  }

  function handleBleData(event) {
    const text = decoder.decode(event.target.value);
    packetCount += 1;
    ui.lastPacket.textContent = text || "(vazio)";
    ui.packetCount.textContent = String(packetCount);
    handleIncomingText(text);
  }

  function handleIncomingText(text) {
    receiveBuffer += text;

    const lines = receiveBuffer.split(/\r\n|\n|\r/);
    receiveBuffer = lines.pop() || "";

    for (const line of lines) {
      processLine(line);
    }

    if (receiveBuffer.length > MAX_BUFFER_CHARS) {
      receiveBuffer = "";
      setStatus("Buffer UART limpo: pacote incompleto grande demais.", "error");
    }
  }

  function processLine(line) {
    const parsed = parseLine(line);

    if (!parsed) {
      return false;
    }

    lastLine = line.trim();
    ui.lastLine.textContent = lastLine;

    const timestamp = Date.now();
    const sampleTime = performance.now();

    if (parsed.key === "wave") {
      const correctedValue = parsed.rawValue - zeroOffset;
      lastWave = correctedValue;
      addRawWaveSample(parsed.rawValue);
      addWaveSample(correctedValue, sampleTime);
      addCsvRow(timestamp, "wave", parsed.rawValue, correctedValue);
      updateMetrics();
      updateUartPanel();
      scheduleDraw();
      return true;
    }

    lastTotal = parsed.rawValue;
    addTotalSample(parsed.rawValue, sampleTime);
    addCsvRow(timestamp, "total", parsed.rawValue, parsed.rawValue);
    updateMetrics();
    updateUartPanel();
    return true;
  }

  function parseLine(line) {
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
    return Number.isFinite(rawValue) ? { key, rawValue } : null;
  }

  function addWaveSample(value, t = performance.now()) {
    waveSamples.push({ t, value });
    trimVisibleSamples(t);
  }

  function addTotalSample(value, t = performance.now()) {
    totalSamples.push({ t, value });
    trimVisibleSamples(t);
  }

  function trimVisibleSamples(now = performance.now()) {
    waveSamples = waveSamples.filter((sample) => now - sample.t <= VISIBLE_MS);
    totalSamples = totalSamples.filter((sample) => now - sample.t <= VISIBLE_MS);
  }

  function addRawWaveSample(value) {
    if (rawWaveCount < MAX_RAW_CALIBRATION_SAMPLES) {
      rawWaveSamples[(rawWaveStart + rawWaveCount) % MAX_RAW_CALIBRATION_SAMPLES] = value;
      rawWaveCount += 1;
      return;
    }

    rawWaveSamples[rawWaveStart] = value;
    rawWaveStart = (rawWaveStart + 1) % MAX_RAW_CALIBRATION_SAMPLES;
  }

  function addCsvRow(timestamp, key, rawValue, correctedValue) {
    const row = { timestamp, key, rawValue, correctedValue };

    if (csvCount < MAX_CSV_ROWS) {
      csvRows[(csvStart + csvCount) % MAX_CSV_ROWS] = row;
      csvCount += 1;
      return;
    }

    csvRows[csvStart] = row;
    csvStart = (csvStart + 1) % MAX_CSV_ROWS;
  }

  function calibrateApp() {
    if (rawWaveCount === 0) {
      setStatus("Sem amostras de wave para calibrar.", "error");
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
    updateUartPanel();
    scheduleDraw();
    setStatus(`App calibrado. Offset: ${formatNumber(zeroOffset)} mg.`, getConnectionStatusType());
  }

  function clearData() {
    stopSimulation();
    clearWaveState();
    clearCsvRows();
    rawWaveStart = 0;
    rawWaveCount = 0;
    lastWave = 0;
    lastTotal = 0;
    lastLine = "";
    packetCount = 0;
    receiveBuffer = "";
    ui.lastPacket.textContent = "nenhum";
    ui.lastLine.textContent = "nenhuma";
    updateMetrics();
    updateUartPanel();
    scheduleDraw();
    setStatus("Dados locais limpos. Offset mantido.", getConnectionStatusType());
  }

  function clearWaveState() {
    waveSamples = [];
    totalSamples = [];
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
      lines.push(`${row.timestamp},${row.key},${formatCsvNumber(row.rawValue)},${formatCsvNumber(row.correctedValue)}`);
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

  function toggleSimulation() {
    if (simulationTimer) {
      stopSimulation();
      setStatus("Simulação parada.", getConnectionStatusType());
      return;
    }

    let step = 0;
    ui.simulateButton.textContent = "Parar simulação";
    setStatus("Simulando onda local.", getConnectionStatusType());

    simulationTimer = window.setInterval(() => {
      const wave = Math.round(Math.sin(step / 6) * 38 + Math.sin(step / 2.7) * 8);
      const total = Math.abs(wave) + Math.round(8 + Math.sin(step / 9) * 5);
      processLine(`wave:${wave}`);
      processLine(`total:${total}`);
      ui.lastPacket.textContent = `wave:${wave}\\n`;
      packetCount += 1;
      ui.packetCount.textContent = String(packetCount);
      step += 1;
    }, SIMULATION_INTERVAL_MS);
  }

  function stopSimulation() {
    if (!simulationTimer) {
      return;
    }

    window.clearInterval(simulationTimer);
    simulationTimer = 0;
    ui.simulateButton.textContent = "Simular onda";
  }

  async function toggleFullscreen() {
    if (document.fullscreenElement || fakeFullscreen) {
      await exitFullscreen();
      return;
    }

    try {
      await document.documentElement.requestFullscreen?.();

      if (!document.fullscreenElement) {
        enableFakeFullscreen();
      }
    } catch (error) {
      enableFakeFullscreen();
    }

    ui.fullscreenButton.textContent = "Sair tela cheia";
    scheduleDraw();
  }

  async function exitFullscreen() {
    try {
      await document.exitFullscreen?.();
    } catch (error) {
      // Bluefy/iOS pode rejeitar exitFullscreen mesmo com fallback visual ativo.
    }

    fakeFullscreen = false;
    ui.body.classList.remove("fake-fullscreen");
    ui.fullscreenButton.textContent = "Tela cheia";
    scheduleDraw();
  }

  function enableFakeFullscreen() {
    fakeFullscreen = true;
    ui.body.classList.add("fake-fullscreen");
    window.scrollTo(0, 0);
  }

  function updateMetrics() {
    const now = performance.now();
    trimVisibleSamples(now);
    const rms = calculateRms(waveSamples);

    ui.waveMetric.textContent = `${formatNumber(lastWave)} mg`;
    ui.totalMetric.textContent = `${formatNumber(lastTotal)} mg`;
    ui.rmsMetric.textContent = `${formatNumber(rms)} mg`;
    ui.samplesMetric.textContent = waveSamples.length.toLocaleString("pt-BR");
    ui.scaleMetric.textContent = `±${formatNumber(currentScale)} mg`;
    ui.offsetBadge.textContent = `offset: ${formatNumber(zeroOffset)} mg`;
  }

  function calculateRms(samples) {
    if (samples.length === 0) {
      return 0;
    }

    let sumSquares = 0;

    for (const sample of samples) {
      sumSquares += sample.value * sample.value;
    }

    return Math.sqrt(sumSquares / samples.length);
  }

  function updateUartPanel() {
    ui.uartWave.textContent = `${formatNumber(lastWave)} mg`;
    ui.packetCount.textContent = String(packetCount);

    if (!lastLine) {
      ui.lastLine.textContent = "nenhuma";
    }
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
    ctx.fillStyle = "#f3f4f6";
    ctx.fillRect(0, 0, width, height);

    const paddingX = 18;
    const paddingY = 18;
    const chartWidth = width - paddingX * 2;
    const chartHeight = height - paddingY * 2;
    const centerY = paddingY + chartHeight / 2;

    const now = performance.now();
    trimVisibleSamples(now);
    drawGrid(ctx, width, height, paddingX, paddingY, chartWidth, chartHeight, centerY);
    currentScale = getVisibleScale();
    ui.scaleMetric.textContent = `±${formatNumber(currentScale)} mg`;

    if (waveSamples.length < 2 && totalSamples.length < 2) {
      drawEmptyState(ctx, width, centerY);
      return;
    }

    drawFadingSeries(ctx, waveSamples, now, paddingX, chartWidth, centerY, chartHeight, "#1f77d0");
    drawFadingSeries(ctx, totalSamples, now, paddingX, chartWidth, centerY, chartHeight, "#d83b61");
    drawValueBadge(ctx, `wave ${formatNumber(lastWave)}`, paddingX + 12, paddingY + 12, "#f59e0b");

    if (totalSamples.length > 0) {
      drawValueBadge(ctx, `total ${formatNumber(lastTotal)}`, paddingX + 132, paddingY + 12, "#f97316");
    }
  }

  function drawFadingSeries(ctx, samples, now, paddingX, chartWidth, centerY, chartHeight, color) {
    if (samples.length < 2) {
      return;
    }

    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (let index = 1; index < samples.length; index += 1) {
      const previous = samples[index - 1];
      const current = samples[index];
      const age = now - current.t;

      if (age > VISIBLE_MS) {
        continue;
      }

      const alpha = Math.max(0.08, 1 - age / VISIBLE_MS);
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.moveTo(sampleX(previous.t, now, paddingX, chartWidth), sampleY(previous.value, centerY, chartHeight));
      ctx.lineTo(sampleX(current.t, now, paddingX, chartWidth), sampleY(current.value, centerY, chartHeight));
      ctx.stroke();
    }

    ctx.restore();
  }

  function sampleX(t, now, paddingX, chartWidth) {
    const age = clamp(now - t, 0, VISIBLE_MS);
    return paddingX + chartWidth - (age / VISIBLE_MS) * chartWidth;
  }

  function sampleY(value, centerY, chartHeight) {
    const normalized = clamp(value / currentScale, -1, 1);
    return centerY - normalized * (chartHeight / 2);
  }

  function drawValueBadge(ctx, text, x, y, color) {
    ctx.save();
    ctx.font = "700 13px system-ui, sans-serif";
    const width = Math.ceil(ctx.measureText(text).width) + 18;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.95;
    ctx.fillRect(x, y, width, 28);
    ctx.fillStyle = "#ffffff";
    ctx.globalAlpha = 1;
    ctx.fillText(text, x + 9, y + 19);
    ctx.restore();
  }

  function drawGrid(ctx, width, height, paddingX, paddingY, chartWidth, chartHeight, centerY) {
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#d6d9de";

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

    ctx.strokeStyle = "#aeb4bd";
    ctx.beginPath();
    ctx.moveTo(paddingX, centerY);
    ctx.lineTo(width - paddingX, centerY);
    ctx.stroke();
    ctx.restore();
  }

  function drawEmptyState(ctx, width, centerY) {
    ctx.save();
    ctx.fillStyle = "#5b6472";
    ctx.font = "600 15px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Aguardando amostras de wave...", width / 2, centerY - 14);
    ctx.fillStyle = "#7b8492";
    ctx.font = "400 13px system-ui, sans-serif";
    ctx.fillText("Use Simular onda ou conecte o micro:bit.", width / 2, centerY + 12);
    ctx.restore();
  }

  function getVisibleScale() {
    const visibleValues = [
      ...waveSamples.map((sample) => sample.value),
      ...totalSamples.map((sample) => sample.value),
    ];

    const maxAbs = Math.max(50, ...visibleValues.map((value) => Math.abs(value)));
    return niceScale(maxAbs * 1.12);
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
    return device?.gatt?.connected ? "connected" : "idle";
  }

  function getErrorMessage(error) {
    if (!error) return "erro desconhecido";

    switch (error.name) {
      case "NotFoundError":
        return "usuário cancelou ou nenhum dispositivo foi selecionado";
      case "NotAllowedError":
        return "permissão de Bluetooth negada";
      case "SecurityError":
        return "página não está em HTTPS/local seguro";
      case "NetworkError":
        return "falha ao conectar GATT ou assinar notificações";
      case "NotSupportedError":
        return "navegador sem suporte suficiente a Web Bluetooth";
      default:
        return error.message || String(error);
    }
  }

  function shortUuid(uuid) {
    return String(uuid || "").slice(0, 8).toUpperCase();
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function formatNumber(value) {
    if (!Number.isFinite(value)) return "0";
    const rounded = Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1);
    return rounded.replace(".", ",");
  }

  function formatCsvNumber(value) {
    if (!Number.isFinite(value)) return "";
    return Number.isInteger(value)
      ? String(value)
      : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  }
})();
