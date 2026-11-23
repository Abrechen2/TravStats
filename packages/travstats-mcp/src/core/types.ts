import type { z } from "zod";
import type { ApiClient } from "./client";

/** One REST operation a tool calls. The contract test holds each to the generated openapi.json. */
export interface Wrap {
  method: "GET";
  /** OpenAPI path template, e.g. `/trips/{id}`. */
  path: string;
  /** Query parameters the tool sends. */
  query?: string[];
  /** Response fields the tool reads, dotted, `[]` for array items: `data.hits[].title`. Omit when the spec has no response schema. */
  fields?: string[];
}

export interface ToolContext {
  client: ApiClient;
  instance: string;
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
  run(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult>;
}
