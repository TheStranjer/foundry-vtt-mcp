import { AckDispatcher } from "../src/core/ack-dispatcher.js";

describe("AckDispatcher", () => {
  test("routes a frame to the request that owns its id", () => {
    const dispatcher = new AckDispatcher();
    const first = jest.fn();
    const second = jest.fn();
    dispatcher.add(7, first);
    dispatcher.add(8, second);

    expect(dispatcher.dispatch('438[{"b":1}]')).toBe(true);

    expect(second).toHaveBeenCalledWith('438[{"b":1}]');
    expect(first).not.toHaveBeenCalled();
  });

  test("ignores ids nobody waits for", () => {
    const dispatcher = new AckDispatcher();
    const handler = jest.fn();
    dispatcher.add(7, handler);

    expect(dispatcher.dispatch('439[{"x":1}]')).toBe(false);

    expect(handler).not.toHaveBeenCalled();
    expect(dispatcher.has(7)).toBe(true);
  });

  test("ignores frames that are not acks", () => {
    const dispatcher = new AckDispatcher();
    const handler = jest.fn();
    dispatcher.add(7, handler);

    expect(dispatcher.dispatch("2")).toBe(false);
    expect(dispatcher.dispatch('42["session",null]')).toBe(false);
    expect(dispatcher.dispatch('43[{"no":"id"}]')).toBe(false);
    expect(dispatcher.dispatch("437not-json")).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  test("never parses a frame: the owner does", () => {
    const dispatcher = new AckDispatcher();
    const parse = jest.spyOn(JSON, "parse");
    dispatcher.add(7, () => undefined);

    dispatcher.dispatch('439[{"x":1}]');
    dispatcher.dispatch('437[{"x":1}]');

    expect(parse).not.toHaveBeenCalled();
    parse.mockRestore();
  });

  test("an id is answered once", () => {
    const dispatcher = new AckDispatcher();
    const handler = jest.fn();
    dispatcher.add(7, handler);

    expect(dispatcher.dispatch('437[{}]')).toBe(true);
    expect(dispatcher.dispatch('437[{}]')).toBe(false);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(dispatcher.size).toBe(0);
  });

  test("remove forgets a pending request", () => {
    const dispatcher = new AckDispatcher();
    dispatcher.add(7, jest.fn());

    expect(dispatcher.remove(7)).toBe(true);
    expect(dispatcher.remove(7)).toBe(false);
    expect(dispatcher.size).toBe(0);
  });
});
