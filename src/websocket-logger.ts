// websocket-logger.ts
import * as fs from "fs";
import * as path from "path";

/**
 * WebSocket message logger that writes all inbound and outbound messages to a file.
 * Enabled via the WEBSOCKETS_DIRECTORY environment variable.
 * Each session creates a new log file with a timestamp-based name.
 * Uses synchronous writes to ensure immediate flushing for `tail -f` compatibility.
 */
export class WebSocketLogger {
  private logFilePath: string | null = null;
  private enabled: boolean = false;
  private sessionId: string;
  private fs: Pick<typeof fs, "existsSync" | "mkdirSync" | "appendFileSync">;
  private path: Pick<typeof path, "join">;
  private env: NodeJS.ProcessEnv;
  private nowFn: () => Date;
  private randomFn: () => number;
  private logger: { error: (...args: unknown[]) => void };

  constructor(deps: {
    fs?: Pick<typeof fs, "existsSync" | "mkdirSync" | "appendFileSync">;
    path?: Pick<typeof path, "join">;
    env?: NodeJS.ProcessEnv;
    nowFn?: () => Date;
    randomFn?: () => number;
    logger?: { error: (...args: unknown[]) => void };
  } = {}) {
    this.fs = deps.fs || fs;
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
      this.enabled = true;

      // Write session header (sync for immediate flush)
      const header = `=== WebSocket Session Started ===\nSession ID: ${this.sessionId}\nTimestamp: ${this.nowFn().toISOString()}\n${"=".repeat(40)}\n\n`;
      this.fs.appendFileSync(this.logFilePath, header);

      this.logger.error(`[WebSocketLogger] Logging to: ${this.logFilePath}`);
    } catch (error) {
      this.logger.error(`[WebSocketLogger] Failed to initialize: ${error}`);
      this.enabled = false;
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

    this.fs.appendFileSync(this.logFilePath, entry);
  }

  /**
   * Log an inbound (received) message
   */
  logInbound(message: string | Buffer): void {
    if (!this.enabled || !this.logFilePath) return;

    const msgStr = message instanceof Buffer ? message.toString() : message;
    const timestamp = this.nowFn().toISOString();
    const entry = `[${timestamp}] <<< INBOUND <<<\n${msgStr}\n\n`;

    this.fs.appendFileSync(this.logFilePath, entry);
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
      this.fs.appendFileSync(this.logFilePath, footer);
      this.logFilePath = null;
      this.enabled = false;
    }
  }
}
