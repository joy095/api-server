/**
 * Structured Logger
 *
 * - Outputs JSON in production, coloured human-readable in development
 * - Persists all entries to disk, rotated daily (Node.js only)
 * - Errors are appended synchronously so they survive process crashes
 *
 * File layout:
 *   logs/
 *     app-2024-01-15.log    ← all levels
 *     error-2024-01-15.log  ← errors only (fast triage)
 *
 * Set LOG_DIR env var to override the default ./logs directory.
 */

import { env } from "../env";

// ─── Types ────────────────────────────────────────────────────────────────────

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  level: LogLevel;
  msg: string;
  ts: string;
  requestId?: string;
  [key: string]: unknown;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const MIN_LEVEL: LogLevel = env.NODE_ENV === "production" ? "info" : "debug";

// ─── File writer (Node-only, guarded for Cloudflare Workers) ──────────────────

let _logDir: string | null | undefined = undefined; // undefined = not yet resolved

function getLogDir(): string | null {
  if (_logDir !== undefined) return _logDir;
  if (typeof process === "undefined" || !process.env) return (_logDir = null);

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("path") as typeof import("path");
    _logDir = process.env.LOG_DIR
      ? path.resolve(process.env.LOG_DIR)
      : path.resolve(process.cwd(), "logs");
    return _logDir;
  } catch {
    return (_logDir = null);
  }
}

function ensureLogDir(dir: string): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("fs") as typeof import("fs");
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } catch {
    // Cannot create dir — fall back to console only
  }
}

interface LogFilePaths {
  app: string;
  error: string;
}

function getLogFilePaths(): LogFilePaths | null {
  const dir = getLogDir();
  if (!dir) return null;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("path") as typeof import("path");
    const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    ensureLogDir(dir);
    return {
      app: path.join(dir, `app-${date}.log`),
      error: path.join(dir, `error-${date}.log`),
    };
  } catch {
    return null;
  }
}

/** Synchronous append so errors are never lost on crash. */
function appendToFile(filePath: string, line: string): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("fs") as typeof import("fs");
    fs.appendFileSync(filePath, line + "\n", { encoding: "utf8" });
  } catch {
    // Silently swallow — we already printed to console
  }
}

// ─── Core log function ────────────────────────────────────────────────────────

function log(level: LogLevel, msg: string, meta?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[MIN_LEVEL]) return;

  const entry: LogEntry = {
    level,
    msg,
    ts: new Date().toISOString(),
    ...(meta ?? {}),
  };

  const jsonLine = JSON.stringify(entry);

  // ── Console ─────────────────────────────────────────────────────────────────
  if (env.NODE_ENV === "production") {
    if (level === "error") console.error(jsonLine);
    else if (level === "warn") console.warn(jsonLine);
    else console.log(jsonLine);
  } else {
    const COLOR: Record<LogLevel, string> = {
      debug: "\x1b[37m",
      info:  "\x1b[36m",
      warn:  "\x1b[33m",
      error: "\x1b[31m",
    };
    const RESET = "\x1b[0m";
    const metaStr =
      meta && Object.keys(meta).length
        ? "  " + JSON.stringify(meta)
        : "";
    const line = `[${entry.ts}] ${COLOR[level]}${level.toUpperCase().padEnd(5)}${RESET} ${msg}${metaStr}`;
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  }

  // ── File ────────────────────────────────────────────────────────────────────
  const paths = getLogFilePaths();
  if (!paths) return;

  appendToFile(paths.app, jsonLine);            // every level → app log
  if (level === "error") {
    appendToFile(paths.error, jsonLine);         // errors only → error log
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => log("debug", msg, meta),
  info:  (msg: string, meta?: Record<string, unknown>) => log("info",  msg, meta),
  warn:  (msg: string, meta?: Record<string, unknown>) => log("warn",  msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => log("error", msg, meta),
};
