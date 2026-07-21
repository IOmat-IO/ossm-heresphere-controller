'use strict';

const net = require('net');
const os = require('os');

const DEFAULT_HERESPHERE_PORT = 23554;

function isPrivateIpv4(address) {
  const parts = String(address || '').split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  if (parts[0] === 10) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  return false;
}

function localSubnetCandidates() {
  const results = [];
  const seen = new Set();
  const interfaces = os.networkInterfaces();

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (entry.internal || entry.family !== 'IPv4' || !isPrivateIpv4(entry.address)) continue;
      const parts = entry.address.split('.');
      const prefix = parts.slice(0, 3).join('.');
      for (let host = 1; host <= 254; host += 1) {
        const candidate = `${prefix}.${host}`;
        if (candidate === entry.address || seen.has(candidate)) continue;
        seen.add(candidate);
        results.push(candidate);
      }
    }
  }

  return results;
}

function probeTcp(host, port = DEFAULT_HERESPHERE_PORT, timeoutMs = 180) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (open) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(open);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

async function firstOpenHost(hosts, port, { concurrency = 48, timeoutMs = 180 } = {}) {
  let nextIndex = 0;
  let found = null;

  async function worker() {
    while (!found) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= hosts.length) return;
      const host = hosts[index];
      if (await probeTcp(host, port, timeoutMs)) {
        found = host;
        return;
      }
    }
  }

  const count = Math.min(concurrency, hosts.length);
  await Promise.all(Array.from({ length: count }, () => worker()));
  return found;
}

async function discoverHereSphere({ preferredHost = '', port = DEFAULT_HERESPHERE_PORT } = {}) {
  const priority = [];
  const add = (host) => {
    const value = String(host || '').trim();
    if (value && !priority.includes(value)) priority.push(value);
  };

  add(preferredHost);
  add('127.0.0.1');

  for (const host of priority) {
    if (await probeTcp(host, port, 350)) return { host, port, source: host === preferredHost ? 'preferred' : 'localhost' };
  }

  const host = await firstOpenHost(localSubnetCandidates(), port);
  return host ? { host, port, source: 'network-scan' } : null;
}

module.exports = {
  DEFAULT_HERESPHERE_PORT,
  discoverHereSphere,
  isPrivateIpv4,
  localSubnetCandidates,
  probeTcp
};
