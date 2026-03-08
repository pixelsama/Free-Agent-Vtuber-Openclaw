const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const MIME_EXTENSION_MAP = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};

const MAX_CAPTURE_SIZE_BYTES = 5 * 1024 * 1024;
const CAPTURE_TTL_MS = 30 * 60 * 1000;

function normalizeMimeType(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().toLowerCase();
}

function parseDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') {
    throw new Error('capture_data_required');
  }

  const trimmed = dataUrl.trim();
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([a-z0-9+/=\s]+)$/i.exec(trimmed);
  if (!match) {
    throw new Error('capture_data_invalid');
  }

  const mimeType = normalizeMimeType(match[1]);
  const buffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
  if (!buffer.length) {
    throw new Error('capture_data_invalid');
  }

  return { mimeType, buffer };
}

class ScreenshotCaptureService {
  constructor(app) {
    this.app = app;
    this.captureDir = '';
    this.captureMap = new Map();
    this.hiddenWindowState = null;
  }

  async init() {
    this.captureDir = path.join(this.app.getPath('userData'), 'screen-captures');
    await fs.mkdir(this.captureDir, { recursive: true });
    await this.cleanupExpired();
  }

  async beginWindowCapture(window) {
    if (!window || window.isDestroyed()) {
      return { ok: false, reason: 'window_unavailable' };
    }

    if (this.hiddenWindowState) {
      return { ok: true };
    }

    this.hiddenWindowState = {
      wasVisible: window.isVisible(),
    };
    window.hide();
    return { ok: true };
  }

  async finishWindowCapture(window) {
    if (!window || window.isDestroyed()) {
      this.hiddenWindowState = null;
      return { ok: false, reason: 'window_unavailable' };
    }

    const state = this.hiddenWindowState;
    this.hiddenWindowState = null;
    if (!state?.wasVisible) {
      return { ok: true };
    }

    if (typeof window.showInactive === 'function') {
      window.showInactive();
    } else {
      window.show();
    }

    return { ok: true };
  }

  async saveCapture({ dataUrl, name = '' } = {}) {
    const { mimeType, buffer } = parseDataUrl(dataUrl);
    if (buffer.byteLength > MAX_CAPTURE_SIZE_BYTES) {
      throw new Error('capture_too_large');
    }

    const extension = MIME_EXTENSION_MAP[mimeType];
    if (!extension) {
      throw new Error('capture_type_unsupported');
    }

    const captureId = `capture_${randomUUID()}`;
    const fileName = `${captureId}${extension}`;
    const filePath = path.join(this.captureDir, fileName);

    await fs.writeFile(filePath, buffer);

    const record = {
      captureId,
      filePath,
      mimeType,
      name: typeof name === 'string' && name.trim() ? name.trim() : fileName,
      size: buffer.byteLength,
      createdAt: Date.now(),
    };
    this.captureMap.set(captureId, record);

    return {
      ok: true,
      captureId,
      mimeType: record.mimeType,
      name: record.name,
      size: record.size,
    };
  }

  resolveCapture(captureId) {
    const normalized = typeof captureId === 'string' ? captureId.trim() : '';
    if (!normalized) {
      return null;
    }

    const record = this.captureMap.get(normalized);
    if (!record) {
      return null;
    }

    return { ...record };
  }

  async releaseCapture(captureId) {
    const record = this.resolveCapture(captureId);
    if (!record) {
      return { ok: false, reason: 'capture_not_found' };
    }

    this.captureMap.delete(record.captureId);
    try {
      await fs.unlink(record.filePath);
    } catch {
      // Ignore missing temp files.
    }

    return { ok: true };
  }

  async cleanupExpired(now = Date.now()) {
    const releaseTasks = [];
    for (const record of this.captureMap.values()) {
      if (now - record.createdAt > CAPTURE_TTL_MS) {
        releaseTasks.push(this.releaseCapture(record.captureId));
      }
    }

    try {
      const entries = await fs.readdir(this.captureDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) {
          continue;
        }

        const filePath = path.join(this.captureDir, entry.name);
        try {
          const stat = await fs.stat(filePath);
          if (now - stat.mtimeMs > CAPTURE_TTL_MS) {
            releaseTasks.push(fs.unlink(filePath));
          }
        } catch {
          // Ignore temp files that disappear during cleanup.
        }
      }
    } catch {
      // Ignore directory read failures; temp cleanup is best-effort.
    }

    await Promise.allSettled(releaseTasks);
  }
}

module.exports = {
  ScreenshotCaptureService,
  MAX_CAPTURE_SIZE_BYTES,
};
