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

  constructor() {
    this.sessionId = this.generateSessionId();
    this.initialize();
  }

  /**
   * Generate a unique session ID using timestamp and random suffix
   */
  private generateSessionId(): string {
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, "-");
    const random = Math.random().toString(36).substring(2, 8);
    return `${timestamp}_${random}`;
  }

  /**
   * Initialize the logger by checking for WEBSOCKETS_DIRECTORY env var
   */
  private initialize(): void {
    const wsDir = process.env.WEBSOCKETS_DIRECTORY;

    if (!wsDir) {
      console.error("[WebSocketLogger] WEBSOCKETS_DIRECTORY not set, logging disabled");
      return;
    }

    try {
      // Ensure directory exists
      if (!fs.existsSync(wsDir)) {
        fs.mkdirSync(wsDir, { recursive: true });
        console.error(`[WebSocketLogger] Created directory: ${wsDir}`);
      }

      // Create log file path
      const logFileName = `ws_session_${this.sessionId}.log`;
      this.logFilePath = path.join(wsDir, logFileName);
      this.enabled = true;

      // Write session header (sync for immediate flush)
      const header = `=== WebSocket Session Started ===\nSession ID: ${this.sessionId}\nTimestamp: ${new Date().toISOString()}\n${"=".repeat(40)}\n\n`;
      fs.appendFileSync(this.logFilePath, header);

      console.error(`[WebSocketLogger] Logging to: ${this.logFilePath}`);
    } catch (error) {
      console.error(`[WebSocketLogger] Failed to initialize: ${error}`);
      this.enabled = false;
    }
  }

  /**
   * Log an outbound (sent) message
   */
  logOutbound(message: string | Buffer): void {
    if (!this.enabled || !this.logFilePath) return;

    const msgStr = message instanceof Buffer ? message.toString() : message;
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] >>> OUTBOUND >>>\n${msgStr}\n\n`;

    fs.appendFileSync(this.logFilePath, entry);
  }

  /**
   * Log an inbound (received) message
   */
  logInbound(message: string | Buffer): void {
    if (!this.enabled || !this.logFilePath) return;

    const msgStr = message instanceof Buffer ? message.toString() : message;
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] <<< INBOUND <<<\n${msgStr}\n\n`;

    fs.appendFileSync(this.logFilePath, entry);
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
      const footer = `\n${"=".repeat(40)}\n=== WebSocket Session Ended ===\nTimestamp: ${new Date().toISOString()}\n`;
      fs.appendFileSync(this.logFilePath, footer);
      this.logFilePath = null;
      this.enabled = false;
    }
  }
}
