export class LockvetError extends Error {
  /**
   * @param {string} message
   * @param {string} code
   */
  constructor(message, code) {
    super(message);
    this.name = 'LockvetError';
    this.code = code;
  }
}
