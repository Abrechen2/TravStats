/**
 * How a readiness fact that could not be loaded stays local to the checks that
 * read it (rc.45): one broken query must not turn `GET /readiness` into a 500.
 */
/**
 * A fact group that could not be loaded. Reading any of its fields throws this,
 * so exactly the checks that need the group fail (`evaluateChecks` shows them as
 * "Prüfung fehlgeschlagen") and every other check still answers.
 */
export class ReadinessFactError extends Error {
  constructor(
    readonly group: string,
    readonly cause: unknown
  ) {
    super(`readiness facts "${group}" could not be loaded`);
    this.name = "ReadinessFactError";
  }
}

export function unavailable<T extends object>(group: string, cause: unknown): T {
  return new Proxy({} as T, {
    get(_target, prop) {
      // Promise resolution and inspection probe `then`/symbols; only real reads fail.
      if (typeof prop === "symbol" || prop === "then") return undefined;
      throw new ReadinessFactError(group, cause);
    },
  });
}
