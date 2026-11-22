import { LockvetError } from './errors.js';

const DEFAULT_MAX_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB

/**
 * Parse and validate npm lockfile content.
 * Accepts a raw JSON string or an already parsed object.
 *
 * @param {string | object} input
 * @param {object} [options]
 * @param {number} [options.maxSizeBytes]
 * @returns {object} Validated lockfile object
 */
export function parseLockfile(input, options = {}) {
  const maxBytes = options.maxSizeBytes ?? DEFAULT_MAX_SIZE_BYTES;
  let parsed;

  if (typeof input === 'string') {
    const byteLength = Buffer.byteLength(input, 'utf8');
    if (byteLength > maxBytes) {
      throw new LockvetError(
        `Lockfile size (${byteLength} bytes) exceeds limit of ${maxBytes} bytes`,
        'ERR_INPUT_TOO_LARGE'
      );
    }
    try {
      parsed = JSON.parse(input);
    } catch (err) {
      throw new LockvetError(
        `Failed to parse lockfile as JSON: ${err.message}`,
        'ERR_INVALID_JSON'
      );
    }
  } else if (input !== null && typeof input === 'object') {
    parsed = input;
  } else {
    throw new LockvetError(
      'Lockfile input must be a JSON string or an object',
      'ERR_INVALID_LOCKFILE'
    );
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new LockvetError(
      'Invalid lockfile structure: root must be a JSON object',
      'ERR_INVALID_LOCKFILE'
    );
  }

  if (parsed.lockfileVersion === 1) {
    throw new LockvetError(
      'unsupported lockfile version 1, regenerate with npm >= 7',
      'ERR_UNSUPPORTED_VERSION'
    );
  }

  if (parsed.lockfileVersion !== 2 && parsed.lockfileVersion !== 3) {
    throw new LockvetError(
      `Unsupported lockfileVersion: ${parsed.lockfileVersion}. Supported versions are 2 and 3.`,
      'ERR_UNSUPPORTED_VERSION'
    );
  }

  if (!parsed.packages || typeof parsed.packages !== 'object' || Array.isArray(parsed.packages)) {
    throw new LockvetError(
      'Invalid lockfile structure: missing "packages" object',
      'ERR_INVALID_LOCKFILE'
    );
  }

  return parsed;
}
