'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { randomUUID } = require('crypto');

const DEFAULT_PART_LIMIT_BYTES = 10 * 1024 * 1024;
const DEFAULT_TOTAL_LIMIT_BYTES = 100 * 1024 * 1024;
const DEFAULT_CRITICAL_LIMIT_BYTES = 1 * 1024 * 1024;

function isCriticalEvent(event) {
  if (!event || typeof event !== 'object') return false;
  if (event.type === 'ui_log') return String(event.level || '').toUpperCase() === 'ERR';
  return [
    'operation_error',
    'stream_exception',
    'renderer_crash',
    'main_error',
    'unhandled_rejection'
  ].includes(event.type);
}

async function fileSize(filePath) {
  try {
    return (await fsp.stat(filePath)).size;
  } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw error;
  }
}

class DetailedSessionRecorder {
  constructor(rootDir, { appVersion, partLimitBytes }) {
    this.rootDir = rootDir;
    this.appVersion = appVersion;
    this.partLimitBytes = partLimitBytes;
    this.sessionId = randomUUID();
    this.startedAt = new Date();
    this.part = 0;
    this.partBytes = 0;
    this.filePath = '';
    this.stream = null;
    this.closed = false;
  }

  async start() {
    await this.openNextPart('session_start');
  }

  async openNextPart(headerType = 'session_continue') {
    if (this.stream) {
      await new Promise((resolve) => this.stream.end(resolve));
      this.stream = null;
    }
    this.part += 1;
    const stamp = this.startedAt.toISOString().replace(/[:.]/g, '-');
    this.filePath = path.join(
      this.rootDir,
      `session-${stamp}-${this.sessionId.slice(0, 8)}-part-${String(this.part).padStart(2, '0')}.jsonl`
    );
    this.stream = fs.createWriteStream(this.filePath, { flags: 'a', encoding: 'utf8' });
    await new Promise((resolve, reject) => {
      this.stream.once('open', resolve);
      this.stream.once('error', reject);
    });
    const header = {
      type: headerType,
      wallTime: new Date().toISOString(),
      sessionId: this.sessionId,
      schema: 2,
      appVersion: this.appVersion,
      part: this.part,
      platform: process.platform,
      arch: process.arch,
      node: process.version
    };
    const line = `${JSON.stringify(header)}\n`;
    await this.writeRaw(line);
  }

  async writeRaw(text) {
    if (!this.stream || this.closed) return;
    await new Promise((resolve, reject) => {
      this.stream.write(text, 'utf8', (error) => error ? reject(error) : resolve());
    });
    this.partBytes += Buffer.byteLength(text, 'utf8');
  }

  async appendBatch(events) {
    if (this.closed || !Array.isArray(events) || events.length === 0) return;
    const lines = `${events.map((event) => JSON.stringify(event)).join('\n')}\n`;
    const bytes = Buffer.byteLength(lines, 'utf8');
    if (this.partBytes > 0 && this.partBytes + bytes > this.partLimitBytes) {
      await this.openNextPart();
    }
    await this.writeRaw(lines);
  }

  async flush() {
    if (!this.stream || this.closed) return;
    await new Promise((resolve, reject) => {
      this.stream.write('', (error) => error ? reject(error) : resolve());
    });
  }

  async close() {
    if (this.closed) return;
    try {
      await this.appendBatch([{ type: 'session_end', wallTime: new Date().toISOString(), sessionId: this.sessionId }]);
      await this.flush();
    } finally {
      this.closed = true;
      if (this.stream) await new Promise((resolve) => this.stream.end(resolve));
      this.stream = null;
    }
  }

  info() {
    return {
      filePath: this.filePath,
      sessionId: this.sessionId,
      part: this.part
    };
  }
}

class DiagnosticLogManager {
  constructor(rootDir, {
    enabled = false,
    appVersion = '0.1.7-rc.1',
    partLimitBytes = DEFAULT_PART_LIMIT_BYTES,
    totalLimitBytes = DEFAULT_TOTAL_LIMIT_BYTES,
    criticalLimitBytes = DEFAULT_CRITICAL_LIMIT_BYTES
  } = {}) {
    this.rootDir = rootDir;
    this.enabled = Boolean(enabled);
    this.appVersion = appVersion;
    this.partLimitBytes = partLimitBytes;
    this.totalLimitBytes = totalLimitBytes;
    this.criticalLimitBytes = criticalLimitBytes;
    this.criticalFilePath = path.join(rootDir, 'critical-errors.jsonl');
    this.recorder = null;
    this.operationChain = Promise.resolve();
    this.readyPromise = this.initialize();
  }

  async initialize() {
    await fsp.mkdir(this.rootDir, { recursive: true });
    await this.enforceTotalLimit();
    if (this.enabled) await this.startRecorder();
  }

  enqueue(task) {
    const run = this.operationChain.then(task, task);
    this.operationChain = run.catch(() => {});
    return run;
  }

  async startRecorder() {
    if (this.recorder) return;
    this.recorder = new DetailedSessionRecorder(this.rootDir, {
      appVersion: this.appVersion,
      partLimitBytes: this.partLimitBytes
    });
    await this.recorder.start();
  }

  async stopRecorder() {
    if (!this.recorder) return;
    const current = this.recorder;
    this.recorder = null;
    await current.close();
  }

  async setEnabled(value) {
    await this.readyPromise;
    return this.enqueue(async () => {
      const next = Boolean(value);
      if (next === this.enabled) return this.statusUnlocked();
      this.enabled = next;
      if (next) await this.startRecorder();
      else await this.stopRecorder();
      await this.enforceTotalLimit();
      return this.statusUnlocked();
    });
  }

  async appendCritical(events) {
    if (!events.length) return;
    await fsp.mkdir(this.rootDir, { recursive: true });
    const lines = `${events.map((event) => JSON.stringify(event)).join('\n')}\n`;
    const currentSize = await fileSize(this.criticalFilePath);
    const incomingSize = Buffer.byteLength(lines, 'utf8');
    if (currentSize + incomingSize > this.criticalLimitBytes) {
      const oldPath = path.join(this.rootDir, 'critical-errors.old.jsonl');
      await fsp.rm(oldPath, { force: true });
      try {
        await fsp.rename(this.criticalFilePath, oldPath);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    await fsp.appendFile(this.criticalFilePath, lines, 'utf8');
  }

  async appendBatch(events) {
    await this.readyPromise;
    if (!Array.isArray(events) || events.length === 0) return;
    const safeEvents = events.filter((event) => event && typeof event === 'object').slice(0, 2000);
    return this.enqueue(async () => {
      const critical = safeEvents.filter(isCriticalEvent);
      if (critical.length) await this.appendCritical(critical);
      if (this.enabled) {
        await this.startRecorder();
        await this.recorder.appendBatch(safeEvents);
        if (this.recorder.part > 1 && this.recorder.partBytes < 100000) await this.enforceTotalLimit();
      }
    });
  }

  async flush() {
    await this.readyPromise;
    return this.enqueue(async () => {
      await this.recorder?.flush();
      return this.statusUnlocked();
    });
  }

  async listLogFiles() {
    await fsp.mkdir(this.rootDir, { recursive: true });
    const names = await fsp.readdir(this.rootDir);
    const items = [];
    for (const name of names) {
      if (!name.endsWith('.jsonl')) continue;
      const filePath = path.join(this.rootDir, name);
      try {
        const stat = await fsp.stat(filePath);
        if (stat.isFile()) items.push({ filePath, name, size: stat.size, mtimeMs: stat.mtimeMs });
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    return items;
  }

  async enforceTotalLimit() {
    const files = await this.listLogFiles();
    let total = files.reduce((sum, file) => sum + file.size, 0);
    const currentPath = this.recorder?.filePath || '';
    const deletable = files
      .filter((file) => file.name.startsWith('session-') && file.filePath !== currentPath)
      .sort((a, b) => a.mtimeMs - b.mtimeMs);
    for (const file of deletable) {
      if (total <= this.totalLimitBytes) break;
      await fsp.rm(file.filePath, { force: true });
      total -= file.size;
    }
    return total;
  }

  async directorySize() {
    const files = await this.listLogFiles();
    return files.reduce((sum, file) => sum + file.size, 0);
  }

  async statusUnlocked() {
    const recorderInfo = this.recorder?.info() || { filePath: '', sessionId: '', part: 0 };
    return {
      enabled: this.enabled,
      rootDir: this.rootDir,
      criticalFilePath: this.criticalFilePath,
      totalBytes: await this.directorySize(),
      totalLimitBytes: this.totalLimitBytes,
      partLimitBytes: this.partLimitBytes,
      ...recorderInfo
    };
  }

  async status() {
    await this.readyPromise;
    return this.enqueue(() => this.statusUnlocked());
  }

  async purge() {
    await this.readyPromise;
    return this.enqueue(async () => {
      const shouldRestart = this.enabled;
      await this.stopRecorder();
      const files = await this.listLogFiles();
      await Promise.all(files.map((file) => fsp.rm(file.filePath, { force: true })));
      if (shouldRestart) await this.startRecorder();
      return this.statusUnlocked();
    });
  }

  async close() {
    await this.readyPromise;
    return this.enqueue(async () => {
      await this.stopRecorder();
    });
  }
}

module.exports = {
  DiagnosticLogManager,
  isCriticalEvent,
  DEFAULT_PART_LIMIT_BYTES,
  DEFAULT_TOTAL_LIMIT_BYTES,
  DEFAULT_CRITICAL_LIMIT_BYTES
};
