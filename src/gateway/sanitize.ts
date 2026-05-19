/**
 * Error and output sanitizer for public-facing gateway responses.
 *
 * Strips file-system paths, API key patterns, and stack traces so internal
 * details never reach end users via Telegram or the A2A HTTP interface.
 */

// Matches common Unix/macOS absolute paths that may contain workspace info.
const PATH_RE = /(?:\/(?:Users|home|root|var|tmp|etc|opt|usr|private)\/[^\s,'"()[\]{}]+)/g;
// Matches tokens/keys: sk-xxx, Bearer xxx, or long hex/base64 strings after = or :.
const KEY_RE = /\b(?:sk[-_][A-Za-z0-9_\-]{8,}|Bearer\s+\S{8,}|(?:api[_-]?key|token|secret|password)\s*[=:]\s*\S{4,})/gi;
// Stack trace lines.
const STACK_RE = /\n\s+at\s+[^\n]+/g;
// Windows paths.
const WIN_PATH_RE = /[A-Za-z]:\\[^\s,'"()[\]{}]*/g;

const MAX_ERROR_LEN = 400;

export function sanitizeError(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : JSON.stringify(err);

  return raw
    .replace(STACK_RE, "")
    .replace(PATH_RE, "[path]")
    .replace(WIN_PATH_RE, "[path]")
    .replace(KEY_RE, "[redacted]")
    .trim()
    .slice(0, MAX_ERROR_LEN);
}

/** Cap user input length to prevent token-bombing the LLM. */
export const MAX_INPUT_CHARS = 8_000;

export function validateInput(text: string): { ok: true; text: string } | { ok: false; reason: string } {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, reason: "Empty message." };
  if (trimmed.length > MAX_INPUT_CHARS) {
    return {
      ok: false,
      reason: `Message too long (${trimmed.length} chars). Please keep it under ${MAX_INPUT_CHARS.toLocaleString()} characters.`,
    };
  }
  return { ok: true, text: trimmed };
}
