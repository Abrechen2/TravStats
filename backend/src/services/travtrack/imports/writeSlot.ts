/**
 * The instance's turn at writing imported points (2026-11-24): one file import
 * stores at a time, so two large files never compete for the same disk — but
 * no account keeps the turn. An import holds it for a slice (`SLICE_BATCHES`
 * batches or `SLICE_MS`, whichever ends first) and then, when another import
 * waits, queues again behind it. The queue is first come, first served, and an
 * account has at most one running import (`createRunningImport`), so the turns
 * go round the accounts. A slice end loses nothing: the import's cursor is
 * committed with every batch, and it carries on from there.
 */

/** Batches one turn stores at most before another waiting import gets its turn. */
export const SLICE_BATCHES = 30;
/** The longest one turn lasts, pauses included. */
export const SLICE_MS = 30_000;

type Waiter = { userId: string; wake: () => void };

export class FairSlot {
  private holders = 0;
  private readonly queue: Waiter[] = [];

  constructor(private readonly capacity = 1) {}

  /** Resolves when this import holds a turn; behind everyone already waiting. */
  acquire(userId: string): Promise<void> {
    if (this.holders < this.capacity && this.queue.length === 0) {
      this.holders += 1;
      return Promise.resolve();
    }
    return new Promise((wake) => this.queue.push({ userId, wake }));
  }

  /** Gives the turn to the next waiting import, or frees it. */
  release(): void {
    const next = this.queue.shift();
    if (next) next.wake();
    else this.holders = Math.max(0, this.holders - 1);
  }

  /** Imports waiting for a turn. */
  waiting(): number {
    return this.queue.length;
  }

  /**
   * A slice ended: when another import waits, hand it the turn and queue again
   * behind it (true); with nobody waiting keep the turn (false).
   */
  async yieldTurn(userId: string): Promise<boolean> {
    if (this.queue.length === 0) return false;
    this.release();
    await this.acquire(userId);
    return true;
  }
}

/** The instance's one turn at storing imported points. */
export const importWriteSlot = new FairSlot(1);
