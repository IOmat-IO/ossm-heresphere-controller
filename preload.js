'use strict';

const net = require('net');

const MAX_FRAME_BYTES = 1024 * 1024;

function isJsonStart(byte) {
  return byte === 0x7b || byte === 0x5b; // { or [
}

function findJsonEnd(buffer, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < buffer.length; index += 1) {
    const byte = buffer[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (byte === 0x5c) {
        escaped = true;
      } else if (byte === 0x22) {
        inString = false;
      }
      continue;
    }

    if (byte === 0x22) {
      inString = true;
      continue;
    }

    if (byte === 0x7b || byte === 0x5b) depth += 1;
    if (byte === 0x7d || byte === 0x5d) depth -= 1;
    if (depth === 0) return index + 1;
  }

  return -1;
}

function tryParseJson(buffer) {
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch {
    return null;
  }
}

class HereSphereFrameParser {
  constructor() {
    this.buffer = Buffer.alloc(0);
  }

  reset() {
    this.buffer = Buffer.alloc(0);
  }

  push(chunk) {
    if (!Buffer.isBuffer(chunk)) chunk = Buffer.from(chunk);
    this.buffer = Buffer.concat([this.buffer, chunk]);

    const messages = [];
    let guard = 0;

    while (this.buffer.length > 0 && guard < 1000) {
      guard += 1;
      const parsed = this.extractOne();
      if (!parsed) break;
      messages.push(parsed);
    }

    if (this.buffer.length > MAX_FRAME_BYTES) {
      this.buffer = Buffer.alloc(0);
      throw new Error('Flux HereSphere illisible : tampon supérieur à 1 Mio.');
    }

    return messages;
  }

  extractOne() {
    if (this.buffer.length === 0) return null;

    // Compatibilité avec un flux JSON sans préfixe.
    if (isJsonStart(this.buffer[0])) {
      const end = findJsonEnd(this.buffer, 0);
      if (end < 0) return null;
      const payload = this.buffer.subarray(0, end);
      const value = tryParseJson(payload);
      if (value === null) {
        this.buffer = this.buffer.subarray(1);
        return null;
      }
      this.buffer = this.buffer.subarray(end);
      return value;
    }

    if (this.buffer.length < 5) return null;

    // HereSphere est observé avec un en-tête de quatre octets avant le JSON.
    // Les deux endiannesses sont acceptées pour ne pas dépendre d'une hypothèse non documentée.
    const lengths = [this.buffer.readUInt32LE(0), this.buffer.readUInt32BE(0)]
      .filter((value, index, array) => value > 0 && value <= MAX_FRAME_BYTES && array.indexOf(value) === index);

    for (const length of lengths) {
      if (this.buffer.length < 4 + length) continue;
      const payload = this.buffer.subarray(4, 4 + length);
      if (!isJsonStart(payload[0])) continue;
      const value = tryParseJson(payload);
      if (value === null) continue;
      this.buffer = this.buffer.subarray(4 + length);
      return value;
    }

    // Repli compatible avec l'implémentation ABHS : ignorer quatre octets,
    // puis extraire un objet JSON complet. Cela gère aussi la fragmentation TCP.
    const jsonStart = this.buffer.indexOf(0x7b, 1);
    const arrayStart = this.buffer.indexOf(0x5b, 1);
    let start = -1;
    if (jsonStart >= 0 && arrayStart >= 0) start = Math.min(jsonStart, arrayStart);
    else start = Math.max(jsonStart, arrayStart);

    if (start >= 0 && start <= 8) {
      const end = findJsonEnd(this.buffer, start);
      if (end < 0) return null;
      const payload = this.buffer.subarray(start, end);
      const value = tryParseJson(payload);
      if (value !== null) {
        this.buffer = this.buffer.subarray(end);
        return value;
      }
    }

    // Attendre davantage de données si un préfixe de longueur plausible annonce une trame incomplète.
    if (lengths.some((length) => this.buffer.length < 4 + length)) return null;

    // Octet parasite : avancer d'un octet pour retrouver la prochaine trame.
    this.buffer = this.buffer.subarray(1);
    return null;
  }
}

class HereSphereClient {
  constructor({ onStatus, onTimestamp, onLog }) {
    this.onStatus = onStatus;
    this.onTimestamp = onTimestamp;
    this.onLog = onLog;
    this.socket = null;
    this.host = '';
    this.port = 0;
    this.parser = new HereSphereFrameParser();
  }

  connect(host, port) {
    this.disconnect();
    this.host = host;
    this.port = port;
    this.parser.reset();

    const socket = new net.Socket();
    this.socket = socket;
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 2000);

    this.onStatus?.({ state: 'connecting', message: `Connexion à ${host}:${port}`, host, port });

    socket.on('connect', () => {
      this.onLog?.(`HereSphere TCP connecté à ${host}:${port}`);
      this.onStatus?.({ state: 'connected', message: `Connecté à ${host}:${port}`, host, port });
    });

    socket.on('data', (chunk) => {
      try {
        for (const timestamp of this.parser.push(chunk)) {
          if (timestamp && typeof timestamp === 'object') this.onTimestamp?.(timestamp);
        }
      } catch (error) {
        this.onLog?.(`Erreur de trame HereSphere : ${error.message}`);
        this.onStatus?.({ state: 'error', message: error.message });
      }
    });

    socket.on('error', (error) => {
      this.onLog?.(`Erreur HereSphere TCP : ${error.code || error.message}`);
      this.onStatus?.({ state: 'error', message: error.code || error.message, host, port });
    });

    socket.on('close', () => {
      if (this.socket === socket) this.socket = null;
      this.onLog?.('Connexion HereSphere fermée.');
      this.onStatus?.({ state: 'disconnected', message: 'Déconnecté', host, port });
    });

    socket.connect(port, host);
  }

  disconnect() {
    if (!this.socket) return;
    const socket = this.socket;
    this.socket = null;
    socket.removeAllListeners('close');
    socket.destroy();
    this.onStatus?.({ state: 'disconnected', message: 'Déconnecté' });
  }
}

module.exports = {
  HereSphereClient,
  HereSphereFrameParser,
  findJsonEnd
};
