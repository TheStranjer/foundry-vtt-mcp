// websocket-logger.ts
import * as fs from "fs";
import * as path from "path";

/**
 * WebSocket message logger that writes all inbound and outbound messages to a file.
 * Enabled via the WEBSOCKETS_DIRECTORY environment variable.
 * Each session creates a new log file with a timestamp-based name.
 * Logs are capped by file count (WEBSOCKETS_MAX_FILES) and by file size
 * (WEBSOCKETS_MAX_FILE_BYTES): a session that outgrows the size cap continues in
 * `_partN` files, and the oldest files beyond the count cap are deleted whenever
 * a new file is opened.
 * Writes go through an append-mode write stream: they are queued in order and
 * flushed immediately (no batching), so `tail -f` works without blocking the event loop.
 */
export interface LogStream {
  write(chunk: string): unknown;
  end(chunk?: string): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
}

export interface LogFs {
  existsSync: typeof fs.existsSync;
  mkdirSync: typeof fs.mkdirSync;
  readdirSync?: (dir: string) => string[];
  statSync?: (path: string) => { mtimeMs: number };
  unlinkSync?: (path: string) => void;
}

export const DEFAULT_MAX_FILES = 1000;
export const DEFAULT_MAX_FILE_BYTES = 10 * 1024 * 1024;

const LOG_FILE_RE = /^ws_session_.*\.log$/;
const FILE_TIMESTAMP_RE = /^ws_session_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)/;
const FILE_PART_RE = /_part(\d+)\.log$/;

/**
 * Parse a positive-integer setting. Missing, non-numeric or non-positive values
 * fall back to the default and produce one warning.
 */
export function parsePositiveInt(
  name: string,
  raw: string | undefined,
  fallback: number,
  warn: (message: string) => void,
): number {
  const text = raw?.trim();
  if (text && /^\d+$/.test(text)) {
    const value = Number(text);
    if (Number.isSafeInteger(value) && value > 0) return value;
  }
  const shown = raw === undefined || raw === "" ? "not set" : `invalid value "${raw}"`;
  warn(`[WebSocketLogger] ${name} ${shown}, using default ${fallback}`);
  return fallback;
}

interface LogFileInfo {
  name: string;
  stamp: string;
  part: number;
  mtimeMs: number;
}

/** Oldest first: file-name timestamp, then mtime, then part number, then name. */
function compareLogFiles(a: LogFileInfo, b: LogFileInfo): number {
  if (a.stamp !== b.stamp) return a.stamp < b.stamp ? -1 : 1;
  if (a.mtimeMs !== b.mtimeMs) return a.mtimeMs - b.mtimeMs;
  if (a.part !== b.part) return a.part - b.part;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

export type CreateWriteStream = (path: string, options: { flags: string }) => LogStream;

export class WebSocketLogger {
  private logFilePath: string | null = null;
  private enabled: boolean = false;
  private sessionId: string;
  private fs: LogFs;
  private wsDir: string | null = null;
  private maxFiles: number = DEFAULT_MAX_FILES;
  private maxFileBytes: number = DEFAULT_MAX_FILE_BYTES;
  private partNumber: number = 1;
  private currentBytes: number = 0;
  private currentEntries: number = 0;
  private createWriteStream: CreateWriteStream;
  private stream: LogStream | null = null;
  private path: Pick<typeof path, "join">;
  private env: NodeJS.ProcessEnv;
  private nowFn: () => Date;
  private randomFn: () => number;
  private logger: { error: (...args: unknown[]) => void };

  constructor(deps: {
    fs?: LogFs;
    createWriteStream?: CreateWriteStream;
    path?: Pick<typeof path, "join">;
    env?: NodeJS.ProcessEnv;
    nowFn?: () => Date;
    randomFn?: () => number;
    logger?: { error: (...args: unknown[]) => void };
  } = {}) {
    this.fs = deps.fs || fs;
    this.createWriteStream = deps.createWriteStream || fs.createWriteStream;
    this.path = deps.path || path;
    this.env = deps.env || process.env;
    this.nowFn = deps.nowFn || (() => new Date());
    this.randomFn = deps.randomFn || Math.random;
    this.logger = deps.logger || console;
    this.sessionId = this.generateSessionId();
    this.initialize();
  }

  /**
   * Generate a unique session ID using timestamp and random suffix
   */
  private generateSessionId(): string {
    const now = this.nowFn();
    const timestamp = now.toISOString().replace(/[:.]/g, "-");
    const random = this.randomFn().toString(36).substring(2, 8);
    return `${timestamp}_${random}`;
  }

  /**
   * Initialize the logger by checking for WEBSOCKETS_DIRECTORY env var
   */
  private initialize(): void {
    const wsDir = this.env.WEBSOCKETS_DIRECTORY;

    if (!wsDir) {
      this.logger.error("[WebSocketLogger] WEBSOCKETS_DIRECTORY not set, logging disabled");
      return;
    }

    try {
      // Ensure directory exists
      if (!this.fs.existsSync(wsDir)) {
        this.fs.mkdirSync(wsDir, { recursive: true });
        this.logger.error(`[WebSocketLogger] Created directory: ${wsDir}`);
      }

      const warn = (message: string) => this.logger.error(message);
      this.maxFiles = parsePositiveInt("WEBSOCKETS_MAX_FILES", this.env.WEBSOCKETS_MAX_FILES, DEFAULT_MAX_FILES, warn);
      this.maxFileBytes = parsePositiveInt(
        "WEBSOCKETS_MAX_FILE_BYTES",
        this.env.WEBSOCKETS_MAX_FILE_BYTES,
        DEFAULT_MAX_FILE_BYTES,
        warn,
      );
      this.wsDir = wsDir;

      const header = `=== WebSocket Session Started ===\nSession ID: ${this.sessionId}\nTimestamp: ${this.nowFn().toISOString()}\n${"=".repeat(40)}\n\n`;
      this.openFile(`ws_session_${this.sessionId}.log`, header);
      this.enabled = true;

      this.logger.error(`[WebSocketLogger] Logging to: ${this.logFilePath}`);
    } catch (error) {
      this.logger.error(`[WebSocketLogger] Failed to initialize: ${error}`);
      this.enabled = false;
      this.stream = null;
    }
  }

  /**
   * Open a new log file (session start or part), write its header, then prune
   * old files. The new file is never pruned.
   */
  private openFile(fileName: string, header: string): void {
    const filePath = this.path.join(this.wsDir as string, fileName);
    const stream = this.createWriteStream(filePath, { flags: "a" });
    stream.on("error", (error) => this.handleStreamError(error, stream));
    this.stream = stream;
    this.logFilePath = filePath;
    this.currentBytes = Buffer.byteLength(header);
    this.currentEntries = 0;
    stream.write(header);
    this.pruneOldFiles(fileName);
  }

  /**
   * Delete the oldest ws_session_*.log files so that at most maxFiles remain,
   * counting the active file. Failures are reported but never thrown.
   */
  private pruneOldFiles(activeFileName: string): void {
    const { readdirSync, statSync, unlinkSync } = this.fs;
    if (!readdirSync || !statSync || !unlinkSync || !this.wsDir) return;
    try {
      const files: LogFileInfo[] = [];
      for (const name of readdirSync(this.wsDir)) {
        if (name === activeFileName || !LOG_FILE_RE.test(name)) continue;
        let mtimeMs = 0;
        try {
          mtimeMs = statSync(this.path.join(this.wsDir, name)).mtimeMs;
        } catch {
          // File vanished or unreadable: treat as oldest by mtime.
        }
        files.push({
          name,
          stamp: FILE_TIMESTAMP_RE.exec(name)?.[1] ?? "",
          part: Number(FILE_PART_RE.exec(name)?.[1] ?? 1),
          mtimeMs,
        });
      }
      const excess = files.length + 1 - this.maxFiles;
      if (excess <= 0) return;
      files.sort(compareLogFiles);
      for (const file of files.slice(0, excess)) {
        try {
          unlinkSync(this.path.join(this.wsDir, file.name));
        } catch (error) {
          this.logger.error(`[WebSocketLogger] Failed to delete old log ${file.name}: ${error}`);
        }
      }
    } catch (error) {
      this.logger.error(`[WebSocketLogger] Failed to prune old logs: ${error}`);
    }
  }

  /**
   * Continue the session in the next part file.
   */
  private rollOver(): void {
    const previous = this.stream;
    this.partNumber += 1;
    const header = `=== WebSocket Session Continued ===\nSession ID: ${this.sessionId}\nPart: ${this.partNumber}\nTimestamp: ${this.nowFn().toISOString()}\n${"=".repeat(40)}\n\n`;
    this.stream = null;
    try {
      previous?.end();
    } catch (error) {
      this.logger.error(`[WebSocketLogger] Failed to close part file: ${error}`);
    }
    this.openFile(`ws_session_${this.sessionId}_part${this.partNumber}.log`, header);
  }

  /**
   * Disable logging after a stream failure. Never throws into socket handlers.
   */
  private handleStreamError(error: unknown, source?: LogStream): void {
    if (source && this.stream && source !== this.stream) {
      this.logger.error(`[WebSocketLogger] Write to a previous log file failed: ${error}`);
      return;
    }
    const wasEnabled = this.enabled;
    this.enabled = false;
    this.logFilePath = null;
    this.stream = null;
    if (wasEnabled) {
      this.logger.error(`[WebSocketLogger] Write failed, logging disabled: ${error}`);
    }
  }

  private writeEntry(entry: string): void {
    if (!this.stream) return;
    try {
      const bytes = Buffer.byteLength(entry);
      if (this.currentEntries > 0 && this.currentBytes + bytes > this.maxFileBytes) {
        this.rollOver();
      }
      this.stream?.write(entry);
      this.currentBytes += bytes;
      this.currentEntries += 1;
    } catch (error) {
      this.handleStreamError(error);
    }
  }

  /**
   * Log an outbound (sent) message
   */
  logOutbound(message: string | Buffer): void {
    if (!this.enabled || !this.logFilePath) return;

    const msgStr = message instanceof Buffer ? message.toString() : message;
    const timestamp = this.nowFn().toISOString();
    const entry = `[${timestamp}] >>> OUTBOUND >>>\n${msgStr}\n\n`;

    this.writeEntry(entry);
  }

  /**
   * Log an inbound (received) message
   */
  logInbound(message: string | Buffer): void {
    if (!this.enabled || !this.logFilePath) return;

    const msgStr = message instanceof Buffer ? message.toString() : message;
    const timestamp = this.nowFn().toISOString();
    const entry = `[${timestamp}] <<< INBOUND <<<\n${msgStr}\n\n`;

    this.writeEntry(entry);
  }

  /**
   * Check if logging is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Close the logger and write session footer
   */
  close(): void {
    if (this.enabled && this.logFilePath) {
      const footer = `\n${"=".repeat(40)}\n=== WebSocket Session Ended ===\nTimestamp: ${this.nowFn().toISOString()}\n`;
      const stream = this.stream;
      this.logFilePath = null;
      this.enabled = false;
      this.stream = null;
      try {
        stream?.end(footer);
      } catch (error) {
        this.logger.error(`[WebSocketLogger] Failed to close: ${error}`);
      }
    }
  }
}
