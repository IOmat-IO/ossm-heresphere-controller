'use strict';

const fs = require('fs/promises');
const path = require('path');

class SettingsStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.cache = null;
  }

  async readAll() {
    if (this.cache) return { ...this.cache };
    try {
      const content = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(content);
      this.cache = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.cache = {};
    }
    return { ...this.cache };
  }

  async get(key, fallback = null) {
    const settings = await this.readAll();
    return Object.prototype.hasOwnProperty.call(settings, key) ? settings[key] : fallback;
  }

  async set(key, value) {
    const settings = await this.readAll();
    settings[key] = value;
    await this.writeAll(settings);
    return value;
  }

  async writeAll(settings) {
    const directory = path.dirname(this.filePath);
    const temporary = `${this.filePath}.tmp`;
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
    try {
      await fs.rename(temporary, this.filePath);
    } catch (error) {
      if (!['EEXIST', 'EPERM'].includes(error.code)) throw error;
      await fs.rm(this.filePath, { force: true });
      await fs.rename(temporary, this.filePath);
    }
    this.cache = { ...settings };
  }
}

module.exports = { SettingsStore };
