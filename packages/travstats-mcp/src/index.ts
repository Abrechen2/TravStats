import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createClient } from "./core/client";
import { loadConfig } from "./core/config";
import { ToolFailure, describeFailure } from "./core/errors";
import { redact } from "./core/redact";
import { TOOLS, callTool, preflight } from "./core/runtime";

const VERSION = "0.1.0";

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const client = createClient(config);
  const { scope, serverVersion } = await preflight(client);
  const ctx = { client, instance: config.instance };

  const server = new McpServer({ name: "travstats-mcp", version: VERSION });

  for (const def of TOOLS) {
    server.registerTool(
      def.name,
      {
        title: def.title,
        description: def.description,
        inputSchema: def.input,
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      async (args) => {
        const out = await callTool(ctx, def, args, config.token);
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
    `travstats-mcp ${VERSION}: connected to ${config.instance} (server ${serverVersion}, token scope ${scope}, read-only tools)\n`
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
