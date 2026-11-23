import { z } from "zod";
import type { ApiClient } from "./client";
import { ToolFailure, describeFailure } from "./errors";
import { capOutput } from "./output";
import { redact } from "./redact";
import { TOOLS } from "./tools";
import type { ToolContext, ToolDef } from "./types";

/** The first server version whose GET /auth/me reports the token's scope. */
export const MIN_SERVER_VERSION = "2.8.0-rc.45";

export interface CallOutcome {
  isError: boolean;
  text: string;
  structured?: Record<string, unknown>;
}

export async function callTool(
  ctx: ToolContext,
  def: ToolDef,
  rawArgs: unknown,
  token?: string
): Promise<CallOutcome> {
  try {
    const parsed = z
      .object(def.input)
      .strict()
      .safeParse(rawArgs ?? {});
    if (!parsed.success) {
      throw new ToolFailure(
        "invalid_input",
        parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")
      );
    }
    const result = await def.run(ctx, parsed.data as Record<string, unknown>);
    const structured = capOutput({ instance: ctx.instance, ...result.data });
    const text = redact(
      `${result.summary}${structured.truncated ? " (output cut to fit the size cap)" : ""}\n${JSON.stringify(structured)}`,
      token
    );
    return {
      isError: false,
      text,
      structured: JSON.parse(redact(JSON.stringify(structured), token)) as Record<string, unknown>,
    };
  } catch (err) {
    if (err instanceof ToolFailure) return { isError: true, text: describeFailure(err, token) };
    // A bug in the package is still reported as itself, without a stack and without the token.
    return {
      isError: true,
      text: redact(
        `[server] Unexpected failure in ${def.name}: ${(err as Error).message ?? String(err)}`,
        token
      ),
    };
  }
}

/** [major, minor, patch, rc]; a release outranks every candidate of its own number (rc = Infinity). */
function parseVersion(v: string): number[] {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?/.exec(v.trim());
  if (!m) return [0, 0, 0, 0];
  return [
    Number(m[1]),
    Number(m[2]),
    Number(m[3]),
    m[4] === undefined ? Number.POSITIVE_INFINITY : Number(m[4]),
  ];
}

export function versionAtLeast(have: string, need: string): boolean {
  const a = parseVersion(have);
  const b = parseVersion(need);
  for (let i = 0; i < 4; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
}

export interface PreflightResult {
  /** null: an older server that cannot say. The package is read-only anyway. */
  scope: "read" | "write" | null;
  serverVersion: string;
  warning?: string;
}

/**
 * Start-up gate. Fails closed: a server that reports `admin` is refused, and so is any value that is
 * not `read`/`write` on a server that should report one. Only a server older than MIN_SERVER_VERSION
 * (no `tokenScope` at all) is let through, with a warning: every tool is a GET, so the worst
 * an unchecked admin token can do here is read what it could read anyway.
 */
export async function preflight(client: ApiClient): Promise<PreflightResult> {
  const v = await client.get<{ version?: unknown }>("/version");
  const serverVersion = typeof v.version === "string" ? v.version : "";
  const me = await client.get<{ tokenScope?: unknown }>("/auth/me");
  if (me.tokenScope === "admin") {
    throw new ToolFailure(
      "config",
      "This token has the admin scope. travstats-mcp refuses admin tokens; create a read or write token instead."
    );
  }
  if (me.tokenScope === "read" || me.tokenScope === "write")
    return { scope: me.tokenScope, serverVersion };
  const old = !serverVersion || !versionAtLeast(serverVersion, MIN_SERVER_VERSION);
  if (old && me.tokenScope === undefined) {
    return {
      scope: null,
      serverVersion,
      warning: `Server ${serverVersion || "(unknown version)"} is older than ${MIN_SERVER_VERSION} and cannot report the token's scope, so travstats-mcp cannot check that it is not an admin token. It runs read-only. Use a read token, or update TravStats.`,
    };
  }
  throw new ToolFailure(
    "config",
    "The server reported an unknown scope for this token (or this is not a personal access token). Use a TravStats read or write key."
  );
}

export { TOOLS };
