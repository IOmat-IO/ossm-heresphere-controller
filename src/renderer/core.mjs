export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export class StabilizedHereSphereClock {
  constructor({
    softDeadbandMs = 80,
    softGain = 0.15,
    maxCorrectionMs = 20,
    seekConfirmMs = 800,
    immediateSeekMs = 2000,
    seekCandidateWindowMs = 1500
  } = {}) {
    this.softDeadbandMs = softDeadbandMs;
    this.softGain = softGain;
    this.maxCorrectionMs = maxCorrectionMs;
    this.seekConfirmMs = seekConfirmMs;
    this.immediateSeekMs = immediateSeekMs;
    this.seekCandidateWindowMs = seekCandidateWindowMs;
    this.reset();
  }

  reset() {
    this.timestamp = null;
    this.videoKey = '';
    this.anchorSeconds = 0;
    this.anchorPerf = 0;
    this.playerState = 1;
    this.playbackSpeed = 1;
    this.lastReceivedPerf = 0;
    this.lastErrorMs = 0;
    this.lastCorrectionMs = 0;
    this.seekCandidate = null;
  }

  hardAnchor(seconds, now, state, speed) {
    this.anchorSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    this.anchorPerf = now;
    this.playerState = state;
    this.playbackSpeed = speed;
    this.seekCandidate = null;
  }

  nowAt(perfNow = performance.now()) {
    if (!this.timestamp) return 0;
    if (this.playerState !== 0) return this.anchorSeconds;
    return this.anchorSeconds + ((perfNow - this.anchorPerf) / 1000) * this.playbackSpeed;
  }

  ageMs(perfNow = performance.now()) {
    return this.lastReceivedPerf ? perfNow - this.lastReceivedPerf : Infinity;
  }

  isPlaying() {
    return Boolean(this.timestamp) && this.playerState === 0;
  }

  speed() {
    return this.playbackSpeed || 1;
  }

  update(timestamp, videoKey = '', perfNow = performance.now()) {
    const previous = this.timestamp;
    const previousEstimate = previous ? this.nowAt(perfNow) : null;
    const reportedSeconds = Number(timestamp?.currentTime);
    const state = Number(timestamp?.playerState);
    const speedValue = Number(timestamp?.playbackSpeed);
    const safeSeconds = Number.isFinite(reportedSeconds) ? Math.max(0, reportedSeconds) : 0;
    const safeState = Number.isFinite(state) ? state : 1;
    const safeSpeed = Number.isFinite(speedValue) && speedValue > 0 ? speedValue : 1;
    const nextVideoKey = String(videoKey || '');
    const videoChanged = Boolean(previous) && nextVideoKey !== this.videoKey;
    const stateChanged = Boolean(previous) && safeState !== this.playerState;
    const speedChanged = Boolean(previous) && Math.abs(safeSpeed - this.playbackSpeed) > 0.0001;

    this.timestamp = timestamp;
    this.videoKey = nextVideoKey;
    this.lastReceivedPerf = perfNow;
    this.lastCorrectionMs = 0;

    if (!previous || videoChanged || stateChanged || speedChanged || safeState !== 0 || previousEstimate === null) {
      const errorMs = previousEstimate === null ? 0 : (safeSeconds - previousEstimate) * 1000;
      this.lastErrorMs = errorMs;
      this.hardAnchor(safeSeconds, perfNow, safeState, safeSpeed);
      return {
        previous,
        previousEstimate,
        videoChanged,
        stateChanged,
        speedChanged,
        seekDetected: false,
        seekCandidate: false,
        hardAnchor: true,
        errorMs,
        correctionMs: 0
      };
    }

    const errorMs = (safeSeconds - previousEstimate) * 1000;
    const absErrorMs = Math.abs(errorMs);
    this.lastErrorMs = errorMs;

    let seekDetected = false;
    if (absErrorMs >= this.immediateSeekMs) {
      seekDetected = true;
    } else if (absErrorMs >= this.seekConfirmMs) {
      const direction = Math.sign(errorMs) || 1;
      const candidate = this.seekCandidate;
      if (
        candidate
        && candidate.direction === direction
        && perfNow - candidate.firstPerf <= this.seekCandidateWindowMs
      ) {
        candidate.count += 1;
        candidate.lastPerf = perfNow;
      } else {
        this.seekCandidate = { direction, count: 1, firstPerf: perfNow, lastPerf: perfNow };
      }
      seekDetected = this.seekCandidate.count >= 2;
    } else {
      this.seekCandidate = null;
    }

    if (seekDetected) {
      this.hardAnchor(safeSeconds, perfNow, safeState, safeSpeed);
      return {
        previous,
        previousEstimate,
        videoChanged,
        stateChanged,
        speedChanged,
        seekDetected: true,
        seekCandidate: false,
        hardAnchor: true,
        errorMs,
        correctionMs: 0
      };
    }

    let correctionMs = 0;
    if (absErrorMs > this.softDeadbandMs && absErrorMs < this.seekConfirmMs) {
      correctionMs = clamp(errorMs * this.softGain, -this.maxCorrectionMs, this.maxCorrectionMs);
    }

    this.anchorSeconds = Math.max(0, previousEstimate + correctionMs / 1000);
    this.anchorPerf = perfNow;
    this.playerState = safeState;
    this.playbackSpeed = safeSpeed;
    this.lastCorrectionMs = correctionMs;

    return {
      previous,
      previousEstimate,
      videoChanged,
      stateChanged,
      speedChanged,
      seekDetected: false,
      seekCandidate: Boolean(this.seekCandidate),
      hardAnchor: false,
      errorMs,
      correctionMs
    };
  }
}

export class BleOperationArbiter {
  constructor({ onMetrics = () => {}, onDropped = () => {}, onError = () => {}, onEvent = () => {} } = {}) {
    this.onMetrics = onMetrics;
    this.onDropped = onDropped;
    this.onError = onError;
    this.onEvent = onEvent;
    this.controlQueue = [];
    this.pendingStream = null;
    this.active = null;
    this.drainScheduled = false;
    this.sequence = 0;
    this.stats = {
      successful: 0,
      errors: 0,
      dropped: 0
    };
  }

  metrics() {
    return {
      ...this.stats,
      active: this.active ? 1 : 0,
      queueDepth: this.controlQueue.length + (this.pendingStream ? 1 : 0) + (this.active ? 1 : 0),
      activeLabel: this.active?.label || ''
    };
  }

  emitMetrics() {
    this.onMetrics(this.metrics());
  }

  makeItem(type, label, operation, metadata = {}) {
    let resolvePromise;
    let rejectPromise;
    const promise = new Promise((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    return {
      id: ++this.sequence,
      type,
      label,
      operation,
      metadata,
      resolve: resolvePromise,
      reject: rejectPromise,
      promise
    };
  }

  enqueueControl(label, operation, { clearPendingStream = false, metadata = {} } = {}) {
    if (clearPendingStream) this.clearPendingStream(`priorité ${label}`);
    const item = this.makeItem('control', label, operation, metadata);
    this.controlQueue.push(item);
    this.onEvent({ event: 'enqueue_control', id: item.id, label, metadata, metrics: this.metrics() });
    this.scheduleDrain();
    this.emitMetrics();
    return item.promise;
  }

  submitStream(label, operation, metadata = {}) {
    const item = this.makeItem('stream', label, operation, metadata);
    if (this.pendingStream) {
      const replaced = this.pendingStream;
      this.pendingStream = null;
      this.stats.dropped += 1;
      replaced.resolve({ status: 'dropped', reason: 'replaced' });
      this.onDropped(replaced, 'replaced');
      this.onEvent({ event: 'drop_stream', id: replaced.id, label: replaced.label, reason: 'replaced', metadata: replaced.metadata, metrics: this.metrics() });
    }
    this.pendingStream = item;
    this.onEvent({ event: 'enqueue_stream', id: item.id, label, metadata, metrics: this.metrics() });
    this.scheduleDrain();
    this.emitMetrics();
    return item.promise;
  }

  clearPendingStream(reason = 'cleared') {
    if (!this.pendingStream) return 0;
    const item = this.pendingStream;
    this.pendingStream = null;
    this.stats.dropped += 1;
    item.resolve({ status: 'dropped', reason });
    this.onDropped(item, reason);
    this.onEvent({ event: 'drop_stream', id: item.id, label: item.label, reason, metadata: item.metadata, metrics: this.metrics() });
    this.emitMetrics();
    return 1;
  }

  scheduleDrain() {
    if (this.drainScheduled || this.active) return;
    this.drainScheduled = true;
    queueMicrotask(() => {
      this.drainScheduled = false;
      this.drain();
    });
  }

  nextItem() {
    if (this.controlQueue.length > 0) return this.controlQueue.shift();
    if (!this.pendingStream) return null;
    const stream = this.pendingStream;
    this.pendingStream = null;
    return stream;
  }

  async drain() {
    if (this.active) return;
    const item = this.nextItem();
    if (!item) {
      this.emitMetrics();
      return;
    }

    this.active = item;
    this.onEvent({ event: 'operation_start', id: item.id, type: item.type, label: item.label, metadata: item.metadata, metrics: this.metrics() });
    this.emitMetrics();
    try {
      const result = await item.operation();
      this.stats.successful += 1;
      this.onEvent({ event: 'operation_success', id: item.id, type: item.type, label: item.label, metadata: item.metadata, metrics: this.metrics() });
      item.resolve({ status: 'ok', result });
    } catch (error) {
      this.stats.errors += 1;
      this.onEvent({ event: 'operation_error', id: item.id, type: item.type, label: item.label, metadata: item.metadata, error: error?.message || String(error), metrics: this.metrics() });
      item.reject(error);
      this.onError(error, item);
    } finally {
      this.active = null;
      this.emitMetrics();
      this.scheduleDrain();
    }
  }

  async waitForIdle(timeoutMs = 1000) {
    const started = Date.now();
    while (this.active || this.controlQueue.length > 0 || this.pendingStream) {
      if (Date.now() - started >= timeoutMs) return false;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return true;
  }

  reset(reason = 'reset') {
    this.clearPendingStream(reason);
    for (const item of this.controlQueue.splice(0)) {
      item.resolve({ status: 'dropped', reason });
      this.stats.dropped += 1;
      this.onDropped(item, reason);
    }
    this.onEvent({ event: 'arbiter_reset', reason, metrics: this.metrics() });
    this.emitMetrics();
  }
}

export function computeLatestDueCommand(actions, currentIndex, currentTimeMs, reverse = false) {
  let nextIndex = currentIndex;
  while (nextIndex < actions.length && actions[nextIndex].at <= currentTimeMs) nextIndex += 1;
  const dueCount = nextIndex - currentIndex;
  if (dueCount <= 0) return { nextIndex: currentIndex, command: null, skipped: 0 };

  const sourceIndex = nextIndex - 1;
  if (sourceIndex >= actions.length - 1) {
    return { nextIndex, command: null, skipped: Math.max(0, dueCount - 1) };
  }

  const source = actions[sourceIndex];
  const targetAction = actions[sourceIndex + 1];
  const duration = Number(targetAction.at) - Number(source.at);
  if (!Number.isFinite(duration) || duration <= 0) {
    return { nextIndex, command: null, skipped: dueCount };
  }

  const target = reverse ? 100 - Number(targetAction.pos) : Number(targetAction.pos);
  return {
    nextIndex,
    command: {
      sourceIndex,
      sourceAt: source.at,
      target: clamp(Math.round(target), 0, 100),
      duration: clamp(Math.round(duration), 1, 10000)
    },
    skipped: Math.max(0, dueCount - 1)
  };
}
