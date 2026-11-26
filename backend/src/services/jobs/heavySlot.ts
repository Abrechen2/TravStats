import logger from "../../utils/logger";

/**
 * One instance-wide turn for heavy scheduled work (perf audit 2026-11,
 * item 12). About seventeen nightly jobs sit a few minutes apart between 02:00
 * and 05:35; a slow one used to run straight into the next, and on a 2-core box
 * two heavy jobs at once were enough to starve web requests. Every nightly job
 * now runs through `runHeavyJob`: one at a time, first come first served, and a
 * job whose previous run is still running or waiting is skipped instead of
 * stacking up behind itself (the overlap guard each cron used to lack).
 *
 * In-process only: one TravStats process per database is the deployment model.
 * File imports and the archive restore take the import write slot instead
 * (`travtrack/imports/writeSlot.ts`), which the runtime card shows alongside.
 */

export interface HeavySlotState {
  running: { name: string; since: string } | null;
  waiting: string[];
}

export type HeavyJobOutcome<T> = { ran: true; value: T } | { ran: false; reason: "overlap" };

interface Waiter {
  name: string;
  wake: () => void;
}

export class HeavySlot {
  private holder: { name: string; since: Date } | null = null;
  private readonly queue: Waiter[] = [];

  constructor(private readonly now: () => Date = () => new Date()) {}

  /** Who holds the turn and who waits, for the admin runtime card. */
  state(): HeavySlotState {
    return {
      running: this.holder
        ? { name: this.holder.name, since: this.holder.since.toISOString() }
        : null,
      waiting: this.queue.map((w) => w.name),
    };
  }

  private busyWith(name: string): boolean {
    return this.holder?.name === name || this.queue.some((w) => w.name === name);
  }

  private acquire(name: string): Promise<void> {
    if (!this.holder && this.queue.length === 0) {
      this.holder = { name, since: this.now() };
      return Promise.resolve();
    }
    return new Promise((resolve) =>
      this.queue.push({
        name,
        wake: () => {
          this.holder = { name, since: this.now() };
          resolve();
        },
      })
    );
  }

  private release(): void {
    this.holder = null;
    this.queue.shift()?.wake();
  }

  /**
   * Runs `work` when the turn is free. A job already running or waiting under
   * the same name is not started twice: the call returns `{ ran: false }`.
   * The turn is released whether the work succeeds or throws; a throw is
   * passed on to the caller, never swallowed here.
   */
  async run<T>(name: string, work: () => Promise<T>): Promise<HeavyJobOutcome<T>> {
    if (this.busyWith(name)) {
      logger.warn({
        operation: "heavy_job_skipped",
        message: "The previous run of this job is still running or waiting; this run is skipped",
        context: { job: name, slot: this.state() },
      });
      return { ran: false, reason: "overlap" };
    }
    await this.acquire(name);
    try {
      return { ran: true, value: await work() };
    } finally {
      this.release();
    }
  }
}

/** The instance's one turn for heavy scheduled work. */
export const heavyJobSlot = new HeavySlot();

/** `heavyJobSlot.run`, the form every nightly scheduler uses. */
export function runHeavyJob<T>(name: string, work: () => Promise<T>): Promise<HeavyJobOutcome<T>> {
  return heavyJobSlot.run(name, work);
}
