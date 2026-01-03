import { WebSocketLogger } from "../src/websocket-logger.js";

describe("WebSocketLogger", () => {
  test("disabled when WEBSOCKETS_DIRECTORY not set", () => {
    const logger = new WebSocketLogger({
      env: {},
      logger: { error: jest.fn() },
    });

    expect(logger.isEnabled()).toBe(false);
  });

  test("initializes and writes header", () => {
    const appendFileSync = jest.fn();
    const fs = {
      existsSync: jest.fn(() => false),
      mkdirSync: jest.fn(),
      appendFileSync,
    };
    const now = new Date("2020-01-01T00:00:00.000Z");
    const logger = new WebSocketLogger({
      fs,
      path: { join: (...parts: string[]) => parts.join("/") },
      env: { WEBSOCKETS_DIRECTORY: "/tmp/ws" },
      nowFn: () => now,
      randomFn: () => 0.123456,
      logger: { error: jest.fn() },
    });

    expect(fs.mkdirSync).toHaveBeenCalledWith("/tmp/ws", { recursive: true });
    expect(logger.isEnabled()).toBe(true);
    expect(appendFileSync).toHaveBeenCalled();
  });

  test("logOutbound and logInbound append entries", () => {
    const appendFileSync = jest.fn();
    const fs = {
      existsSync: jest.fn(() => true),
      mkdirSync: jest.fn(),
      appendFileSync,
    };
    const logger = new WebSocketLogger({
      fs,
      path: { join: (...parts: string[]) => parts.join("/") },
      env: { WEBSOCKETS_DIRECTORY: "/tmp/ws" },
      nowFn: () => new Date("2020-01-01T00:00:00.000Z"),
      randomFn: () => 0.1,
      logger: { error: jest.fn() },
    });

    logger.logOutbound("out");
    logger.logInbound("in");

    expect(appendFileSync).toHaveBeenCalledTimes(3);
  });

  test("close writes footer and disables", () => {
    const appendFileSync = jest.fn();
    const fs = {
      existsSync: jest.fn(() => true),
      mkdirSync: jest.fn(),
      appendFileSync,
    };
    const logger = new WebSocketLogger({
      fs,
      path: { join: (...parts: string[]) => parts.join("/") },
      env: { WEBSOCKETS_DIRECTORY: "/tmp/ws" },
      nowFn: () => new Date("2020-01-01T00:00:00.000Z"),
      randomFn: () => 0.1,
      logger: { error: jest.fn() },
    });

    logger.close();

    expect(logger.isEnabled()).toBe(false);
    expect(appendFileSync).toHaveBeenCalledTimes(2);
  });

  test("initialize handles errors", () => {
    const appendFileSync = jest.fn();
    const fs = {
      existsSync: jest.fn(() => false),
      mkdirSync: jest.fn(() => {
        throw new Error("fail");
      }),
      appendFileSync,
    };
    const logger = new WebSocketLogger({
      fs,
      path: { join: (...parts: string[]) => parts.join("/") },
      env: { WEBSOCKETS_DIRECTORY: "/tmp/ws" },
      logger: { error: jest.fn() },
    });

    expect(logger.isEnabled()).toBe(false);
    expect(appendFileSync).not.toHaveBeenCalled();
  });
});
