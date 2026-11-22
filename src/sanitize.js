/* eslint-disable no-control-regex */
const ANSI_PATTERN = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
// Strip ASCII control characters except newline and tab, plus DEL and C1 control characters
const CONTROL_PATTERN = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g;

/**
 * Remove ANSI escape sequences and non-printable control characters from input string.
 * @param {unknown} value
 * @returns {string}
 */
export function sanitizeString(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.replace(ANSI_PATTERN, '').replace(CONTROL_PATTERN, '');
}

/**
 * Escape Markdown special characters for safe inclusion in tables and text.
 * @param {string} text
 * @returns {string}
 */
export function escapeMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/`/g, '\\`')
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
