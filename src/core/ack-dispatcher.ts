import { ackIdOf } from "./socket-protocol.js";

/** Receives the raw ack frame of the request that owns its id. */
export type AckHandler = (frame: string) => void;

/**
 * Routes Socket.IO ack frames (`43<id>[...]`) to the one pending request that owns the id.
 * The id is read from the frame prefix, so a frame is never parsed here: the owner decides
 * whether to parse it, and frames nobody waits for are dropped without a `JSON.parse`.
 */
export class AckDispatcher {
  private pending = new Map<number, AckHandler>();

  /** Number of requests still waiting for their ack. */
  get size(): number {
    return this.pending.size;
  }

  has(id: number): boolean {
    return this.pending.has(id);
  }

  add(id: number, handler: AckHandler): void {
    this.pending.set(id, handler);
  }

  /** Forget a pending request (it timed out or was cancelled). True if it was pending. */
  remove(id: number): boolean {
    return this.pending.delete(id);
  }

  /**
   * Hand the frame to its owner and forget the owner: an id is answered once.
   * Returns false, without parsing, when the frame is not an ack or has no pending owner.
   */
  dispatch(frame: string): boolean {
    const id = ackIdOf(frame);
    if (id === null) return false;

    const handler = this.pending.get(id);
    if (!handler) return false;

    this.pending.delete(id);
    handler(frame);
    return true;
  }
}
