import {
  BleOperationArbiter,
  StabilizedHereSphereClock,
  clamp,
  computeLatestDueCommand
} from './core.mjs';
import { getLanguage, setLanguage, t } from './i18n.js';

const OSSM = Object.freeze({
  service: '522b443a-4f53-534d-0001-420badbabe69',
  command: '522b443a-4f53-534d-1000-420badbabe69',
  speedKnob: '522b443a-4f53-534d-1010-420badbabe69',
  latencyCompensation: '522b443a-4f53-534d-1030-420badbabe69',
  state: '522b443a-4f53-534d-2000-420badbabe69'
});

const STALE_TIMESTAMP_MS = 3000;
const DEFAULT_HERESPHERE_PORT = 23554;
const HERESPHERE_RECONNECT_MS = 5000;
const STREAM_PARK_DELAY_MS = 300;
const STREAM_PARK_DURATION_MS = 800;
const BLE_ERROR_WINDOW_MS = 10000;
const BLE_ERROR_LIMIT = 3;
const BLE_RECOVERY_DELAY_MS = 250;

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8');
const $ = (id) => document.getElementById(id);
const ui = Object.fromEntries([
  'globalState', 'languageSelect', 'languageDialog', 'aboutButton', 'aboutDialog', 'aboutClose', 'aboutVersion',
  'hsBadge', 'hsHost', 'hsPort', 'hsConnect', 'hsDisconnect', 'videoPath', 'playerState', 'videoTime', 'playbackSpeed',
  'scriptBadge', 'scriptFolder', 'chooseScriptFolder', 'refreshScriptFolder', 'autoMatchStatus', 'libraryCount', 'matchMode',
  'scriptFile', 'scriptName', 'rawActionCount', 'simpleActionCount', 'scriptDuration', 'simpleMode', 'reverseMode',
  'ossmBadge', 'ossmConnect', 'ossmDisconnect', 'speed', 'stroke', 'depth', 'sensation', 'buffer', 'offset',
  'speedValue', 'strokeValue', 'depthValue', 'sensationValue', 'bufferValue', 'offsetValue',
  'disarmButton', 'resumeAutoButton', 'sentPosition', 'commandsSent', 'actionIndex', 'timestampAge',
  'bleSuccess', 'bleErrors', 'droppedCommands', 'resyncCount', 'bleQueueDepth', 'clockCorrection', 'sleepBlocker',
  'log', 'clearLog', 'openLogFolder', 'purgeLogs', 'logsEnabled', 'logsStatus', 'logTotalSize', 'flightLogPath', 'bluetoothDialog', 'bluetoothDevices', 'bluetoothCancel'
].map((id) => [id, $(id)]));

class RendererFlightBuffer {
  constructor() {
    this.queue = [];
    this.timer = null;
    this.flushing = false;
    this.failed = false;
    this.enabled = false;
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) this.queue = this.queue.filter((event) => this.isCritical(event.type, event));
  }

  isCritical(type, data = {}) {
    if (type === 'ui_log') return String(data.level || '').toUpperCase() === 'ERR';
    return ['operation_error', 'stream_exception', 'renderer_crash', 'main_error', 'unhandled_rejection'].includes(type);
  }

  record(type, data = {}) {
    if (!this.enabled && !this.isCritical(type, data)) return;
    this.queue.push({
      type,
      wallTime: new Date().toISOString(),
      perfMs: Number(performance.now().toFixed(3)),
      ...data
    });
    if (this.queue.length >= 100) this.flush();
    else if (!this.timer) this.timer = setTimeout(() => this.flush(), 250);
  }

  async flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.flushing || this.queue.length === 0) return;
    this.flushing = true;
    const batch = this.queue.splice(0, 1000);
    try {
      await window.desktopBridge.flight.recordBatch(batch);
      this.failed = false;
    } catch (error) {
      this.queue.unshift(...batch);
      if (!this.failed) console.error('Diagnostic log write failed:', error);
      this.failed = true;
    } finally {
      this.flushing = false;
      if (this.queue.length > 0 && !this.timer) this.timer = setTimeout(() => this.flush(), 250);
    }
  }
}

const flight = new RendererFlightBuffer();

function formatTime(seconds) {
  const safe = Number.isFinite(seconds) && seconds >= 0 ? seconds : 0;
  const minutes = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const millis = Math.floor((safe % 1) * 1000);
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

function formatBytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value < 1024) return `${value} o`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} Ko`;
  return `${(value / (1024 * 1024)).toFixed(1)} Mo`;
}

function applyDiagnosticLogStatus(status) {
  const enabled = Boolean(status?.enabled);
  flight.setEnabled(enabled);
  ui.logsEnabled.checked = enabled;
  ui.logsStatus.textContent = enabled ? t('log.enabled') : t('log.disabled');
  ui.logsStatus.className = `badge ${enabled ? 'good' : 'neutral'}`;
  ui.logTotalSize.textContent = formatBytes(status?.totalBytes);
  ui.flightLogPath.textContent = enabled && status?.filePath ? status.filePath : t('log.none');
}

async function refreshDiagnosticLogStatus() {
  const status = await window.desktopBridge.flight.info();
  applyDiagnosticLogStatus(status);
  return status;
}

function log(message, level = 'INFO') {
  const localeMap = { fr: 'fr-FR', en: 'en-GB', es: 'es-ES', 'pt-BR': 'pt-BR' };
  const locale = localeMap[getLanguage()] || 'fr-FR';
  const line = `[${new Date().toLocaleTimeString(locale, { hour12: false })}] ${level.padEnd(4)} ${message}`;
  ui.log.textContent += `${line}\n`;
  ui.log.scrollTop = ui.log.scrollHeight;
  flight.record('ui_log', { level, message });
}

function setBadge(element, text, tone = 'neutral') {
  element.textContent = text;
  element.className = `badge ${tone}`;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeActions(actions) {
  if (!Array.isArray(actions) || actions.length < 2) throw new Error('Le funscript doit contenir au moins deux actions.');
  const result = actions.map((action, index) => {
    const pos = Number(action?.pos);
    const at = Number(action?.at);
    if (!Number.isFinite(pos) || !Number.isFinite(at)) throw new Error(`Action ${index + 1} invalide.`);
    return { pos, at };
  });
  for (let index = 1; index < result.length; index += 1) {
    if (result[index].at < result[index - 1].at) throw new Error('Les timestamps du funscript ne sont pas chronologiques.');
  }
  return result;
}

function buildRdSimpleActions(actions) {
  let lastDirection = 0;
  const simpleActions = [];
  actions.forEach((value, index) => {
    const nextValue = actions[index + 1];
    if (!nextValue) return;
    const delta = value.pos - nextValue.pos;
    if (delta === 0) return;
    const direction = delta / Math.abs(delta);
    if (direction !== lastDirection) simpleActions.push(actions[index]);
    lastDirection = direction;
  });
  return simpleActions;
}

function parseFunscript(content) {
  let data = null;
  try {
    data = JSON.parse(content);
  } catch {
    const rows = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    data = {
      actions: rows.map((line) => {
        const [at, pos] = line.split(',');
        return { at: Number(at), pos: Number(pos) };
      })
    };
  }
  const actions = normalizeActions(data?.actions);
  return { actions, simpleActions: buildRdSimpleActions(actions), metadata: data || {} };
}

function segmentSnapshot(actions, currentTimeMs, reverse = false) {
  if (!Array.isArray(actions) || actions.length === 0) return null;
  let nextIndex = actions.findIndex((action) => action.at > currentTimeMs);
  if (nextIndex < 0) nextIndex = actions.length;
  const previousIndex = Math.max(0, Math.min(actions.length - 1, nextIndex - 1));
  const boundedNextIndex = Math.max(0, Math.min(actions.length - 1, nextIndex));
  const previous = actions[previousIndex];
  const next = actions[boundedNextIndex];
  let logicalPosition = Number(previous?.pos ?? 0);
  let ratio = 0;
  if (next && previous && next.at > previous.at && currentTimeMs >= previous.at && currentTimeMs <= next.at) {
    ratio = (currentTimeMs - previous.at) / (next.at - previous.at);
    logicalPosition = previous.pos + (next.pos - previous.pos) * ratio;
  }
  const rawPosition = reverse ? 100 - logicalPosition : logicalPosition;
  return {
    currentTimeMs,
    previousIndex,
    nextIndex: boundedNextIndex,
    previous,
    next,
    ratio: Number(ratio.toFixed(6)),
    logicalPosition: Number(logicalPosition.toFixed(3)),
    rawPosition: Number(rawPosition.toFixed(3))
  };
}

class OssmStreamingBle {
  constructor() {
    this.device = null;
    this.server = null;
    this.commandCharacteristic = null;
    this.stateCharacteristic = null;
    this.speedKnobCharacteristic = null;
    this.latencyCharacteristic = null;
    this.connected = false;
    this.lastState = null;
    this.errorTimes = [];
    this.arbiter = new BleOperationArbiter({
      onMetrics: (metrics) => this.updateMetrics(metrics),
      onDropped: (item, reason) => {
        updateDroppedMetric();
        flight.record('ble_drop', { id: item?.id, label: item?.label, reason, metadata: item?.metadata || null });
      },
      onError: (error, item) => this.onOperationError(error, item),
      onEvent: (event) => flight.record('ble_arbiter', event)
    });
  }

  updateMetrics(metrics) {
    ui.bleSuccess.textContent = String(metrics.successful);
    ui.bleErrors.textContent = String(metrics.errors);
    ui.bleQueueDepth.textContent = String(metrics.queueDepth);
    updateDroppedMetric();
  }

  async writeCharacteristic(characteristic, payload, preferWithoutResponse = false) {
    if (!characteristic) throw new Error('Caractéristique BLE indisponible.');
    if (preferWithoutResponse && typeof characteristic.writeValueWithoutResponse === 'function') {
      await characteristic.writeValueWithoutResponse(payload);
    } else {
      await characteristic.writeValue(payload);
    }
  }

  async writeCommandRaw(command) {
    if (!this.commandCharacteristic) throw new Error('Caractéristique commande OSSM indisponible.');
    await this.writeCharacteristic(this.commandCharacteristic, encoder.encode(command), true);
  }

  enqueueControl(label, operation, options = {}) {
    return this.arbiter.enqueueControl(label, operation, options);
  }

  async connect() {
    if (!navigator.bluetooth) throw new Error('Web Bluetooth indisponible dans Electron.');
    if (this.connected) throw new Error('OSSM déjà connecté.');
    this.arbiter.reset('nouvelle connexion');
    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [OSSM.service] }],
      optionalServices: [OSSM.service]
    });
    this.device.addEventListener('gattserverdisconnected', () => this.onDisconnected());
    this.server = await this.device.gatt.connect();
    const service = await this.server.getPrimaryService(OSSM.service);
    this.commandCharacteristic = await service.getCharacteristic(OSSM.command);
    this.speedKnobCharacteristic = await service.getCharacteristic(OSSM.speedKnob);
    this.latencyCharacteristic = await service.getCharacteristic(OSSM.latencyCompensation);
    try {
      this.stateCharacteristic = await service.getCharacteristic(OSSM.state);
    } catch {
      this.stateCharacteristic = null;
    }
    this.connected = true;

    try {
      await this.enqueueControl('go:streaming', () => this.writeCommandRaw('go:streaming'), { clearPendingStream: true });

      if (this.stateCharacteristic) {
        try {
          await this.enqueueControl('état initial', async () => {
            const value = await this.stateCharacteristic.readValue();
            this.handleState(value);
          });
          await this.enqueueControl('notifications état', async () => {
            await this.stateCharacteristic.startNotifications();
            this.stateCharacteristic.addEventListener('characteristicvaluechanged', (event) => this.handleState(event.target.value));
          });
        } catch (error) {
          log(`Notifications d’état indisponibles : ${error.message}`, 'WARN');
          this.stateCharacteristic = null;
        }
      }

      await this.enqueueControl('bouton vitesse', () => this.writeCharacteristic(this.speedKnobCharacteristic, encoder.encode('false')));
      await this.enqueueControl('compensation latence', () => this.writeCharacteristic(this.latencyCharacteristic, encoder.encode('true')));
      await applyRememberedMotorSettings();
      setBadge(ui.ossmBadge, this.device.name || t('ossm.connected'), 'good');
      log('OSSM connecté, mode Streaming actif, compensation de latence activée.');
    } catch (error) {
      await this.disconnect({ silent: true });
      throw error;
    }
  }

  handleState(value) {
    const text = decoder.decode(value).replace(/\0/g, '').trim();
    if (!text.startsWith('{')) return;
    try {
      const state = JSON.parse(text);
      if (state && typeof state === 'object') {
        this.lastState = state;
        let learned = false;
        for (const name of ['speed', 'stroke', 'depth', 'sensation']) {
          if (!Number.isFinite(Number(rememberedMotorSettings[name])) && Number.isFinite(Number(state[name]))) {
            updateSlider(name, Number(state[name]), false);
            learned = true;
          }
        }
        if (!Number.isFinite(Number(rememberedMotorSettings.buffer)) && Number.isFinite(Number(state.buffer))) {
          updateSlider('buffer', Number(state.buffer) * 2, false);
          learned = true;
        }
        if (learned) saveMotorSettings();
      }
    } catch (error) {
      log(`État OSSM JSON invalide : ${error.message}`, 'WARN');
    }
  }

  sendStreamPosition(position, timeMs, metadata = {}) {
    if (!this.connected) return Promise.resolve({ status: 'dropped', reason: 'disconnected' });
    const pos = clamp(Math.round(position), 0, 100);
    const duration = clamp(Math.round(timeMs), 1, 10000);
    const command = `stream:${pos}:${duration}`;
    const enrichedMetadata = {
      ...metadata,
      pos,
      duration,
      createdPerfMs: Number(performance.now().toFixed(3)),
      videoSeconds: Number(clock.nowAt().toFixed(6)),
      actionIndex: scheduler.currentIndex,
      armed,
      playing: clock.isPlaying(),
      parking: streamPark.active
    };
    flight.record('stream_created', { command, metadata: enrichedMetadata });
    return this.arbiter.submitStream(command, () => this.writeCommandRaw(command), enrichedMetadata)
      .then((result) => {
        flight.record('stream_result', { command, result, metadata: enrichedMetadata });
        if (result.status === 'ok') {
          if (metadata.kind === 'script') scheduler.commandsSent += 1;
          scheduler.lastPosition = pos;
          ui.commandsSent.textContent = String(scheduler.commandsSent);
          ui.sentPosition.textContent = String(pos);
        }
        return result;
      })
      .catch((error) => {
        flight.record('stream_exception', { command, error: error?.message || String(error), metadata: enrichedMetadata });
        log(`Échec ${command} : ${error.message}`, 'ERR');
        return { status: 'error', error };
      });
  }

  clearPendingStream(reason) {
    return this.arbiter.clearPendingStream(reason);
  }

  async setParameter(name, value) {
    const command = `set:${name}:${value}`;
    await this.enqueueControl(command, () => this.writeCommandRaw(command));
    log(`Réglage OSSM : ${command}`);
  }

  onOperationError(error, item) {
    if (item.type !== 'stream') return;
    const now = performance.now();
    this.errorTimes = this.errorTimes.filter((time) => now - time <= BLE_ERROR_WINDOW_MS);
    this.errorTimes.push(now);
    scheduler.writeErrors += 1;
    this.clearPendingStream('erreur BLE');
    if (this.errorTimes.length >= BLE_ERROR_LIMIT) {
      disarm('erreurs BLE répétées');
      log(`${this.errorTimes.length} erreurs BLE en moins de ${BLE_ERROR_WINDOW_MS / 1000} s : automatisme désarmé.`, 'ERR');
      return;
    }
    scheduler.recoverAfterBleError();
  }

  async disconnect({ silent = false } = {}) {
    disarm('déconnexion OSSM');
    this.clearPendingStream('déconnexion');
    try {
      if (this.commandCharacteristic && this.connected) {
        await this.enqueueControl('arrêt déconnexion', () => this.writeCommandRaw('set:speed:0'), { clearPendingStream: true });
      }
    } catch {}
    try {
      if (this.server?.connected) this.server.disconnect();
    } catch {}
    this.onDisconnected(silent);
  }

  onDisconnected(silent = false) {
    const wasConnected = this.connected;
    this.connected = false;
    this.server = null;
    this.commandCharacteristic = null;
    this.stateCharacteristic = null;
    this.speedKnobCharacteristic = null;
    this.latencyCharacteristic = null;
    this.arbiter.reset('déconnexion');
    setBadge(ui.ossmBadge, t('ossm.disconnected'), 'neutral');
    disarm('OSSM déconnecté');
    if (wasConnected && !silent) log('OSSM déconnecté.');
  }
}

class RdScheduler {
  constructor() {
    this.actions = [];
    this.simpleActions = [];
    this.currentIndex = 0;
    this.timer = null;
    this.recoveryTimer = null;
    this.seekSettleTimer = null;
    this.commandsSent = 0;
    this.writeErrors = 0;
    this.lastPosition = null;
    this.skippedDue = 0;
    this.resyncs = 0;
  }

  activeActions() {
    return ui.simpleMode.checked ? this.simpleActions : this.actions;
  }

  setScript(parsed) {
    this.actions = parsed.actions;
    this.simpleActions = parsed.simpleActions;
    this.reset();
  }

  reset() {
    this.stop();
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
    if (this.seekSettleTimer) clearTimeout(this.seekSettleTimer);
    this.recoveryTimer = null;
    this.seekSettleTimer = null;
    this.currentIndex = 0;
    this.commandsSent = 0;
    this.writeErrors = 0;
    this.lastPosition = null;
    this.skippedDue = 0;
    this.resyncs = 0;
    ui.commandsSent.textContent = '0';
    ui.sentPosition.textContent = '—';
    ui.actionIndex.textContent = '0';
    ui.resyncCount.textContent = '0';
    updateDroppedMetric();
  }

  seekTo(seconds, reason = '') {
    ossm.clearPendingStream(reason || 'repositionnement');
    const actions = this.activeActions();
    const currentTimeMs = Math.max(0, seconds * 1000);
    const snapshot = segmentSnapshot(actions, currentTimeMs, ui.reverseMode.checked);
    const previousIndex = this.currentIndex;
    this.currentIndex = actions.findIndex((action) => action.at > currentTimeMs);
    if (this.currentIndex === -1) this.currentIndex = actions.length;
    ui.actionIndex.textContent = String(this.currentIndex);
    flight.record('scheduler_seek', { reason, seconds, currentTimeMs, previousIndex, nextIndex: this.currentIndex, snapshot, simplified: ui.simpleMode.checked, reverse: ui.reverseMode.checked });
    if (reason) {
      this.resyncs += 1;
      ui.resyncCount.textContent = String(this.resyncs);
      log(`Repositionnement script à ${formatTime(seconds)} (index ${this.currentIndex}, ${reason}).`);
    }
  }

  start() {
    if (this.timer || streamPark.active || this.recoveryTimer || this.seekSettleTimer) return;
    this.timer = setInterval(() => this.tick(), 2);
    flight.record('scheduler_start', { index: this.currentIndex, videoSeconds: Number(clock.nowAt().toFixed(6)) });
    log('Scheduler R+D démarré (2 ms).');
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    flight.record('scheduler_stop', { index: this.currentIndex, videoSeconds: Number(clock.nowAt().toFixed(6)) });
    log('Scheduler arrêté.');
  }

  tick() {
    if (!armed || !ossm.connected || !clock.isPlaying() || streamPark.active) return;
    if (clock.ageMs() > STALE_TIMESTAMP_MS) return;
    if (Math.abs(clock.speed() - 1) > 0.001) return;

    const actions = this.activeActions();
    if (actions.length === 0) return;
    const currentTimeMs = clock.nowAt() * 1000 + Number(ui.offset.value) + Number(ui.buffer.value);
    const previousIndex = this.currentIndex;
    const due = computeLatestDueCommand(actions, this.currentIndex, currentTimeMs, ui.reverseMode.checked);
    if (due.nextIndex === this.currentIndex) return;

    flight.record('scheduler_due', {
      currentTimeMs,
      videoSeconds: Number(clock.nowAt().toFixed(6)),
      offsetMs: Number(ui.offset.value),
      deviceBufferMs: Number(ui.buffer.value),
      previousIndex,
      due,
      snapshot: segmentSnapshot(actions, currentTimeMs, ui.reverseMode.checked),
      simplified: ui.simpleMode.checked,
      reverse: ui.reverseMode.checked
    });
    this.currentIndex = due.nextIndex;
    ui.actionIndex.textContent = String(this.currentIndex);
    if (due.skipped > 0) {
      this.skippedDue += due.skipped;
      updateDroppedMetric();
    }
    if (!due.command) return;

    ossm.sendStreamPosition(due.command.target, due.command.duration, {
      kind: 'script',
      sourceAt: due.command.sourceAt,
      sourceIndex: due.command.sourceIndex
    });
  }

  suspendForClockCandidate() {
    this.stop();
    ossm.clearPendingStream('écart horloge à confirmer');
    if (this.seekSettleTimer) clearTimeout(this.seekSettleTimer);
    this.seekSettleTimer = setTimeout(() => {
      this.seekSettleTimer = null;
      if (!armed || !ossm.connected || !clock.isPlaying() || streamPark.active) return;
      this.seekTo(clock.nowAt(), 'écart horloge stabilisé');
      this.start();
    }, 250);
  }

  settleAfterSeek(seconds) {
    this.stop();
    if (this.seekSettleTimer) clearTimeout(this.seekSettleTimer);
    this.seekSettleTimer = null;
    this.seekTo(seconds, 'seek HereSphere confirmé');
    if (this.seekSettleTimer) clearTimeout(this.seekSettleTimer);
    this.seekSettleTimer = setTimeout(() => {
      this.seekSettleTimer = null;
      if (!armed || !ossm.connected || !clock.isPlaying() || streamPark.active) return;
      this.seekTo(clock.nowAt());
      this.start();
    }, 200);
  }

  recoverAfterBleError() {
    if (this.recoveryTimer || !armed) return;
    this.stop();
    ossm.clearPendingStream('récupération BLE');
    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = null;
      if (!armed || !ossm.connected || !clock.isPlaying() || streamPark.active) return;
      this.seekTo(clock.nowAt(), 'récupération BLE');
      this.start();
    }, BLE_RECOVERY_DELAY_MS);
  }
}

class StreamingParkController {
  constructor() {
    this.delayTimer = null;
    this.finishTimer = null;
    this.active = false;
    this.paused = false;
    this.resumeRequested = false;
    this.parkUntilPerf = 0;
    this.runToken = 0;
  }

  clearDelay() {
    if (this.delayTimer) clearTimeout(this.delayTimer);
    this.delayTimer = null;
  }

  clearFinish() {
    if (this.finishTimer) clearTimeout(this.finishTimer);
    this.finishTimer = null;
  }

  onPause({ initial = false } = {}) {
    flight.record('park_pause_received', { initial, active: this.active, armed, connected: ossm.connected, videoSeconds: Number(clock.nowAt().toFixed(6)) });
    this.paused = true;
    this.resumeRequested = false;
    scheduler.stop();
    ossm.clearPendingStream('pause HereSphere');
    this.clearDelay();
    if (!armed || !ossm.connected || manualStopLatched) return;
    this.delayTimer = setTimeout(() => {
      this.delayTimer = null;
      this.start();
    }, STREAM_PARK_DELAY_MS);
    if (!initial) log(`Parking Streaming programmé après ${STREAM_PARK_DELAY_MS} ms de pause.`);
  }

  onPlay() {
    flight.record('park_play_received', { active: this.active, armed, connected: ossm.connected, videoSeconds: Number(clock.nowAt().toFixed(6)) });
    this.paused = false;
    this.clearDelay();
    if (!armed || manualStopLatched) return;
    if (this.active) {
      this.resumeRequested = true;
      log('Lecture reprise pendant le parking : reprise du script à la fin du retour rétracté.', 'WARN');
      return;
    }
    this.resumeNow('reprise HereSphere');
  }

  async start() {
    if (!this.paused || this.active || !armed || !ossm.connected || manualStopLatched) return;
    const token = ++this.runToken;
    this.active = true;
    this.resumeRequested = false;
    updateGlobalState();
    scheduler.stop();
    ossm.clearPendingStream('parking Streaming');

    const logicalRetracted = 0;
    const rawTarget = ui.reverseMode.checked ? 100 - logicalRetracted : logicalRetracted;
    flight.record('park_start', { logicalTarget: logicalRetracted, rawTarget, durationMs: STREAM_PARK_DURATION_MS, reverse: ui.reverseMode.checked, videoSeconds: Number(clock.nowAt().toFixed(6)) });
    log(`Parking Streaming : cible rétractée ${rawTarget}, durée ${STREAM_PARK_DURATION_MS} ms.`, 'WARN');
    const result = await ossm.sendStreamPosition(rawTarget, STREAM_PARK_DURATION_MS, { kind: 'park' });
    if (token !== this.runToken) return;
    if (result.status !== 'ok') {
      this.active = false;
      updateGlobalState();
      log('Parking Streaming non transmis ; la machine reste sans nouvelle commande.', 'ERR');
      return;
    }

    this.parkUntilPerf = performance.now() + STREAM_PARK_DURATION_MS;
    this.clearFinish();
    this.finishTimer = setTimeout(() => this.finish(token), STREAM_PARK_DURATION_MS + 20);
  }

  finish(token = this.runToken) {
    if (token !== this.runToken) return;
    this.clearFinish();
    this.active = false;
    this.parkUntilPerf = 0;
    flight.record('park_finish', { resumeRequested: this.resumeRequested, paused: this.paused, videoSeconds: Number(clock.nowAt().toFixed(6)) });
    updateGlobalState();
    if (this.resumeRequested && !this.paused) this.resumeNow('parking Streaming');
  }

  resumeNow(reason) {
    this.resumeRequested = false;
    if (!armed || manualStopLatched || !ossm.connected || !clock.isPlaying()) return;
    scheduler.seekTo(clock.nowAt(), reason);
    scheduler.start();
  }

  onDisarm({ preserveActive = true } = {}) {
    this.clearDelay();
    this.resumeRequested = false;
    if (!preserveActive || !this.active) {
      this.runToken += 1;
      this.clearFinish();
      this.active = false;
      this.parkUntilPerf = 0;
    }
    updateGlobalState();
  }
}

const clock = new StabilizedHereSphereClock();
const scheduler = new RdScheduler();
const ossm = new OssmStreamingBle();
const streamPark = new StreamingParkController();

let parsedScript = null;
let armed = false;
let manualStopLatched = false;
let currentVideoKey = '';
let loadedVideoKey = '';
let scriptLibraryRoot = '';
let autoLoadGeneration = 0;
let lastAutoArmFailure = '';
let hereSphereConnected = false;
let hereSphereAutoConnectBusy = false;
let hereSphereReconnectTimer = null;
let manualHereSphereDisconnect = false;
let lastHereSphereConnectError = '';

const SCRIPT_FOLDER_STORAGE_KEY = 'ossm-heresphere-script-folder';
const HERESPHERE_HOST_STORAGE_KEY = 'ossm-heresphere-last-host';
const MOTOR_SETTINGS_STORAGE_KEY = 'ossm-heresphere-motor-settings';
const PLAYBACK_SETTINGS_STORAGE_KEY = 'ossm-heresphere-playback-settings';
let rememberedMotorSettings = loadRememberedMotorSettings();
let rememberedPlaybackSettings = loadRememberedPlaybackSettings();

function loadRememberedPlaybackSettings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PLAYBACK_SETTINGS_STORAGE_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function savePlaybackSettings() {
  rememberedPlaybackSettings = {
    simplified: Boolean(ui.simpleMode.checked),
    reverse: Boolean(ui.reverseMode.checked)
  };
  localStorage.setItem(PLAYBACK_SETTINGS_STORAGE_KEY, JSON.stringify(rememberedPlaybackSettings));
}

ui.simpleMode.checked = rememberedPlaybackSettings.simplified === true;
ui.reverseMode.checked = rememberedPlaybackSettings.reverse !== false;

function loadRememberedMotorSettings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(MOTOR_SETTINGS_STORAGE_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveMotorSettings() {
  rememberedMotorSettings = Object.fromEntries(
    ['speed', 'stroke', 'depth', 'sensation', 'buffer', 'offset'].map((name) => [name, Number(ui[name].value)])
  );
  localStorage.setItem(MOTOR_SETTINGS_STORAGE_KEY, JSON.stringify(rememberedMotorSettings));
}

async function applyRememberedMotorSettings() {
  for (const name of ['speed', 'stroke', 'depth', 'sensation', 'buffer']) {
    const value = Number(rememberedMotorSettings[name]);
    if (!Number.isFinite(value)) continue;
    const transmitted = name === 'buffer' ? value / 2 : value;
    await ossm.setParameter(name, transmitted);
  }
}

function videoKey(timestamp) {
  return String(timestamp?.resource || timestamp?.path || timestamp?.identifier || '');
}

function updateDroppedMetric() {
  const bleDropped = ossm?.arbiter?.metrics().dropped || 0;
  const schedulerDropped = scheduler?.skippedDue || 0;
  ui.droppedCommands.textContent = String(bleDropped + schedulerDropped);
}

function updateGlobalState() {
  if (manualStopLatched) {
    ui.globalState.textContent = t('state.manualStop');
    ui.globalState.className = 'pill bad';
  } else if (streamPark.active) {
    ui.globalState.textContent = t('state.parking');
    ui.globalState.className = 'pill warn';
  } else if (armed) {
    ui.globalState.textContent = t('state.armed');
    ui.globalState.className = 'pill good';
  } else {
    ui.globalState.textContent = t('state.waiting');
    ui.globalState.className = 'pill neutral';
  }
}

function disarm(reason = '') {
  const wasActive = armed || Boolean(scheduler.timer) || streamPark.active;
  armed = false;
  scheduler.stop();
  ossm.clearPendingStream(reason || 'désarmement');
  streamPark.onDisarm({ preserveActive: ossm.connected });
  updateGlobalState();
  if (reason && wasActive) log(`Désarmement : ${reason}.`, 'WARN');
}

function clearLoadedScript(statusText = 'Aucun script') {
  parsedScript = null;
  loadedVideoKey = '';
  scheduler.setScript({ actions: [], simpleActions: [] });
  ui.scriptName.textContent = '—';
  ui.rawActionCount.textContent = '0';
  ui.simpleActionCount.textContent = '0';
  ui.scriptDuration.textContent = '00:00.000';
  ui.matchMode.textContent = '—';
  setBadge(ui.scriptBadge, statusText, 'neutral');
}

function displayLoadedScript(parsed, displayName, matchMode = 'Manuel') {
  parsedScript = parsed;
  scheduler.setScript(parsedScript);
  ui.scriptName.textContent = displayName;
  ui.rawActionCount.textContent = String(parsedScript.actions.length);
  ui.simpleActionCount.textContent = String(parsedScript.simpleActions.length);
  ui.scriptDuration.textContent = formatTime(parsedScript.actions.at(-1).at / 1000);
  ui.matchMode.textContent = matchMode;
  setBadge(ui.scriptBadge, t('status.scriptLoaded'), 'good');
}

function updateLibrarySummary(summary) {
  scriptLibraryRoot = String(summary?.root || '');
  ui.scriptFolder.textContent = scriptLibraryRoot || t('script.noFolder');
  ui.libraryCount.textContent = String(Number(summary?.count) || 0);
  ui.refreshScriptFolder.disabled = !scriptLibraryRoot;
  if (scriptLibraryRoot) localStorage.setItem(SCRIPT_FOLDER_STORAGE_KEY, scriptLibraryRoot);
}

function matchModeLabel(priority) {
  return priority === 'video-filename' ? 'Nom complet' : 'Nom sans extension';
}

function setAutoMatchStatus(text, tone = 'neutral') {
  ui.autoMatchStatus.textContent = text;
  ui.autoMatchStatus.className = `helper ${tone === 'bad' ? 'status-bad' : tone === 'good' ? 'status-good' : tone === 'warn' ? 'status-warn' : ''}`.trim();
}

async function tryAutomaticArm(reason) {
  if (manualStopLatched || !parsedScript || !loadedVideoKey || loadedVideoKey !== currentVideoKey || armed) return;
  try {
    arm();
    lastAutoArmFailure = '';
    log(`Armement automatique effectué (${reason}).`);
  } catch (error) {
    if (lastAutoArmFailure !== error.message) {
      log(`Armement automatique en attente : ${error.message}`, 'WARN');
      lastAutoArmFailure = error.message;
    }
  }
}

async function resolveAndLoadVideoScript(videoSource) {
  if (!videoSource) return;
  const generation = ++autoLoadGeneration;
  disarm('changement ou détection de vidéo HereSphere');
  clearLoadedScript(t('status.searchingScript'));
  setAutoMatchStatus(t('status.autoSearching'));

  try {
    const result = await window.desktopBridge.scripts.resolveVideo(videoSource);
    if (generation !== autoLoadGeneration || videoSource !== currentVideoKey) return;
    if (result.status === 'no-folder') {
      setAutoMatchStatus(t('status.noFolder'), 'warn');
      setBadge(ui.scriptBadge, t('status.folderRequired'), 'warn');
      return;
    }
    if (result.status === 'no-video-name') {
      setAutoMatchStatus(t('status.noVideoName'), 'bad');
      setBadge(ui.scriptBadge, t('status.videoNameMissing'), 'bad');
      return;
    }
    if (result.status === 'none') {
      setAutoMatchStatus(t('status.noScriptFor', { name: result.fileName }), 'warn');
      setBadge(ui.scriptBadge, t('status.noMatch'), 'warn');
      log(`Aucun funscript correspondant à la vidéo : ${result.fileName}.`, 'WARN');
      return;
    }
    if (result.status === 'ambiguous') {
      const names = result.matches.map((item) => item.relativePath).join(' | ');
      setAutoMatchStatus(t('status.ambiguousCount', { count: result.matches.length }), 'bad');
      setBadge(ui.scriptBadge, t('status.ambiguous'), 'bad');
      log(`Plusieurs funscripts correspondent à ${result.fileName} : ${names}`, 'ERR');
      return;
    }

    const parsed = parseFunscript(result.content);
    if (generation !== autoLoadGeneration || videoSource !== currentVideoKey) return;
    displayLoadedScript(parsed, result.match.relativePath, matchModeLabel(result.priority));
    loadedVideoKey = videoSource;
    setAutoMatchStatus(t('status.autoLoaded', { name: result.match.relativePath }), 'good');
    log(`Funscript chargé automatiquement : ${result.match.relativePath}, ${parsed.actions.length} actions, ${parsed.simpleActions.length} simplifiées.`);
    await tryAutomaticArm('script correspondant chargé');
  } catch (error) {
    if (generation !== autoLoadGeneration) return;
    clearLoadedScript('Erreur automatique');
    setAutoMatchStatus(t('status.error', { message: error.message }), 'bad');
    log(`Chargement automatique impossible : ${error.message}`, 'ERR');
  }
}

function canArm() {
  if (manualStopLatched) throw new Error('Arrêt manuel actif.');
  if (!ossm.connected) throw new Error('OSSM non connecté.');
  if (!parsedScript) throw new Error('Aucun funscript chargé.');
  if (!clock.timestamp) throw new Error('Aucun timestamp HereSphere reçu.');
  if (clock.ageMs() > STALE_TIMESTAMP_MS) throw new Error('Timestamps HereSphere périmés.');
  if (Math.abs(clock.speed() - 1) > 0.001) throw new Error('Cette version accepte uniquement une lecture HereSphere à 1,000×.');
}

function arm() {
  if (armed) return;
  canArm();
  armed = true;
  scheduler.seekTo(clock.nowAt());
  updateGlobalState();
  log('Streaming armé. Les commandes suivent désormais HereSphere.', 'WARN');
  if (clock.isPlaying()) streamPark.onPlay();
  else streamPark.onPause({ initial: true });
}

function updateSlider(name, value, transmit = true) {
  const input = ui[name];
  const rounded = Math.round(value);
  input.value = String(rounded);
  ui[`${name}Value`].textContent = name === 'buffer' || name === 'offset' ? `${rounded} ms` : String(rounded);
  if (!transmit || !ossm.connected) return;
  if (name === 'offset') return;
  const transmitted = name === 'buffer' ? rounded / 2 : rounded;
  ossm.setParameter(name, transmitted).catch((error) => log(error.message, 'ERR'));
}

for (const name of ['speed', 'stroke', 'depth', 'sensation', 'buffer', 'offset']) {
  const remembered = Number(rememberedMotorSettings[name]);
  if (Number.isFinite(remembered)) ui[name].value = String(remembered);
  ui[name].addEventListener('input', () => updateSlider(name, Number(ui[name].value), false));
  ui[name].addEventListener('change', () => {
    updateSlider(name, Number(ui[name].value), true);
    saveMotorSettings();
  });
  updateSlider(name, Number(ui[name].value), false);
}

ui.simpleMode.addEventListener('change', () => {
  savePlaybackSettings();
  disarm('changement du mode Simplified');
  if (parsedScript) scheduler.seekTo(clock.nowAt(), 'changement Simplified');
  tryAutomaticArm('changement Simplified');
});
ui.reverseMode.addEventListener('change', () => {
  savePlaybackSettings();
  disarm('changement du sens Reverse');
  tryAutomaticArm('changement Reverse');
});

ui.scriptFile.addEventListener('change', async () => {
  const file = ui.scriptFile.files?.[0];
  if (!file) return;
  try {
    disarm('chargement manuel d’un funscript');
    const parsed = parseFunscript(await file.text());
    displayLoadedScript(parsed, file.name, 'Manuel');
    loadedVideoKey = '';
    setAutoMatchStatus(t('status.manualLoaded'));
    log(`Funscript chargé manuellement : ${file.name}, ${parsed.actions.length} actions, ${parsed.simpleActions.length} simplifiées.`);
  } catch (error) {
    clearLoadedScript('Script invalide');
    setBadge(ui.scriptBadge, t('status.invalidScript'), 'bad');
    log(`Funscript refusé : ${error.message}`, 'ERR');
  }
});

ui.chooseScriptFolder.addEventListener('click', async () => {
  try {
    const result = await window.desktopBridge.scripts.chooseFolder();
    if (result.canceled) return;
    updateLibrarySummary(result);
    setAutoMatchStatus(t('status.indexed', { count: result.count }), 'good');
    log(`Dossier réservoir sélectionné : ${result.root} (${result.count} funscript(s)).`);
    if (currentVideoKey) await resolveAndLoadVideoScript(currentVideoKey);
  } catch (error) {
    setAutoMatchStatus(`Dossier inaccessible : ${error.message}`, 'bad');
    log(`Sélection du dossier impossible : ${error.message}`, 'ERR');
  }
});

ui.refreshScriptFolder.addEventListener('click', async () => {
  try {
    const result = await window.desktopBridge.scripts.refresh();
    updateLibrarySummary(result);
    setAutoMatchStatus(t('status.reindexed', { count: result.count }), 'good');
    log(`Réservoir actualisé : ${result.count} funscript(s).`);
    if (currentVideoKey) await resolveAndLoadVideoScript(currentVideoKey);
  } catch (error) {
    setAutoMatchStatus(`Actualisation impossible : ${error.message}`, 'bad');
    log(`Actualisation du réservoir impossible : ${error.message}`, 'ERR');
  }
});

function clearHereSphereReconnectTimer() {
  if (!hereSphereReconnectTimer) return;
  clearTimeout(hereSphereReconnectTimer);
  hereSphereReconnectTimer = null;
}

function scheduleHereSphereReconnect() {
  if (manualHereSphereDisconnect || hereSphereConnected || hereSphereReconnectTimer) return;
  hereSphereReconnectTimer = setTimeout(() => {
    hereSphereReconnectTimer = null;
    autoConnectHereSphere('reconnexion automatique');
  }, HERESPHERE_RECONNECT_MS);
}

async function autoConnectHereSphere(reason = 'démarrage') {
  if (manualHereSphereDisconnect || hereSphereConnected || hereSphereAutoConnectBusy) return;
  hereSphereAutoConnectBusy = true;
  clearHereSphereReconnectTimer();
  setBadge(ui.hsBadge, t('hs.searching'), 'warn');
  ui.hsHost.value = t('hs.searching');
  try {
    const preferredHost = localStorage.getItem(HERESPHERE_HOST_STORAGE_KEY) || '';
    const result = await window.desktopBridge.hereSphere.autoConnect({ preferredHost });
    ui.hsHost.value = result.host;
    localStorage.setItem(HERESPHERE_HOST_STORAGE_KEY, result.host);
    lastHereSphereConnectError = '';
    log(`HereSphere trouvé automatiquement à ${result.host}:${result.port} (${reason}).`);
  } catch (error) {
    ui.hsHost.value = localStorage.getItem(HERESPHERE_HOST_STORAGE_KEY) || 'Non détecté';
    if (lastHereSphereConnectError !== error.message) {
      log(`Recherche HereSphere : ${error.message}`, 'WARN');
      lastHereSphereConnectError = error.message;
    }
    scheduleHereSphereReconnect();
  } finally {
    hereSphereAutoConnectBusy = false;
  }
}

ui.hsConnect.addEventListener('click', () => {
  manualHereSphereDisconnect = false;
  autoConnectHereSphere('commande utilisateur');
});
ui.hsDisconnect.addEventListener('click', () => {
  manualHereSphereDisconnect = true;
  clearHereSphereReconnectTimer();
  window.desktopBridge.hereSphere.disconnect();
});

window.desktopBridge.hereSphere.onStatus((status) => {
  const tone = status.state === 'connected' ? 'good' : ['connecting', 'discovering'].includes(status.state) ? 'warn' : status.state === 'error' ? 'bad' : 'neutral';
  setBadge(ui.hsBadge, status.message || status.state, tone);
  if (status.host) {
    ui.hsHost.value = status.host;
    if (status.state === 'connected') localStorage.setItem(HERESPHERE_HOST_STORAGE_KEY, status.host);
  }
  hereSphereConnected = status.state === 'connected';
  if (hereSphereConnected || ['connecting', 'discovering'].includes(status.state)) {
    clearHereSphereReconnectTimer();
    lastHereSphereConnectError = '';
  } else {
    disarm('HereSphere indisponible');
    if (!['connecting', 'discovering'].includes(status.state)) scheduleHereSphereReconnect();
  }
});
window.desktopBridge.hereSphere.onLog((message) => log(message));
window.desktopBridge.hereSphere.onTimestamp((timestamp) => {
  const key = videoKey(timestamp);
  const previousVideoKey = currentVideoKey;
  flight.record('heresphere_timestamp', {
    videoKey: key,
    currentTime: Number(timestamp?.currentTime),
    duration: Number(timestamp?.duration),
    playerState: Number(timestamp?.playerState),
    playbackSpeed: Number(timestamp?.playbackSpeed),
    resource: timestamp?.resource || null,
    path: timestamp?.path || null,
    identifier: timestamp?.identifier || null,
    keys: Object.keys(timestamp || {})
  });
  const update = clock.update(timestamp, key);
  flight.record('clock_update', {
    videoKey: key,
    update,
    estimatedSeconds: Number(clock.nowAt().toFixed(6)),
    ageMs: Number(clock.ageMs().toFixed(3)),
    playing: clock.isPlaying(),
    speed: clock.speed()
  });
  ui.clockCorrection.textContent = `${update.correctionMs >= 0 ? '+' : ''}${update.correctionMs.toFixed(1)} ms`;

  if (key && key !== previousVideoKey) {
    if (previousVideoKey) log(`Nouvelle vidéo détectée : ${key}`, 'WARN');
    currentVideoKey = key;
    resolveAndLoadVideoScript(key);
  }

  if (update.speedChanged && Math.abs(clock.speed() - 1) > 0.001) {
    disarm('vitesse HereSphere différente de 1×');
    log(`Vitesse HereSphere ${clock.speed()}× non prise en charge.`, 'WARN');
  }

  if (update.seekCandidate && parsedScript) scheduler.suspendForClockCandidate();
  if (update.seekDetected && parsedScript) scheduler.settleAfterSeek(clock.nowAt());

  if (update.stateChanged) {
    if (clock.isPlaying()) {
      streamPark.onPlay();
      log('HereSphere : lecture.');
    } else {
      streamPark.onPause();
      log('HereSphere : pause / arrêt.');
    }
  }

  ui.videoPath.textContent = key || '—';
  ui.playerState.textContent = clock.isPlaying() ? t('player.playing') : t('player.paused', { state: timestamp.playerState });
  ui.playbackSpeed.textContent = `${clock.speed().toFixed(3)}×`;
  if (!armed && parsedScript && loadedVideoKey === currentVideoKey) tryAutomaticArm('timestamp HereSphere reçu');
});

ui.ossmConnect.addEventListener('click', async () => {
  try {
    setBadge(ui.ossmBadge, t('ossm.connecting'), 'warn');
    await ossm.connect();
    await tryAutomaticArm('connexion OSSM');
  } catch (error) {
    setBadge(ui.ossmBadge, t('ossm.connectionFailed'), 'bad');
    log(`Connexion OSSM échouée : ${error.message}`, 'ERR');
  }
});
ui.ossmDisconnect.addEventListener('click', () => ossm.disconnect());
ui.disarmButton.addEventListener('click', () => {
  manualStopLatched = true;
  disarm('arrêt manuel utilisateur');
});
ui.resumeAutoButton.addEventListener('click', async () => {
  manualStopLatched = false;
  updateGlobalState();
  log('Automatisme réactivé.');
  if (currentVideoKey && !parsedScript) await resolveAndLoadVideoScript(currentVideoKey);
  await tryAutomaticArm('réactivation utilisateur');
});
ui.clearLog.addEventListener('click', () => { ui.log.textContent = ''; });
ui.logsEnabled.addEventListener('change', async () => {
  ui.logsEnabled.disabled = true;
  try {
    await flight.flush();
    const status = await window.desktopBridge.flight.setEnabled(ui.logsEnabled.checked);
    applyDiagnosticLogStatus(status);
    log(status.enabled ? 'Journaux de diagnostic activés.' : 'Journaux de diagnostic désactivés.');
  } catch (error) {
    ui.logsEnabled.checked = !ui.logsEnabled.checked;
    log(`Modification des journaux impossible : ${error.message}`, 'ERR');
  } finally {
    ui.logsEnabled.disabled = false;
  }
});
ui.openLogFolder.addEventListener('click', async () => {
  try {
    await flight.flush();
    const info = await window.desktopBridge.flight.openFolder();
    applyDiagnosticLogStatus(info);
  } catch (error) {
    log(`Ouverture du dossier des journaux impossible : ${error.message}`, 'ERR');
  }
});
ui.purgeLogs.addEventListener('click', async () => {
  if (!window.confirm(t('log.purgeConfirm'))) return;
  try {
    await flight.flush();
    const status = await window.desktopBridge.flight.purge();
    applyDiagnosticLogStatus(status);
    log(t('log.purged'));
  } catch (error) {
    log(`Suppression des journaux impossible : ${error.message}`, 'ERR');
  }
});

window.desktopBridge.bluetooth.onDeviceList((devices) => {
  ui.bluetoothDevices.replaceChildren();
  for (const device of devices) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = device.deviceName;
    button.addEventListener('click', () => {
      window.desktopBridge.bluetooth.selectDevice(device.deviceId);
      ui.bluetoothDialog.close();
    });
    ui.bluetoothDevices.appendChild(button);
  }
  if (!ui.bluetoothDialog.open) ui.bluetoothDialog.showModal();
});
ui.bluetoothCancel.addEventListener('click', () => window.desktopBridge.bluetooth.cancelSelection());

async function refreshSleepBlockerStatus() {
  try {
    const status = await window.desktopBridge.powerSave.status();
    ui.sleepBlocker.textContent = status.active ? t('sleep.active') : t('sleep.inactive');
    ui.sleepBlocker.className = status.active ? 'metric-good' : 'metric-bad';
  } catch {
    ui.sleepBlocker.textContent = '—';
  }
}

setInterval(() => {
  ui.videoTime.textContent = formatTime(clock.nowAt());
  const age = clock.ageMs();
  ui.timestampAge.textContent = Number.isFinite(age) ? `${Math.round(age)} ms` : '—';
  if (armed && clock.isPlaying() && age > STALE_TIMESTAMP_MS) disarm('plus de timestamp HereSphere frais');
  if (armed && !clock.isPlaying()) scheduler.stop();
}, 100);
setInterval(refreshSleepBlockerStatus, 30000);
setInterval(() => refreshDiagnosticLogStatus().catch(() => {}), 30000);
setInterval(() => {
  const actions = scheduler.activeActions();
  flight.record('runtime_sample', {
    armed,
    manualStopLatched,
    hereSphereConnected,
    playing: clock.isPlaying(),
    videoSeconds: Number(clock.nowAt().toFixed(6)),
    timestampAgeMs: Number.isFinite(clock.ageMs()) ? Number(clock.ageMs().toFixed(3)) : null,
    clockErrorMs: Number(clock.lastErrorMs?.toFixed?.(3) ?? 0),
    clockCorrectionMs: Number(clock.lastCorrectionMs?.toFixed?.(3) ?? 0),
    videoKey: currentVideoKey,
    loadedVideoKey,
    scriptName: ui.scriptName.textContent,
    actionIndex: scheduler.currentIndex,
    actionCount: actions.length,
    segment: segmentSnapshot(actions, clock.nowAt() * 1000, ui.reverseMode.checked),
    lastSentPosition: scheduler.lastPosition,
    commandsSent: scheduler.commandsSent,
    skippedDue: scheduler.skippedDue,
    resyncs: scheduler.resyncs,
    parking: streamPark.active,
    pausedForPark: streamPark.paused,
    resumeRequested: streamPark.resumeRequested,
    ble: ossm.arbiter.metrics()
  });
}, 250);

window.addEventListener('beforeunload', () => {
  flight.record('renderer_beforeunload', { videoKey: currentVideoKey, actionIndex: scheduler.currentIndex });
  flight.flush();
  window.desktopBridge.flight.flush().catch(() => {});
  manualHereSphereDisconnect = true;
  clearHereSphereReconnectTimer();
  disarm('fermeture application');
  window.desktopBridge.hereSphere.disconnect();
  if (ossm.connected) ossm.disconnect({ silent: true });
});

async function restoreScriptLibrary() {
  try {
    const restored = await window.desktopBridge.scripts.restoreFolder();
    if (restored.status === 'restored') {
      updateLibrarySummary(restored);
      setAutoMatchStatus(`${restored.count} funscript(s) indexé(s) depuis la configuration persistante.`, 'good');
      log(`Dossier réservoir restauré : ${restored.root} (${restored.count} funscript(s)).`);
      return;
    }
    if (restored.status === 'unavailable') {
      updateLibrarySummary({ root: restored.root, count: 0 });
      setAutoMatchStatus(`Dossier mémorisé inaccessible : ${restored.error}`, 'bad');
      log(`Dossier réservoir mémorisé mais inaccessible : ${restored.root} (${restored.error}).`, 'WARN');
      return;
    }
    const legacyRoot = localStorage.getItem(SCRIPT_FOLDER_STORAGE_KEY);
    if (legacyRoot) {
      const summary = await window.desktopBridge.scripts.setFolder(legacyRoot);
      updateLibrarySummary(summary);
      setAutoMatchStatus(`${summary.count} funscript(s) migré(s) vers la configuration persistante.`, 'good');
      log(`Ancien dossier réservoir migré : ${summary.root} (${summary.count} funscript(s)).`);
      return;
    }
    updateLibrarySummary({ root: '', count: 0 });
  } catch (error) {
    updateLibrarySummary({ root: '', count: 0 });
    setAutoMatchStatus(`Restauration impossible : ${error.message}`, 'bad');
    log(`Restauration du dossier réservoir impossible : ${error.message}`, 'WARN');
  }
}

async function initializeAboutDialog() {
  ui.aboutButton.addEventListener('click', async () => {
    try {
      const info = await window.desktopBridge.app.info();
      ui.aboutVersion.textContent = info?.version || '0.1.8';
    } catch {
      ui.aboutVersion.textContent = '0.1.8';
    }
    ui.aboutDialog.showModal();
  });
}

async function initializeLanguage() {
  let saved = '';
  try {
    saved = String(await window.desktopBridge.settings.get('language', '') || '');
  } catch {}
  const supported = ['fr', 'en', 'es', 'pt-BR'];
  const browserLanguage = String(navigator.language || '').toLowerCase();
  const detected = browserLanguage.startsWith('pt') ? 'pt-BR'
    : browserLanguage.startsWith('es') ? 'es'
      : browserLanguage.startsWith('en') ? 'en'
        : 'fr';
  const initial = supported.includes(saved) ? saved : detected;
  setLanguage(initial);
  ui.languageSelect.value = initial;
  ui.languageSelect.addEventListener('change', async () => {
    const language = setLanguage(ui.languageSelect.value);
    await window.desktopBridge.settings.set('language', language);
    updateGlobalState();
    refreshSleepBlockerStatus();
    refreshDiagnosticLogStatus().catch(() => {});
  });
  for (const button of document.querySelectorAll('[data-language-choice]')) {
    button.addEventListener('click', async () => {
      const language = setLanguage(button.dataset.languageChoice);
      ui.languageSelect.value = language;
      await window.desktopBridge.settings.set('language', language);
      ui.languageDialog.close();
      updateGlobalState();
    });
  }
  if (!saved) ui.languageDialog.showModal();
}

await initializeLanguage();
await initializeAboutDialog();
ui.hsPort.value = String(DEFAULT_HERESPHERE_PORT);
updateGlobalState();
await refreshSleepBlockerStatus();
try {
  const flightInfo = await refreshDiagnosticLogStatus();
  flight.record('renderer_ready', { flightInfo, userAgent: navigator.userAgent });
} catch (error) {
  ui.flightLogPath.textContent = t('log.none');
  log(`Enregistreur de diagnostic indisponible : ${error.message}`, 'ERR');
}
restoreScriptLibrary().finally(() => autoConnectHereSphere('démarrage de l’application'));
log(t('app.ready'));
