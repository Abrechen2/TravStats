import { BASE_URL_ENV, WORKER_COUNT_ENV, dropWorkerDatabases } from "./jest.workerDatabase";

/**
 * Drops the per-worker databases a parallel run made (see
 * `jest.workerDatabase.ts`). A serial run made none, and this does nothing.
 */
export default async function globalTeardown(): Promise<void> {
  const base = process.env[BASE_URL_ENV];
  const count = Number(process.env[WORKER_COUNT_ENV]);
  if (base && count > 0) {
    await dropWorkerDatabases(base, count);
  }
}
