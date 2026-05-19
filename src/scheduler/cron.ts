/**
 * Minimal cron next-run calculator.
 *
 * Supports:
 *   - Standard 5-field syntax: "minute hour day month weekday"
 *   - Aliases: @hourly @daily @midnight @weekly @monthly
 *   - Wildcards (*), comma lists (1,3,5), ranges (1-5), step values (* /15)
 *
 * Returns the next Date after `from` that matches the expression,
 * or null if no match is found within one year (invalid expression).
 */

type CronField = { values: Set<number> } | { step: number };

const ALIASES: Record<string, string> = {
  "@hourly":   "0 * * * *",
  "@daily":    "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@weekly":   "0 0 * * 0",
  "@monthly":  "0 0 1 * *",
};

function parseField(raw: string, min: number, max: number): Set<number> {
  const result = new Set<number>();

  for (const part of raw.split(",")) {
    if (part === "*") {
      for (let i = min; i <= max; i++) result.add(i);
    } else if (part.startsWith("*/")) {
      const step = parseInt(part.slice(2), 10);
      if (!Number.isFinite(step) || step < 1) throw new Error(`Invalid step: ${part}`);
      for (let i = min; i <= max; i += step) result.add(i);
    } else if (part.includes("-")) {
      const [a, b] = part.split("-").map(Number);
      if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error(`Invalid range: ${part}`);
      for (let i = a!; i <= b!; i++) result.add(i);
    } else {
      const v = parseInt(part, 10);
      if (!Number.isFinite(v)) throw new Error(`Invalid value: ${part}`);
      result.add(v);
    }
  }

  return result;
}

interface ParsedCron {
  minutes: Set<number>;
  hours: Set<number>;
  days: Set<number>;
  months: Set<number>;
  weekdays: Set<number>;
}

function parse(expr: string): ParsedCron {
  const resolved = ALIASES[expr.trim()] ?? expr.trim();
  const parts = resolved.split(/\s+/);
  if (parts.length !== 5) throw new Error(`Cron expression must have 5 fields: "${expr}"`);
  const [m, h, d, mo, wd] = parts;
  return {
    minutes:  parseField(m!,  0, 59),
    hours:    parseField(h!,  0, 23),
    days:     parseField(d!,  1, 31),
    months:   parseField(mo!, 1, 12),
    weekdays: parseField(wd!, 0,  6),
  };
}

/**
 * Returns the next Date after `from` that matches `cronExpr`,
 * or null if the expression is invalid or no match within 1 year.
 */
export function nextRun(cronExpr: string, from: Date = new Date()): Date | null {
  let parsed: ParsedCron;
  try {
    parsed = parse(cronExpr);
  } catch {
    return null;
  }

  // Start searching from the next whole minute after `from`.
  const candidate = new Date(from);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  const limit = new Date(from);
  limit.setFullYear(limit.getFullYear() + 1);

  while (candidate < limit) {
    const month   = candidate.getMonth() + 1; // 1-12
    const day     = candidate.getDate();       // 1-31
    const weekday = candidate.getDay();        // 0-6
    const hour    = candidate.getHours();
    const minute  = candidate.getMinutes();

    if (
      parsed.months.has(month) &&
      parsed.days.has(day) &&
      parsed.weekdays.has(weekday) &&
      parsed.hours.has(hour) &&
      parsed.minutes.has(minute)
    ) {
      return new Date(candidate);
    }

    candidate.setMinutes(candidate.getMinutes() + 1);
  }

  return null;
}

/** Validate a cron expression — returns error string or null if valid. */
export function validateCron(expr: string): string | null {
  try {
    parse(expr);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}
