(() => {
  "use strict";

  const UART_SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
  const UART_TX_CHARACTERISTIC_UUID = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";
  const MAX_LOG_LINES = 120;
  const MAX_TEXT_CHARS = 8000;

  const decoder = new TextDecoder("utf-8");
  const ui = {};
  const logLines = [];

  let device = null;
  let txCharacteristic = null;
  let receivedText = "";
  let hasBluetoothSupport = false;
  let hasSecureContext = false;
  let currentStage = "checking support";

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    bindElements();
    bindActions();
    updateStaticDiagnostics();
    checkBluetoothSupport();
  }

  function bindElements() {
    ui.body = document.body;
    ui.status = document.getElementById("diagStatus");
    ui.selectButton = document.getElementById("selectButton");
    ui.connectButton = document.getElementById("connectButton");
    ui.disconnectButton = document.getElementById("disconnectButton");
    ui.diagBluetooth = document.getElementById("diagBluetooth");
    ui.diagAvailability = document.getElementById("diagAvailability");
    ui.diagSecure = document.getElementById("diagSecure");
    ui.diagBrowser = document.getElementById("diagBrowser");
    ui.diagPlatform = document.getElementById("diagPlatform");
    ui.diagDeviceName = document.getElementById("diagDeviceName");
    ui.diagDeviceId = document.getElementById("diagDeviceId");
    ui.diagStage = document.getElementById("diagStage");
    ui.diagLog = document.getElementById("diagLog");
    ui.diagError = document.getElementById("diagError");
    ui.receivedData = document.getElementById("receivedData");
  }

  function bindActions() {
    ui.selectButton.addEventListener("click", selectDevice);
    ui.connectButton.addEventListener("click", connectUart);
    ui.disconnectButton.addEventListener("click", disconnect);
  }

  function updateStaticDiagnostics() {
    hasSecureContext = Boolean(window.isSecureContext);
    setDiagnosticText("diagSecure", hasSecureContext ? "sim" : "não");
    setDiagnosticText("diagBrowser", detectBrowser());
    setDiagnosticText("diagPlatform", detectPlatform());
    setStage("checking support");
    appendLog("Diagnóstico isolado iniciado.");
  }

  async function checkBluetoothSupport() {
    setStage("checking support");
    hasBluetoothSupport = Boolean(navigator.bluetooth);
    setDiagnosticText("diagBluetooth", hasBluetoothSupport ? "sim" : "não");

    if (!hasBluetoothSupport) {
      setDiagnosticText("diagAvailability", "não consultado");
      setStatus("Este navegador não expõe Web Bluetooth.", "error");
      setButtonsAvailable(false);
      appendLog("navigator.bluetooth não existe.");
      return;
    }

    if (typeof navigator.bluetooth.getAvailability === "function") {
      try {
        const isAvailable = await navigator.bluetooth.getAvailability();
        setDiagnosticText("diagAvailability", isAvailable ? "disponível" : "indisponível");
        appendLog(`Bluetooth adapter: ${isAvailable ? "disponível" : "indisponível"}.`);
      } catch (error) {
        setDiagnosticText("diagAvailability", "erro ao consultar");
        recordError(error);
      }
    } else {
      setDiagnosticText("diagAvailability", "API não disponível");
    }

    if (!hasSecureContext) {
      setStatus("Web Bluetooth exige HTTPS ou localhost.", "error");
      setButtonsAvailable(false);
      appendLog("Contexto inseguro.");
      return;
    }

    setStatus("Pronto para abrir o seletor BLE.", "idle");
    setButtonsAvailable(true);
  }

  async function selectDevice() {
    if (!hasBluetoothSupport || !hasSecureContext) {
      await checkBluetoothSupport();
      return;
    }

    clearLastError();

    try {
      setStage("requesting device");
      setStatus("Abrindo seletor BLE. Escolha o micro:bit manualmente.", "idle");
      device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [UART_SERVICE_UUID],
      });
      device.addEventListener("gattserverdisconnected", handleDisconnected);
      updateDeviceDiagnostics(device);
      setStatus("Dispositivo escolhido. Agora clique em Conectar UART.", "idle");
    } catch (error) {
      recordError(error);
      setStatus(`Falha no seletor: ${getErrorMessage(error)}`, "error");
    }
  }

  async function connectUart() {
    if (!device) {
      await selectDevice();

      if (!device) {
        return;
      }
    }

    clearLastError();
    ui.selectButton.disabled = true;
    ui.connectButton.disabled = true;

    try {
      setStage("connecting gatt");
      setStatus(`Conectando em ${device.name || "dispositivo BLE"}...`, "idle");
      const server = await device.gatt.connect();

      setStage("getting uart service");
      const service = await server.getPrimaryService(UART_SERVICE_UUID);

      setStage("getting tx characteristic");
      txCharacteristic = await service.getCharacteristic(UART_TX_CHARACTERISTIC_UUID);
      txCharacteristic.addEventListener("characteristicvaluechanged", handleNotification);

      setStage("starting notifications");
      await txCharacteristic.startNotifications();

      setStage("connected");
      setStatus(`Conectado: ${device.name || "micro:bit"}. Aguardando texto...`, "connected");
      ui.disconnectButton.disabled = false;
      appendLog("Notificações TX ativas.");
    } catch (error) {
      recordError(error);
      setStatus(`Falha ao conectar UART: ${getErrorMessage(error)}`, "error");
      resetConnection();
      setButtonsAvailable(true);
    }
  }

  function disconnect() {
    if (device?.gatt?.connected) {
      device.gatt.disconnect();
      return;
    }

    handleDisconnected();
  }

  function handleDisconnected() {
    resetConnection();
    setStage("disconnected");
    setStatus("Dispositivo desconectado.", "idle");
    setButtonsAvailable(true);
    appendLog("Dispositivo desconectado.");
  }

  function resetConnection() {
    if (txCharacteristic) {
      txCharacteristic.removeEventListener("characteristicvaluechanged", handleNotification);
    }

    txCharacteristic = null;
    ui.disconnectButton.disabled = true;
  }

  function handleNotification(event) {
    if (currentStage !== "receiving data") {
      setStage("receiving data");
      appendLog("Primeiros dados recebidos.");
    }

    receivedText += decoder.decode(event.target.value);

    if (receivedText.length > MAX_TEXT_CHARS) {
      receivedText = receivedText.slice(-MAX_TEXT_CHARS);
    }

    ui.receivedData.textContent = receivedText;
    ui.receivedData.scrollTop = ui.receivedData.scrollHeight;
  }

  function setButtonsAvailable(isAvailable) {
    ui.selectButton.disabled = !isAvailable;
    ui.connectButton.disabled = !isAvailable;
    ui.disconnectButton.disabled = true;
  }

  function setStatus(message, type) {
    ui.status.textContent = message;
    ui.body.dataset.connection = type === "connected" ? "connected" : type === "error" ? "error" : "idle";
  }

  function setStage(stage) {
    currentStage = stage;
    setDiagnosticText("diagStage", stage);
    appendLog(`Etapa: ${stage}`);
  }

  function updateDeviceDiagnostics(selectedDevice) {
    setDiagnosticText("diagDeviceName", selectedDevice?.name || "(sem nome)");
    setDiagnosticText("diagDeviceId", selectedDevice?.id || "(sem id)");
    appendLog(`Dispositivo escolhido: ${selectedDevice?.name || "(sem nome)"}.`);
  }

  function setDiagnosticText(key, value) {
    if (ui[key]) {
      ui[key].textContent = value;
    }
  }

  function appendLog(message) {
    if (!ui.diagLog) {
      return;
    }

    const time = new Date().toLocaleTimeString("pt-BR", { hour12: false });
    logLines.push(`[${time}] ${message}`);

    if (logLines.length > MAX_LOG_LINES) {
      logLines.shift();
    }

    ui.diagLog.textContent = logLines.join("\n");
    ui.diagLog.scrollTop = ui.diagLog.scrollHeight;
  }

  function clearLastError() {
    ui.diagError.textContent = "nenhum erro";
  }

  function recordError(error) {
    const name = error?.name || "Error";
    const message = error?.message || String(error || "erro desconhecido");
    const stack = error?.stack || "(sem stack)";

    ui.diagError.textContent = `name: ${name}\nmessage: ${message}\nstack:\n${stack}`;
    appendLog(`Erro ${name}: ${message}`);
  }

  function getErrorMessage(error) {
    if (!error) {
      return "erro desconhecido";
    }

    switch (error.name) {
      case "NotFoundError":
        return "usuário cancelou ou nenhum dispositivo foi selecionado";
      case "NotAllowedError":
        return "permissão de Bluetooth negada";
      case "SecurityError":
        return "página não está em HTTPS/local seguro";
      case "NetworkError":
        return "falha ao conectar GATT; possível pareamento antigo ou BLE travado";
      case "NotSupportedError":
        return "navegador sem suporte suficiente a Web Bluetooth";
      default:
        return error.message || String(error);
    }
  }

  function detectBrowser() {
    const ua = navigator.userAgent || "";

    if (/Bluefy/i.test(ua)) return "Bluefy";
    if (/Edg\//.test(ua)) return "Microsoft Edge";
    if (/CriOS/i.test(ua)) return "Chrome iOS";
    if (/Chrome\//.test(ua)) return "Chrome/Chromium";
    if (/Firefox\//.test(ua)) return "Firefox";
    if (/Safari\//.test(ua)) return "Safari";
    return ua.slice(0, 90) || "desconhecido";
  }

  function detectPlatform() {
    return navigator.userAgentData?.platform || navigator.platform || "desconhecida";
  }
})();
