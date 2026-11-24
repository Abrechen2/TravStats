import { AppError } from "../../middleware/errorHandler";
import { startJob } from "../jobs/jobRegistry";
import type { Wrapped } from "./wrapped";
import { loadWrapped } from "./wrappedLoad";

/**
 * How `GET /stats/wrapped` answers within the browser's patience (UAT rc.45
 * M1): the story is built once per account and year at a time, and the request
 * waits for it at most `syncBudgetMs`. A story that takes longer is handed to a
 * background job — the request answers 202 with its id and the client polls
 * `GET /jobs/:id` — instead of the browser giving up at 10 s and the page
 * saying "could not be loaded" while the server finished anyway.
 *
 * A second request for the same story (a retry, a second tab) joins the run
 * already under way rather than starting another one.
 */
export const wrappedTiming = {
  /** Well under the web client's 10 s timeout. Mutable for tests only. */
  syncBudgetMs: 4000,
};

/** The job's failure code when there is no story, as the 404 of the sync path. */
export const NOTHING_TO_LOOK_BACK_ON = "nothing_to_look_back_on";

const running = new Map<string, Promise<Wrapped | null>>();

function storyOf(userId: string, year: number | null): Promise<Wrapped | null> {
  const key = `${userId}\u0000${year ?? "latest"}`;
  const existing = running.get(key);
  if (existing) return existing;
  const promise = loadWrapped(userId, year, { withTravTrack: true }).finally(() => {
    running.delete(key);
  });
  running.set(key, promise);
  return promise;
}

export type WrappedAnswer =
  { kind: "ready"; wrapped: Wrapped | null } | { kind: "job"; jobId: string };

const TIMED_OUT = Symbol("timedOut");

export async function answerWrapped(userId: string, year: number | null): Promise<WrappedAnswer> {
  const story = storyOf(userId, year);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), wrappedTiming.syncBudgetMs);
  });
  try {
    const first = await Promise.race([story, deadline]);
    if (first !== TIMED_OUT) return { kind: "ready", wrapped: first };
  } finally {
    clearTimeout(timer);
  }
  const job = startJob("stats.wrapped", userId, async () => {
    const wrapped = await story;
    if (!wrapped) throw new AppError(NOTHING_TO_LOOK_BACK_ON, 404);
    return wrapped;
  });
  return { kind: "job", jobId: job.id };
}
