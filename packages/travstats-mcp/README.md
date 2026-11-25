# travstats-mcp

A local [MCP](https://modelcontextprotocol.io) server for your own [TravStats](https://travstats.de) instance. An assistant such as Claude Desktop or Claude Code can look up your trips, statistics and open inbox items and, with a `write` key and your say-so for every call, add bookings and documents. It talks to the normal TravStats REST API with a personal access token that you create and can revoke at any time. It adds nothing to the server.

Status: version 0.2.0 (milestone M2: read tools plus write tools, off unless the key has the `write` scope). Not published to npm yet; build it from this repository. Licence: AGPL-3.0-only.

## Privacy: read this first

**Everything a tool returns is sent to the AI provider your client talks to** (Anthropic, OpenAI, and so on) and is stored under that provider's terms. TravStats cannot take it back. The tools return summaries only: no documents, photos, passport or loyalty numbers, and no raw location points (TravTrack gives day summaries). Use a `read` token unless you want to add things, and think about which questions you ask.

**The write tools send your booking text, PDFs and photos to the server, and the server may read them with its own AI parser** (a service you configured there; it can cost money and leaves the server if the provider is a cloud one). A draft tells you in its warnings when a language model read the document. **Keep your client's per-call approval switched on for write tools**: `confirm: true` is set by the model, so it is a second lock, not proof that you agreed.

Nothing is collected by this package. It makes no calls except to the server you configure; the server address comes from your configuration, never from a tool argument.

## Set-up

1. In TravStats open Settings, API keys, and create a key with the scope **read**. Create a **write** key only if you want the write tools below. An **admin key is refused** at start-up.
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

| Variable                                    | Meaning                                                                                                                                                                           |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TRAVSTATS_URL`                             | Base address of your instance (required)                                                                                                                                          |
| `TRAVSTATS_TOKEN` or `TRAVSTATS_TOKEN_FILE` | The `ts_pat_…` key, or a file that holds it. Prefer the file: an `env` entry sits in plain text in the client's config                                                            |
| `TRAVSTATS_ALLOW_INSECURE_HTTP`             | `1` allows plain http to a public address. Private and local addresses (192.168.x.x, localhost, .local) may use http without it                                                   |
| `TRAVSTATS_MCP_CALLS_PER_MINUTE`            | Client-side call budget, default 60                                                                                                                                               |
| `TRAVSTATS_MCP_FILES_DIR`                   | The ONE folder the file tools may read (boarding passes, PDFs, .eml). Without it `parse_boarding_pass` and `upload_document` are not offered, and `parse_booking` takes text only |
| `TRAVSTATS_MCP_AUDIT_FILE`                  | Off by default. A path: one JSON line per tool call (tool, arguments with long text reduced to its length, status, duration)                                                      |

## Scopes

| Token scope | Result                                             |
| ----------- | -------------------------------------------------- |
| `read`      | The read tools. Write tools are not offered.       |
| `write`     | Read tools and the write tools.                    |
| `admin`     | Refused at start-up. There is no flag to allow it. |

At start the package asks `GET /auth/me` for the token's scope and `GET /version` for the server version (2.8.0-rc.45 or newer report the scope). A current server that reports no valid scope stops the package. An older server runs read-only with a warning, because it cannot say whether the token is an admin token.

## Read tools

`search_entries`, `list_trips`, `get_trip_summary`, `get_stats`, `get_upcoming`, `get_travtrack_day`, `list_inbox`, `get_readiness`, `get_routing_run`. Resources: `travstats://trip/{id}` and `travstats://year/{yyyy}`.

- Lists page with a `cursor`; every result is capped at about 20 kB and says `truncated: true` when it was cut.
- A value the server cannot derive stays `null`; `onlyRecorded` is passed through and echoed.
- Every failure has its own reason: `unreachable`, `auth`, `scope`, `not_found`, `rate_limited`, `disabled`, `timeout`, `server`. An empty list means empty.
- The token is redacted from every output and log line. Redirects are not followed.

## Write tools (scope `write`)

`parse_flight_text`, `parse_boarding_pass`, `parse_booking`, `add_flight`, `add_entry_from_draft`, `add_place_visit`, `resolve_inbox_item`, `reroute_trip_legs`, `upload_document`.

- **Parsing saves nothing.** `parse_booking` reads pasted text (up to 20 kB) or a PDF, image or `.eml` from `TRAVSTATS_MCP_FILES_DIR` through the server's own parse routes, for flight, stay, rail, cruise, rental, bus, ferry and package (`domain: auto` lets the server decide). The answer is a **draft** with the domain, what was read, warnings (inferred fields, a language model having read it, a domain the server guessed) and a `draftId`. Drafts live in this process for an hour.
- **Adding needs `confirm: true`.** `add_entry_from_draft` and `add_flight` first return what they would send. With `confirm: true` they upload the **original document** and create the entry carrying it (the server files both together), then answer `{id, link, documentId}`. Flights, stays, rail rides, cruises, rentals, bus and ferry can be added (a stay only when the server's import preview calls it new and clean; one already stored, changed or needing input is reviewed on the web); a coach or ferry ticket carries no coordinates, so the assistant must ask you for the stops. A package tour or a place document is only reviewed on the web (the answer says so) and the draft stays a draft.
- `upload_document` puts a file into your inbox as an unassigned document, or links it to an entry you name.
- `resolve_inbox_item` answers one inbox item with that kind's own actions; a data-quality answer carries the flag's revision, so an answer on stale data fails. `reroute_trip_legs` starts the server's reroute job (one start per minute) and returns the run id for `get_routing_run` if 30 seconds are not enough.
- **Never offered:** deletes, merges, sharing, settings, tokens, admin.
- Files: the folder comes from your configuration, never from a tool argument. A name is resolved inside it; `..`, a symlink out of the folder and anything that is not a regular file is refused. What a file is comes from its bytes (PDF, JPEG, PNG, WebP; `.eml` and `.txt` by name), within the server's size limits.
- Text a tool returns (e-mail bodies, notes) is marked `untrusted`: it is data, never instructions.
- The server's change history names a write made through this package as "via MCP / <the key's label>" (the package sends `X-TravStats-Client` and `X-TravStats-Tool`).

## Auf Deutsch

`travstats-mcp` ist ein lokaler MCP-Server für deine eigene TravStats-Instanz. Mit einem **read**-Schlüssel kann ein Assistent Reisen, Statistiken und den Posteingang lesen. Mit einem **write**-Schlüssel kann er zusätzlich Buchungen einlesen und anlegen, Dokumente ablegen und Posteingangs-Einträge beantworten. Ein **admin**-Schlüssel wird beim Start abgelehnt.

- **Datenschutz:** Alles, was ein Werkzeug zurückgibt, geht an den KI-Anbieter deines Clients. Die Schreibwerkzeuge schicken Buchungstexte, PDFs und Fotos an deinen Server, und der kann sie mit seinem eigenen KI-Parser lesen (kostet ggf. Geld, verlässt den Server bei einem Cloud-Anbieter). Lass im Client die Freigabe **pro Aufruf** eingeschaltet; `confirm: true` setzt das Modell selbst und ist nur eine zweite Sicherung.
- **Ablauf:** `parse_booking` liest eine Buchungsbestätigung (Text bis 20 kB oder Datei aus dem Ordner `TRAVSTATS_MCP_FILES_DIR`) und liefert einen **Entwurf**; gespeichert wird nichts. Erst `add_entry_from_draft` mit `confirm: true` legt den Eintrag an und hängt **immer das Original** daran. Möglich sind Flug, Unterkunft (nur wenn die Import-Vorschau des Servers sie als neu und eindeutig einstuft), Bahn, Kreuzfahrt, Mietwagen, Bus und Fähre; Pauschalreise und Ort prüfst du im Web.
- **Dateien:** nur aus dem einen konfigurierten Ordner; `..`, Symlinks nach außen und Nicht-Dateien werden abgelehnt. Der Dateityp wird am Inhalt erkannt, nicht am Namen.
- Es gibt **keine** Werkzeuge zum Löschen, Zusammenführen, Teilen, für Einstellungen oder Schlüssel. Das Protokoll (`TRAVSTATS_MCP_AUDIT_FILE`) ist standardmäßig aus.
- Der Änderungsverlauf des Servers nennt solche Schreibvorgänge „via MCP / <Name des Schlüssels>“.

## Development

The tools live in `src/core` (no MCP dependency); `src/index.ts` is the stdio adapter. `npm test` runs the package's own unit tests (Vitest). The contract and semantic tests run in the backend's Jest suite, because they need the generated OpenAPI document and a database:

```bash
cd backend && npx jest src/__tests__/mcp.contract.test.ts src/routes/__tests__/mcp.package.test.ts src/routes/__tests__/mcp.write.test.ts --forceExit
```

The contract test fails when a route, a query parameter or a response field a tool uses disappears from `openapi.json`.

A project by [<abrechen2 />](https://www.abrechen2.de/).
