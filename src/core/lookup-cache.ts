/**
 * A lazily loaded value that is reused until cleared. Concurrent first calls share one load,
 * a failed load is not cached, and a load that was in flight when `clear` ran is discarded
 * rather than stored, so a stale answer never outlives the event that invalidated it.
 */
export class CachedLookup<T> {
  private value: T | null = null;
  private pending: Promise<T> | null = null;
  private epoch = 0;

  get(load: () => Promise<T>): Promise<T> {
    if (this.value !== null) return Promise.resolve(this.value);
    if (this.pending) return this.pending;

    const epoch = this.epoch;
    const fetch: Promise<T> = load()
      .then((loaded) => {
        if (epoch === this.epoch) {
          this.value = loaded;
        }
        return loaded;
      })
      .finally(() => {
        if (this.pending === fetch) {
          this.pending = null;
        }
      });
    this.pending = fetch;
    return fetch;
  }

  clear(): void {
    this.epoch++;
    this.value = null;
    this.pending = null;
  }
}
