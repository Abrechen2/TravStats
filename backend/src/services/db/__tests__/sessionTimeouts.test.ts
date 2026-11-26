import { prisma } from "../../../db";
import { createPrismaClient } from "../../../prismaClient";
import {
  DEFAULT_IDLE_IN_TRANSACTION_TIMEOUT_MS,
  DEFAULT_STATEMENT_TIMEOUT_MS,
  LONG_JOB_STATEMENT_TIMEOUT_MS,
  raiseStatementTimeout,
  sessionTimeoutsFromEnv,
} from "../sessionTimeouts";

/**
 * Perf audit 2026-11, item 13: statement_timeout and
 * idle_in_transaction_session_timeout were 0 on prod, so one runaway query
 * could hold locks and the xmin horizon indefinitely.
 */

async function show(
  client: { $queryRawUnsafe: (q: string) => Promise<unknown> },
  name: string
): Promise<string> {
  const rows = (await client.$queryRawUnsafe(`SHOW ${name}`)) as Array<Record<string, string>>;
  return rows[0][name];
}

describe("sessionTimeoutsFromEnv", () => {
  it("defaults to 30 s per statement and 5 min idle in transaction", () => {
    expect(sessionTimeoutsFromEnv({})).toEqual({
      statementTimeoutMs: DEFAULT_STATEMENT_TIMEOUT_MS,
      idleInTransactionMs: DEFAULT_IDLE_IN_TRANSACTION_TIMEOUT_MS,
    });
    expect(DEFAULT_STATEMENT_TIMEOUT_MS).toBe(30_000);
  });

  it("reads overrides, 0 meaning off", () => {
    expect(
      sessionTimeoutsFromEnv({ DB_STATEMENT_TIMEOUT_MS: "0", DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: "60000" })
    ).toEqual({ statementTimeoutMs: 0, idleInTransactionMs: 60_000 });
  });

  it("refuses a malformed value instead of silently running without a limit", () => {
    expect(() => sessionTimeoutsFromEnv({ DB_STATEMENT_TIMEOUT_MS: "30s" })).toThrow(
      /DB_STATEMENT_TIMEOUT_MS/
    );
  });
});

describe("the app's pool", () => {
  it("runs every session with the statement and idle-transaction timeouts", async () => {
    expect(await show(prisma, "statement_timeout")).toBe("30s");
    expect(await show(prisma, "idle_in_transaction_session_timeout")).toBe("5min");
  });

  it("lets a long job raise its limit for its own transaction only", async () => {
    const inside = await prisma.$transaction(async (tx) => {
      await raiseStatementTimeout(tx, "archiveRestore");
      return show(tx, "statement_timeout");
    });
    expect(inside).toBe(`${LONG_JOB_STATEMENT_TIMEOUT_MS.archiveRestore / 60_000}min`);
    // The raise ended with the transaction: the pooled connection is back at 30 s.
    expect(await show(prisma, "statement_timeout")).toBe("30s");
  });

  it("cancels a statement that outlasts the limit (57014)", async () => {
    const strict = createPrismaClient({
      sessionTimeouts: { statementTimeoutMs: 200, idleInTransactionMs: 0 },
    });
    try {
      await expect(strict.$queryRawUnsafe("SELECT pg_sleep(2)")).rejects.toThrow(
        /statement timeout|57014/
      );
    } finally {
      await strict.$disconnect();
    }
  });
});
