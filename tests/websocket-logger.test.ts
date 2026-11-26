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

describe("WebSocketLogger rotation", () => {
  const ts = (n: number) => `2020-01-${String(n).padStart(2, "0")}T00-00-00-000Z`;

  function rotating(opts: {
    env?: Record<string, string>;
    files?: Record<string, number>;
  } = {}) {
    const files = { ...(opts.files ?? {}) };
    const streams: { path: string; writes: string[]; end: jest.Mock }[] = [];
    const createWriteStream = jest.fn((p: string) => {
      const writes: string[] = [];
      const entry = {
        path: p,
        writes,
        end: jest.fn((chunk?: string) => {
          if (chunk !== undefined) writes.push(chunk);
        }),
      };
      streams.push(entry);
      return { write: (c: string) => writes.push(c), end: entry.end, on: jest.fn() };
    });
    const unlinkSync = jest.fn((p: string) => {
      delete files[p.split("/").pop() as string];
    });
    const errorLog = jest.fn();
    const logger = new WebSocketLogger({
      fs: {
        existsSync: () => true,
        mkdirSync: jest.fn(),
        readdirSync: () => Object.keys(files),
        statSync: (p: string) => ({ mtimeMs: files[p.split("/").pop() as string] ?? 0 }),
        unlinkSync,
      },
      createWriteStream,
      path: { join: (...parts: string[]) => parts.join("/") },
      env: { WEBSOCKETS_DIRECTORY: "/tmp/ws", ...opts.env },
      nowFn: () => new Date("2020-01-01T00:00:00.000Z"),
      randomFn: () => 0.123456,
      logger: { error: errorLog },
    });
    return { logger, streams, unlinkSync, errorLog, files };
  }

  const deleted = (unlinkSync: jest.Mock) =>
    unlinkSync.mock.calls.map((c) => (c[0] as string).split("/").pop()).sort();

  test("pruning keeps the newest N and ignores unrelated files", () => {
    const { unlinkSync } = rotating({
      env: { WEBSOCKETS_MAX_FILES: "3" },
      files: {
        [`ws_session_${ts(5)}_a.log`]: 5,
        [`ws_session_${ts(2)}_b.log`]: 9,
        [`ws_session_${ts(4)}_c.log`]: 1,
        [`ws_session_${ts(3)}_d.log`]: 2,
        "notes.txt": 0,
        "ws_session_other.txt": 0,
      },
    });
    // active file + 2 newest kept: days 5 and 4
    expect(deleted(unlinkSync)).toEqual([`ws_session_${ts(2)}_b.log`, `ws_session_${ts(3)}_d.log`]);
  });

  test("mtime breaks ties on equal timestamps and parts count toward the limit", () => {
    const { unlinkSync } = rotating({
      env: { WEBSOCKETS_MAX_FILES: "2" },
      files: {
        [`ws_session_${ts(2)}_x_part2.log`]: 20,
        [`ws_session_${ts(2)}_x.log`]: 10,
      },
    });
    expect(deleted(unlinkSync)).toEqual([`ws_session_${ts(2)}_x.log`]);
  });

  test("the active file is never pruned", () => {
    const { unlinkSync, logger } = rotating({
      env: { WEBSOCKETS_MAX_FILES: "1" },
      files: { [`ws_session_${ts(9)}_old.log`]: 1 },
    });
    expect(logger.isEnabled()).toBe(true);
    expect(deleted(unlinkSync)).toEqual([`ws_session_${ts(9)}_old.log`]);
    expect(unlinkSync.mock.calls.every((c) => !(c[0] as string).includes("2020-01-01T00-00-00-000Z"))).toBe(true);
  });

  test("rolls over to _part2 at the cap with a part header", () => {
    const { logger, streams } = rotating({ env: { WEBSOCKETS_MAX_FILE_BYTES: "300" } });
    const entry = (n: number) => `[2020-01-01T00:00:00.000Z] >>> OUTBOUND >>>\n${"x".repeat(n)}\n\n`;
    logger.logOutbound("x".repeat(100));
    expect(streams).toHaveLength(1);
    logger.logOutbound("y".repeat(150));
    expect(streams).toHaveLength(2);
    expect(streams[1].path).toMatch(/\/ws_session_.+_part2\.log$/);
    expect(streams[1].writes[0]).toMatch(/Session ID: .+\nPart: 2\n/);
    expect(streams[1].writes[1]).toBe(entry(150).replace(/x/g, "y"));
    expect(streams[0].end).toHaveBeenCalledTimes(1);
    logger.logOutbound("z".repeat(150));
    expect(streams[2].path).toMatch(/_part3\.log$/);
  });

  test("an oversized single entry gets its own part and is written whole", () => {
    const { logger, streams } = rotating({ env: { WEBSOCKETS_MAX_FILE_BYTES: "300" } });
    logger.logOutbound("a");
    const big = "B".repeat(5000);
    logger.logInbound(big);
    logger.logOutbound("c");

    expect(streams).toHaveLength(3);
    expect(streams[1].writes).toHaveLength(2);
    expect(streams[1].writes[1]).toContain(big);
    expect(streams[2].writes[1]).toContain("\nc\n");
  });

  test("rollover prunes and keeps the new part", () => {
    const { logger, unlinkSync } = rotating({
      env: { WEBSOCKETS_MAX_FILES: "2", WEBSOCKETS_MAX_FILE_BYTES: "300" },
      files: { [`ws_session_${ts(1)}_old.log`]: 1 },
    });
    unlinkSync.mockClear();
    logger.logOutbound("a".repeat(100));
    logger.logOutbound("b".repeat(200));
    expect(logger.isEnabled()).toBe(true);
    expect(unlinkSync.mock.calls.map((c) => c[0])).not.toContainEqual(expect.stringMatching(/_part2/));
  });

  test("defaults apply when unset, with a warning per variable", () => {
    const { errorLog, logger, streams } = rotating();
    const warnings = errorLog.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("using default"));
    expect(warnings).toEqual([
      expect.stringContaining("WEBSOCKETS_MAX_FILES not set, using default 1000"),
      expect.stringContaining("WEBSOCKETS_MAX_FILE_BYTES not set, using default 10485760"),
    ]);
    logger.logOutbound("x".repeat(1_000_000));
    expect(streams).toHaveLength(1);
  });

  test.each(["abc", "0", "-5", "1.5", ""])("invalid value %p falls back with one warning", (bad) => {
    const { errorLog, logger, streams } = rotating({
      env: { WEBSOCKETS_MAX_FILES: bad, WEBSOCKETS_MAX_FILE_BYTES: "300" },
    });
    const warnings = errorLog.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("WEBSOCKETS_MAX_FILES"));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("using default 1000");
    logger.logOutbound("a");
    expect(logger.isEnabled()).toBe(true);
    expect(streams).toHaveLength(1);
  });

  test("valid values are used without warnings", () => {
    const { errorLog } = rotating({
      env: { WEBSOCKETS_MAX_FILES: "5", WEBSOCKETS_MAX_FILE_BYTES: "1000" },
    });
    expect(errorLog.mock.calls.some((c) => String(c[0]).includes("using default"))).toBe(false);
  });

  test("a failing delete does not disable logging", () => {
    const { logger, unlinkSync } = rotating({
      env: { WEBSOCKETS_MAX_FILES: "1" },
      files: { [`ws_session_${ts(9)}_old.log`]: 1 },
    });
    expect(unlinkSync).toHaveBeenCalled();
    expect(logger.isEnabled()).toBe(true);
  });
});
