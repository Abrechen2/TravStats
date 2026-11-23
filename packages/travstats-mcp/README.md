# travstats-mcp

A local, read-only [MCP](https://modelcontextprotocol.io) server for your own [TravStats](https://travstats.de) instance. An assistant such as Claude Desktop or Claude Code can look up your trips, statistics and open inbox items. It talks to the normal TravStats REST API with a personal access token that you create and can revoke at any time. It adds nothing to the server.

Status: version 0.1.0 (milestone M1, read-only). Not published to npm yet; build it from this repository. Licence: AGPL-3.0-only.

## Privacy: read this first

**Everything a tool returns is sent to the AI provider your client talks to** (Anthropic, OpenAI, and so on) and is stored under that provider's terms. TravStats cannot take it back. The tools return summaries only: no documents, photos, passport or loyalty numbers, and no raw location points (TravTrack gives day summaries). Use a `read` token and think about which questions you ask.

Nothing is collected by this package. It makes no calls except to the server you configure; the server address comes from your configuration, never from a tool argument.

## Set-up

1. In TravStats open Settings, API keys, and create a key with the scope **read**. A `write` key works too, but M1 has no write tools. An **admin key is refused** at start-up.
2. Build the package (Node 20 or newer):

   ```bash
   cd packages/travstats-mcp
   npm ci && npm run build
   ```

3. Add it to your client. Claude Desktop (`claude_desktop_config.json`):

   ```json
   {
     "mcpServers": {
       "travstats": {
         "command": "node",
         "args": ["/path/to/TravStats/packages/travstats-mcp/dist/index.js"],
         "env": {
           "TRAVSTATS_URL": "https://travstats.example.org",
           "TRAVSTATS_TOKEN_FILE": "/home/me/.config/travstats-mcp/token"
         }
       }
     }
   }
   ```

   Claude Code: `claude mcp add travstats --env TRAVSTATS_URL=https://travstats.example.org --env TRAVSTATS_TOKEN_FILE=$HOME/.config/travstats-mcp/token -- node /path/to/TravStats/packages/travstats-mcp/dist/index.js`

| Variable | Meaning |
|---|---|
| `TRAVSTATS_URL` | Base address of your instance (required) |
| `TRAVSTATS_TOKEN` or `TRAVSTATS_TOKEN_FILE` | The `ts_pat_…` key, or a file that holds it. Prefer the file: an `env` entry sits in plain text in the client's config |
| `TRAVSTATS_MCP_CALLS_PER_MINUTE` | Client-side call budget, default 60 |

## Scopes

| Token scope | Result |
|---|---|
| `read` | All tools below. |
| `write` | Same in M1 (no write tools yet). |
| `admin` | Refused at start-up. There is no flag to allow it. |

At start the package asks `GET /auth/me` for the token's scope and `GET /version` for the server version (2.8.0 or newer). If the server does not report a scope, the package stops rather than guessing.

## Tools (all read-only)

`search_entries`, `list_trips`, `get_trip_summary`, `get_stats`, `get_upcoming`, `get_travtrack_day`, `list_inbox`, `get_readiness`, `get_routing_run`. Resources: `travstats://trip/{id}` and `travstats://year/{yyyy}`.

- Lists page with a `cursor`; every result is capped at about 20 kB and says `truncated: true` when it was cut.
- A value the server cannot derive stays `null`; `onlyRecorded` is passed through and echoed.
- Every failure has its own reason: `unreachable`, `auth`, `scope`, `not_found`, `rate_limited`, `disabled`, `timeout`, `server`. An empty list means empty.
- The token is redacted from every output and log line. Redirects are not followed.

## Development

The tools live in `src/core` (no MCP dependency); `src/index.ts` is the stdio adapter. Tests run in the backend's Jest suite, because they need the generated OpenAPI document and a database:

```bash
cd backend && npx jest src/__tests__/mcp.contract.test.ts src/routes/__tests__/mcp.package.test.ts --forceExit
```

The contract test fails when a route, a query parameter or a response field a tool uses disappears from `openapi.json`.

A project by [<abrechen2 />](https://www.abrechen2.de/).
