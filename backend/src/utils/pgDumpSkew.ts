/**
 * Does the `pg_dump` we are about to run actually speak to this server?
 *
 * `pg_dump` refuses outright when it is OLDER than the server's major version
 * — "server version 16.3; pg_dump version 15.7" and nothing is written. That
 * is the most common reason a pre-migration backup fails on a real install:
 * the image ships one client, the operator points TravStats at a Postgres they
 * already run, and the two drift apart at the next database upgrade.
 *
 * Until 2026-09-19 that failure was a single WARN line and the migration ran
 * anyway. It refuses the boot now, so the message has to say WHY — an operator
 * reading "Failed to start pg_dump" at 3am cannot tell a missing binary from a
 * version skew, and the two have different fixes.
 *
 * The rule is pure and the probe is separate, so the sentence can be tested
 * without a database or a `pg_dump` on PATH.
 */

import { execFile } from "child_process";
import { promisify } from "util";

import { createPrismaClient } from "../prismaClient";

const execFileAsync = promisify(execFile);

/** The major version out of anything Postgres prints, or null. */
export function majorVersionOf(text: string | null | undefined): number | null {
  if (!text) return null;
  // "pg_dump (PostgreSQL) 16.3" / "PostgreSQL 16.3 on x86_64-pc-linux-gnu …"
  const match = text.match(/(\d+)(?:\.\d+)*/);
  if (!match) return null;
  const major = Number.parseInt(match[1], 10);
  return Number.isFinite(major) ? major : null;
}

/**
 * The skew, as a sentence, or null when there is nothing to say.
 *
 * Only a client OLDER than the server is reported. A NEWER pg_dump against an
 * older server is supported and normal — the Docker image ships 16 and plenty
 * of people run 15 — so naming it would be a warning nobody can act on, in the
 * one message that has to be worth reading.
 *
 * Abstains when either version is unknown: an unread version is not evidence
 * of a skew, and a guess here would send someone upgrading a Postgres that was
 * never the problem.
 */
export function pgDumpSkew(
  clientVersionText: string | null,
  serverVersionText: string | null
): string | null {
  const client = majorVersionOf(clientVersionText);
  const server = majorVersionOf(serverVersionText);
  if (client === null || server === null) return null;
  if (client >= server) return null;
  return (
    `pg_dump is version ${client} and the server is version ${server}. ` +
    `pg_dump refuses to dump a server newer than itself, so this backup cannot ` +
    `succeed until the client is at least version ${server}.`
  );
}

/** `pg_dump --version`, or null when there is no pg_dump on PATH. */
async function pgDumpClientVersion(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("pg_dump", ["--version"]);
    return stdout.trim();
  } catch {
    // No local pg_dump is NOT a skew. `createDatabaseDump` may still reach one
    // through `docker exec` into the database container, where client and
    // server match by construction.
    return null;
  }
}

/** `SELECT version()`, or null when the server cannot be asked. */
async function serverVersion(): Promise<string | null> {
  const prisma = createPrismaClient();
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ version: string }>>("SELECT version()");
    return rows[0]?.version ?? null;
  } catch {
    return null;
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Ask both sides and apply the rule. Never throws: this runs before a backup
 * that is itself about to decide whether the instance boots, and a probe that
 * fell over would be a worse outcome than a probe that says nothing.
 */
export async function detectPgDumpSkew(): Promise<string | null> {
  const [client, server] = await Promise.all([pgDumpClientVersion(), serverVersion()]);
  return pgDumpSkew(client, server);
}
