# Global search — Companion contract (forgejo#403)

Minimum server version: **2.8.0-rc.10** (additive; older servers answer 404 for `/search`).

## `GET /api/v1/search`

Auth: session cookie or PAT, like every route. Rate limit 120/min per user (x10 for a PAT). Family: enveloped, `{ success: true, data }`.

| Query | Type | Notes |
|---|---|---|
| `q` | string, required | Trimmed, 2 to 100 characters, else 400. Case-insensitive substring; `%` and `_` are plain characters. |
| `limit` | int 1..20, default 5 | Hits **per domain**. |
| `domains` | comma list, optional | Subset of `flight,cruise,lodging,poi,rail,bus,ferry,rental,roadtrip,tour,trip`. An unknown name is a 400. Can only narrow, never widen, what the account may see. |

The server decides what is searchable: the account's enabled domains, `roadtrip` and `tour` only while the instance's beta switch is on, `trip` always. The Companion does not have to filter.

### `data`

| Field | Type | Notes |
|---|---|---|
| `query` | string | The trimmed `q`. |
| `hits[]` | see below | Domains in the enum order above, each domain newest first (id as tie-breaker). At most `limit` per domain and **60 in total**. |
| `more` | domain[] | Domains holding further matches than returned. |
| `failed` | domain[] | Domains whose search errored. **Incomplete, not empty** — show it. If every requested domain fails the call is a 500. |
| `capped` | boolean | The 60-hit cap cut hits off. |

Hit: `domain` (the list above), `kind` (`flight|cruise|lodging|place|placeList|rail|bus|ferry|rental|roadtrip|tour|trip`; `poi` holds `place` and `placeList`), `id` (string), `title` (string), `subtitle` (string or null), `date` (UTC instant string or null — departure, check-in, pickup or start; null for places and lists; **not** zone-resolved, see Open), `path` (web route; the Companion maps `kind` + `id` to its own screen).

Matching: flights on number, airline, airport codes/names and a typed route (`MUC-VIE`); cruises on ship, line, ports; stays on name, town, chain (`id` is the lodging, not the stay); places on name, local name, town, list name; rides on line/train number/vessel and stations; rentals on company, stations, vehicle; tours/roadtrips on name (roadtrips also vehicle); trips on name and origin/destination labels.

## Also

`GET /lodging` accepts `q` as an alias of `search` (`search` wins when both are sent).

## Open

`hits[].date` is a bare UTC instant (listed in `openapi.timeShape.baseline.json`) because a hit's zone differs per domain; a `TimeValue` per hit is the follow-up if the Companion needs the local day.
