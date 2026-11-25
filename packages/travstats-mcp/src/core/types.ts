import type { z } from "zod";
import type { ApiClient } from "./client";
import type { DraftStore } from "./drafts";

/** One REST operation a tool calls. The contract test holds each to the generated openapi.json. */
export interface Wrap {
  method: "GET" | "POST";
  /** OpenAPI path template, e.g. `/trips/{id}`. */
  path: string;
  /** Query parameters the tool sends. */
  query?: string[];
  /** Top-level JSON request body properties the tool sends; each must exist in the operation's request schema. */
  body?: string[];
  /** Response fields the tool reads, dotted, `[]` for array items: `data.hits[].title`. Omit when the spec has no response schema. */
  fields?: string[];
}

export interface AuditEntry {
  tool: string;
  args: Record<string, unknown>;
  status: "ok" | "failed";
  reason?: string;
  durationMs: number;
}

export interface ToolContext {
  client: ApiClient;
  instance: string;
  /** The one directory file tools read from; null switches the file tools off. */
  filesDir?: string | null;
  drafts?: DraftStore;
  /** Local audit sink; absent unless the user switched the audit on. */
  audit?: (entry: AuditEntry) => void;
  /** The token's scope as the server reported it at start-up. */
  scope?: "read" | "write" | null;
  /** The MCP client's cancellation; long waits (job polling) stop on it. */
  signal?: AbortSignal;
  /** Injected in tests so polling does not wait in real time. */
  sleep?: (ms: number) => Promise<void>;
}

export interface ToolResult {
  /** One line for the model and the person. */
  summary: string;
  data: Record<string, unknown>;
}

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  wraps: Wrap[];
  input: z.ZodRawShape;
  /** The tool writes to the user's TravStats (or asks a route that needs write scope). */
  write?: boolean;
  /** The result carries text from a document, an e-mail or the server: the model must treat it as data. */
  untrusted?: boolean;
  /** Needs `TRAVSTATS_MCP_FILES_DIR`; not offered without it. */
  needsFilesDir?: boolean;
  run(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult>;
}
