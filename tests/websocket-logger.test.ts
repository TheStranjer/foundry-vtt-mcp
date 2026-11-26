import { WebSocketLogger } from "../src/websocket-logger.js";

type Handler = (error: Error) => void;

function makeStream() {
  const handlers: Handler[] = [];
  const writes: string[] = [];
  const stream = {
    write: jest.fn((chunk: string) => {
      writes.push(chunk);
      return true;
    }),
    end: jest.fn((chunk?: string) => {
      if (chunk !== undefined) writes.push(chunk);
    }),
    on: jest.fn((_event: "error", listener: Handler) => {
      handlers.push(listener);
    }),
  };
  return { stream, writes, emitError: (e: Error) => handlers.forEach((h) => h(e)) };
}

function build(overrides: Record<string, unknown> = {}) {
  const s = makeStream();
  const createWriteStream = jest.fn(() => s.stream);
  const errorLog = jest.fn();
  const fs = {
    existsSync: jest.fn(() => true),
    mkdirSync: jest.fn(),
  };
  const logger = new WebSocketLogger({
    fs,
    createWriteStream,
    path: { join: (...parts: string[]) => parts.join("/") },
    env: { WEBSOCKETS_DIRECTORY: "/tmp/ws" },
    nowFn: () => new Date("2020-01-01T00:00:00.000Z"),
    randomFn: () => 0.123456,
    logger: { error: errorLog },
    ...overrides,
  });
  return { logger, fs, createWriteStream, errorLog, ...s };
}

const HEADER_RE =
  /^=== WebSocket Session Started ===\nSession ID: .+\nTimestamp: 2020-01-01T00:00:00\.000Z\n={40}\n\n$/;

describe("WebSocketLogger", () => {
  test("nothing is written when WEBSOCKETS_DIRECTORY is unset", () => {
    const createWriteStream = jest.fn();
    const logger = new WebSocketLogger({
      env: {},
      createWriteStream,
      logger: { error: jest.fn() },
    });

    logger.logOutbound("out");
    logger.logInbound("in");
    logger.close();

    expect(logger.isEnabled()).toBe(false);
    expect(createWriteStream).not.toHaveBeenCalled();
  });

  test("creates directory and opens an append-mode stream with header", () => {
    const { logger, createWriteStream, writes } = build({
      fs: { existsSync: jest.fn(() => false), mkdirSync: jest.fn() },
    });

    expect(logger.isEnabled()).toBe(true);
    expect(createWriteStream).toHaveBeenCalledTimes(1);
    const [filePath, options] = createWriteStream.mock.calls[0] as unknown as [string, object];
    expect(filePath).toMatch(/^\/tmp\/ws\/ws_session_.+\.log$/);
    expect(options).toEqual({ flags: "a" });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatch(HEADER_RE);
  });

  test("mkdirSync called when directory missing", () => {
    const mkdirSync = jest.fn();
    build({ fs: { existsSync: jest.fn(() => false), mkdirSync } });
    expect(mkdirSync).toHaveBeenCalledWith("/tmp/ws", { recursive: true });
  });

  test("entries arrive in order with unchanged format", () => {
    const { logger, writes } = build();

    logger.logOutbound("out");
    logger.logInbound(Buffer.from("in"));
    logger.logOutbound("out2");

    expect(writes.slice(1)).toEqual([
      "[2020-01-01T00:00:00.000Z] >>> OUTBOUND >>>\nout\n\n",
      "[2020-01-01T00:00:00.000Z] <<< INBOUND <<<\nin\n\n",
      "[2020-01-01T00:00:00.000Z] >>> OUTBOUND >>>\nout2\n\n",
    ]);
  });

  test("close writes footer, ends the stream and disables", () => {
    const { logger, stream, writes } = build();

    logger.close();
    logger.logOutbound("late");
    logger.close();

    expect(logger.isEnabled()).toBe(false);
    expect(stream.end).toHaveBeenCalledTimes(1);
    expect(writes[writes.length - 1]).toBe(
      `\n${"=".repeat(40)}\n=== WebSocket Session Ended ===\nTimestamp: 2020-01-01T00:00:00.000Z\n`,
    );
    expect(writes).toHaveLength(2);
  });

  test("stream error disables logging, logs one line and does not throw", () => {
    const { logger, stream, errorLog, emitError } = build();
    errorLog.mockClear();

    expect(() => emitError(new Error("disk full"))).not.toThrow();
    expect(() => emitError(new Error("again"))).not.toThrow();
    expect(() => logger.logOutbound("x")).not.toThrow();
    expect(() => logger.close()).not.toThrow();

    expect(logger.isEnabled()).toBe(false);
    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(stream.write).toHaveBeenCalledTimes(1); // header only
    expect(stream.end).not.toHaveBeenCalled();
  });

  test("synchronous write failure disables logging without throwing", () => {
    const { logger, stream } = build();
    stream.write.mockImplementationOnce(() => {
      throw new Error("boom");
    });

    expect(() => logger.logInbound("x")).not.toThrow();
    expect(logger.isEnabled()).toBe(false);
  });

  test("initialize handles errors", () => {
    const createWriteStream = jest.fn();
    const logger = new WebSocketLogger({
      fs: {
        existsSync: jest.fn(() => false),
        mkdirSync: jest.fn(() => {
          throw new Error("fail");
        }),
      },
      createWriteStream,
      path: { join: (...parts: string[]) => parts.join("/") },
      env: { WEBSOCKETS_DIRECTORY: "/tmp/ws" },
      logger: { error: jest.fn() },
    });

    expect(logger.isEnabled()).toBe(false);
    expect(createWriteStream).not.toHaveBeenCalled();
  });

  test("createWriteStream throwing disables logging", () => {
    const { logger } = build({
      createWriteStream: () => {
        throw new Error("EACCES");
      },
    });
    expect(logger.isEnabled()).toBe(false);
  });
});
