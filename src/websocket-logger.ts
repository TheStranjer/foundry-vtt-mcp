// websocket-logger.ts
import * as fs from "fs";
import * as path from "path";

/**
 * WebSocket message logger that writes all inbound and outbound messages to a file.
 * Enabled via the WEBSOCKETS_DIRECTORY environment variable.
 * Each session creates a new log file with a timestamp-based name.
 * Writes go through an append-mode write stream: they are queued in order and
 * flushed immediately (no batching), so `tail -f` works without blocking the event loop.
 */
export interface LogStream {
  write(chunk: string): unknown;
  end(chunk?: string): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
}

export type CreateWriteStream = (path: string, options: { flags: string }) => LogStream;

export class WebSocketLogger {
  private logFilePath: string | null = null;
  private enabled: boolean = false;
  private sessionId: string;
  private fs: Pick<typeof fs, "existsSync" | "mkdirSync">;
  private createWriteStream: CreateWriteStream;
  private stream: LogStream | null = null;
  private path: Pick<typeof path, "join">;
  private env: NodeJS.ProcessEnv;
  private nowFn: () => Date;
  private randomFn: () => number;
  private logger: { error: (...args: unknown[]) => void };

  constructor(deps: {
    fs?: Pick<typeof fs, "existsSync" | "mkdirSync">;
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

      // Create log file path
      const logFileName = `ws_session_${this.sessionId}.log`;
      this.logFilePath = this.path.join(wsDir, logFileName);

      const stream = this.createWriteStream(this.logFilePath, { flags: "a" });
      stream.on("error", (error) => this.handleStreamError(error));
      this.stream = stream;
      this.enabled = true;

      const header = `=== WebSocket Session Started ===\nSession ID: ${this.sessionId}\nTimestamp: ${this.nowFn().toISOString()}\n${"=".repeat(40)}\n\n`;
      stream.write(header);

      this.logger.error(`[WebSocketLogger] Logging to: ${this.logFilePath}`);
    } catch (error) {
      this.logger.error(`[WebSocketLogger] Failed to initialize: ${error}`);
      this.enabled = false;
      this.stream = null;
    }
  }

  /**
   * Disable logging after a stream failure. Never throws into socket handlers.
   */
  private handleStreamError(error: unknown): void {
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
      this.stream.write(entry);
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
