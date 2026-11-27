import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createClient } from "./core/client";
import { loadConfig } from "./core/config";
import { ToolFailure, describeFailure } from "./core/errors";
import { redact } from "./core/redact";
import { appendFileSync } from "node:fs";
import { DraftStore } from "./core/drafts";
import { TOOLS, availableTools, callTool, preflight } from "./core/runtime";

const VERSION = "0.2.0";

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const client = createClient(config, fetch, undefined, VERSION);
  const { scope, serverVersion, warning } = await preflight(client);
  if (warning) process.stderr.write(`travstats-mcp WARNING: ${warning}\n`);
  const auditFile = config.auditFile;
  const ctx = {
    client,
    instance: config.instance,
    filesDir: config.filesDir,
    drafts: new DraftStore(),
    scope,
    // Off unless TRAVSTATS_MCP_AUDIT_FILE is set: one JSON line per call, long text reduced to its length.
    ...(auditFile
      ? {
          audit: (e: object) =>
            appendFileSync(
              auditFile,
              `${JSON.stringify({ at: new Date().toISOString(), ...e })}\n`,
              {
                mode: 0o600,
              }
            ),
        }
      : {}),
  };
  const tools = availableTools(scope, config.filesDir);

  const server = new McpServer({ name: "travstats-mcp", version: VERSION });

  for (const def of tools) {
    server.registerTool(
      def.name,
      {
        title: def.title,
        description: def.description,
        inputSchema: def.input,
        // A write tool says so to the client, which can then ask the person before every call.
        annotations: {
          readOnlyHint: !def.write,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      async (args, extra) => {
        const out = await callTool({ ...ctx, signal: extra.signal }, def, args, config.token);
        return {
          content: [{ type: "text" as const, text: out.text }],
          isError: out.isError,
          ...(out.structured ? { structuredContent: out.structured } : {}),
        };
      }
    );
  }

  const byName = (n: string) => TOOLS.find((t) => t.name === n)!;
  const resource = (uri: URL, out: Awaited<ReturnType<typeof callTool>>) => {
    if (out.isError) throw new Error(out.text);
    return { contents: [{ uri: uri.href, mimeType: "application/json", text: out.text }] };
  };
  server.registerResource(
    "trip",
    new ResourceTemplate("travstats://trip/{id}", { list: undefined }),
    { title: "Trip summary", mimeType: "application/json" },
    async (uri, vars) =>
      resource(
        uri,
        await callTool(ctx, byName("get_trip_summary"), { tripId: String(vars.id) }, config.token)
      )
  );
  server.registerResource(
    "year",
    new ResourceTemplate("travstats://year/{yyyy}", { list: undefined }),
    { title: "Year statistics", mimeType: "application/json" },
    async (uri, vars) =>
      resource(
        uri,
        await callTool(
          ctx,
          byName("get_stats"),
          { view: "summary", year: Number(vars.yyyy) },
          config.token
        )
      )
  );

  await server.connect(new StdioServerTransport());
  process.stderr.write(
    `travstats-mcp ${VERSION}: connected to ${config.instance} (server ${serverVersion}, token scope ${scope ?? "unchecked"}, ${tools.length} tools${scope === "write" ? ", WRITE enabled" : ", read-only"})\n`
  );
}

main().catch((err) => {
  const text =
    err instanceof ToolFailure
      ? describeFailure(err)
      : redact(String((err as Error).message ?? err));
  process.stderr.write(`travstats-mcp: ${text}\n`);
  process.exit(1);
});
