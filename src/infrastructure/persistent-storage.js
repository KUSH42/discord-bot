import { promises as fs } from 'fs';
import path from 'path';
import { toISOStringUTC } from '../utilities/utc-time.js';

/**
 * Persistent storage for content states, fingerprints, and system data.
 * Provides file-based storage with JSON serialization.
 */
export class PersistentStorage {
  constructor(logger, storageDir = 'data') {
    this.logger = logger;
    this.storageDir = storageDir;
    this.contentStatesFile = path.join(storageDir, 'content-states.json');
    this.fingerprintsFile = path.join(storageDir, 'fingerprints.json');
    this.seenUrlsFile = path.join(storageDir, 'seen-urls.json');

    this.ensureStorageDir();
  }

  async ensureStorageDir() {
    try {
      await fs.mkdir(this.storageDir, { recursive: true });
    } catch (error) {
      this.logger.error('Failed to create storage directory', {
        directory: this.storageDir,
        error: error.message,
      });
      throw error;
    }
  }

  async _readFile(filePath) {
    try {
      const data = await fs.readFile(filePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return {}; // File doesn't exist, return empty object
      }
      this.logger.error(`Failed to read or parse file: ${filePath}`, { error: error.message });
      throw error;
    }
  }

  async _writeFile(filePath, data) {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
  }

  // === Content State Management ===

  async storeContentState(contentId, state) {
    const allStates = await this.getAllContentStates();
    allStates[contentId] = state;
    await this._writeFile(this.contentStatesFile, allStates);
  }

  async getContentState(contentId) {
    const allStates = await this.getAllContentStates();
    return allStates[contentId] || null;
  }

  async getAllContentStates() {
    return this._readFile(this.contentStatesFile);
  }

  async removeContentStates(contentIds) {
    const allStates = await this.getAllContentStates();
    let changed = false;
    for (const id of contentIds) {
      if (allStates[id]) {
        delete allStates[id];
        changed = true;
      }
    }
    if (changed) {
      await this._writeFile(this.contentStatesFile, allStates);
    }
  }

  // === Fingerprint Management (for DuplicateDetector) ===

  async hasFingerprint(fingerprint) {
    const fingerprints = await this._readFile(this.fingerprintsFile);
    return Object.prototype.hasOwnProperty.call(fingerprints, fingerprint);
  }

  async storeFingerprint(fingerprint, metadata) {
    const fingerprints = await this._readFile(this.fingerprintsFile);
    fingerprints[fingerprint] = {
      ...metadata,
      seenAt: toISOStringUTC(),
    };
    await this._writeFile(this.fingerprintsFile, fingerprints);
  }

  // === URL Management (for DuplicateDetector fallback) ===

  async hasUrl(url) {
    const urls = await this._readFile(this.seenUrlsFile);
    return Object.prototype.hasOwnProperty.call(urls, url);
  }

  async addUrl(url) {
    const urls = await this._readFile(this.seenUrlsFile);
    if (!urls[url]) {
      urls[url] = { seenAt: toISOStringUTC() };
      await this._writeFile(this.seenUrlsFile, urls);
    }
  }
}
