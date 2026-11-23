import { z } from "zod";
import type { ApiClient } from "./client";
import { ToolFailure, describeFailure } from "./errors";
import { capOutput } from "./output";
import { redact } from "./redact";
import { TOOLS } from "./tools";
import type { ToolContext, ToolDef } from "./types";

/** The oldest server that has every route the tools call. */
export const MIN_SERVER_VERSION = "2.8.0";

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

function parseVersion(v: string): number[] {
  return v
    .split(/[.+-]/)
    .slice(0, 3)
    .map((n) => Number.parseInt(n, 10) || 0);
}

export function versionAtLeast(have: string, need: string): boolean {
  const a = parseVersion(have);
  const b = parseVersion(need);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
}

/**
 * Start-up gate. Fails closed: only a token the server says is `read` or `write` may run, so an `admin`
 * token, a server too old to report the scope, or any unknown value stops the package before it serves a call.
 */
export async function preflight(
  client: ApiClient
): Promise<{ scope: "read" | "write"; serverVersion: string }> {
  const me = await client.get<{ tokenScope?: unknown }>("/auth/me");
  if (me.tokenScope === "admin") {
    throw new ToolFailure(
      "config",
      "This token has the admin scope. travstats-mcp refuses admin tokens; create a read or write token instead."
    );
  }
  if (me.tokenScope !== "read" && me.tokenScope !== "write") {
    throw new ToolFailure(
      "config",
      "The server did not report this token's scope (a server older than this package expects, or a browser session). Update TravStats or use a personal access token."
    );
  }
  const v = await client.get<{ version?: unknown }>("/version");
  const serverVersion = typeof v.version === "string" ? v.version : "";
  if (!serverVersion || !versionAtLeast(serverVersion, MIN_SERVER_VERSION)) {
    throw new ToolFailure(
      "config",
      `The server is ${serverVersion || "of unknown version"}; travstats-mcp needs ${MIN_SERVER_VERSION} or newer.`
    );
  }
  return { scope: me.tokenScope, serverVersion };
}

export { TOOLS };
