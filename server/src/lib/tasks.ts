/** Keeps track of in-flight promises so graceful shutdown can wait for them. */
export class TaskTracker {
  private readonly pending = new Set<Promise<unknown>>();

  /**
   * Registers a promise and returns it unchanged.
   *
   * @param promise - Work to track until it settles.
   */
  track<T>(promise: Promise<T>): Promise<T> {
    this.pending.add(promise);
    const forget = () => this.pending.delete(promise);
    promise.then(forget, forget);
    return promise;
  }

  /** Resolves once every tracked promise has settled (including ones added meanwhile). */
  async drain(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
  }
}
