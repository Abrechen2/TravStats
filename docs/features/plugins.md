# Suggestion plugins

TravStats finds the stops in your location history (TravTrack) and suggests
them as place visits in the inbox. A **suggestion plugin** is a small HTTPS
service you run yourself, or one you trust, that TravStats asks about such a
stop: "what was here?". Its answer appears in the inbox as a suggestion with the
plugin named as its source. You decide; nothing is accepted by itself.

A plugin **answers, it never writes**. It cannot create entries, read your
history or ask TravStats anything. It sees one stop at a time, rounded to the
precision you chose.

- Settings: TravTrack → Erkennung & Vorschläge → Externe Vorschlagsquellen
  (EN: External suggestion sources). At most five per account.
- The admin can switch plugins off for the whole server (Services →
  "Externe Vorschlagsquellen"); the internet master switch covers them too.
- Template: [`packages/travstats-plugin-template`](../../packages/travstats-plugin-template)
  — a working plugin in about a hundred lines of Node, no dependencies, with a
  Dockerfile, a compose snippet and a test that replays signed requests.
- Contract as JSON Schema:
  [`contract/v1.schema.json`](../../packages/travstats-plugin-template/contract/v1.schema.json),
  exported from the server's own OpenAPI document; a test keeps the two equal.

## What is sent, and what is not

Per stop, a plugin receives the stop's start and end, its time zone and its
coordinates **rounded to the plugin's precision**:

| Precision | Coordinates | Also sent |
|---|---|---|
| `exact` | 5 decimals (~1 m) | nearest own place, the venue found, the address |
| `100m` (default) | 3 decimals (~100 m) | nearest own place, the venue found, the address |
| `1km` | 2 decimals (~1 km) | nothing else |

Never sent: your account, user name, name or e-mail, the location history,
other stops, other entries. A plugin that logs coordinates should keep them no
longer than it needs them: they are someone's whereabouts.

## The request

`POST <your url>` with a JSON body:

```http
Content-Type: application/json
TravStats-Plugin-Version: 1
TravStats-Timestamp: 1763900000
TravStats-Request-Id: 0b9f6a2e-4c1d-4e7a-9a53-2f1d6c8e7b10
TravStats-Signature: v1=<hex HMAC-SHA256>
```

```json
{
  "version": 1,
  "kind": "stop",
  "requestId": "0b9f6a2e-4c1d-4e7a-9a53-2f1d6c8e7b10",
  "stop": {
    "start": "2026-11-23T08:12:00.000Z",
    "end": "2026-11-23T10:40:00.000Z",
    "timeZone": "Europe/Berlin",
    "lat": 48.69,
    "lon": 9.31,
    "precisionMeters": 100,
    "nearestPlace": { "name": "Office", "distanceMeters": 40 },
    "venue": { "name": "Business park", "category": "other" },
    "address": { "street": "Example Street 5", "town": "Example Town", "country": "DE" }
  },
  "locale": "de"
}
```

`kind` is `"test"` when the user presses the settings page's test button: the
stop is then a fixed public square (Marienplatz, Munich) and carries no
account data. `nearestPlace`, `venue` and `address` are optional.

An optional `GET <your url>`, signed the same way with an empty body, may
answer `{ "name": "…", "version": 1, "kinds": ["stop"] }`; the test button shows
it.

## Verifying the signature

The signature is HMAC-SHA256 with the plugin's secret over

```
METHOD + "\n" + path + "\n" + timestamp + "\n" + requestId + "\n" + body
```

— the upper-case method, the path **including its query string**, the
`TravStats-Timestamp` value, the `TravStats-Request-Id` value and the **exact
body bytes** as received (do not re-serialise the JSON). The header is
`v1=` followed by the lower-case hex digest.

A plugin MUST:

1. compare the signature in constant time (`crypto.timingSafeEqual`);
2. refuse a timestamp more than **300 s** away from its own clock;
3. keep a **request-id replay cache** for at least the timestamp window and
   refuse an id it has seen. This is mandatory: without it a captured request
   could be sent again within the window.
4. never forget an id while a request carrying it could still be accepted
   (2 × 300 s). If the cache is bounded and full, refuse **new** requests
   until ids age out — evicting a live id would make that request replayable.

Refuse a bad signature, a stale timestamp or a replay with `401`; TravStats
shows that as "auth" on the settings page. Refuse with `503` while the replay
cache is full, so TravStats asks again later instead of reading it as a wrong
key.

The secret is 32 random bytes (base64url) that TravStats generates when you add
the plugin. It is shown once, on adding and on "Neues Geheimnis" (rotate), and
never again.

### Fixture vectors

Secret `test-secret-0123456789abcdef0123456789`:

| Method | Path | Timestamp | Request id | Body | Signature |
|---|---|---|---|---|---|
| `POST` | `/hooks/travstats?x=1` | `1763900000` | `0b9f6a2e-4c1d-4e7a-9a53-2f1d6c8e7b10` | `{"version":1}` | `v1=c1611e231a9667ee0bc0a11707bb4d8c49791ed150df97a7794e552469b68c2a` |
| `GET` | `/` | `1763900000` | `0b9f6a2e-4c1d-4e7a-9a53-2f1d6c8e7b10` | *(empty)* | `v1=1627e12ac45195c6cbdc33e10e529d0d4eb962306cb1d9ecb9febf6a3a55ec5f` |

The server (`backend/src/services/plugins/__tests__/signing.test.ts`) and the
template (`test/replay.test.js`) both test against these.

## The response

`200` with

```json
{
  "version": 1,
  "suggestions": [
    {
      "name": "Project 4711",
      "address": "Example Street 5, Example Town",
      "lat": 48.6901,
      "lon": 9.3102,
      "purpose": "business",
      "note": "maintenance",
      "externalRef": "4711",
      "url": "https://archive.example.com/projects/4711",
      "confidence": 0.95
    }
  ]
}
```

- Every field but `name` and `confidence` is optional; at most **5**
  suggestions; `confidence` 0..1; `purpose` is `private` or `business`; `url`
  must be `https:` and is shown as a plain link, never fetched by TravStats.
- `204`, or an empty `suggestions` list, means "nothing here". That is a real
  answer: TravStats records it and does not ask about the stop again unless it
  moves by more than 300 m or the user presses "Neu fragen".
- A suggestion more than **1 km** from the stop is dropped: a plugin cannot
  move a stop across town.
- `externalRef` makes the place findable again: accepting a suggestion links
  the place as `plugin:<pluginId>:<externalRef>`, so a second visit finds the
  same place.
- The body is capped at **64 KB**; strings are length-capped (name 200, address
  300, note 500 characters).

## Name matches

A suggestion may say why it was made: `reason` is `distance` or `name`, with
optional `distanceMeters`, `matchedToken` and `lowPrecision`. A `name` suggestion
matched a distinctive word of the stop's venue name further away than the
plugin's distance radius; the inbox reads "Name passt (MSA), 780 m". The response
may carry `nameRadiusMeters`: a `name` suggestion is then accepted up to that
radius, capped at 2 km. Distance suggestions, and name suggestions without a
radius, keep the 1 km rule above. All of these are additive and ignored when
unknown.

## Location maintenance (optional capability)

A hello with `capabilities: ["maintenance"]` offers location maintenance of the
plugin's OWN data. Settings: TravTrack → Erkennung & Vorschläge → Externe
Vorschlagsquellen → the plugin → "Standorte pflegen"; the same rows are in the
inbox tab "Plugins". All calls are signed like a stop call and go to
`<plugin url>/maintenance/<action>` (the URL read as a directory); the components
are `PluginMaintenance*V1` in the exported contract.

| Call | Body | Answer |
|---|---|---|
| `POST maintenance/proposals` | `{version, requestId, locale, stops[]}` (≤ 2000), optional search and paging | rows with `issues` (`noCoordinates`, `noStreet`, `lowPrecision`), `proposals` with `confidence` and `evidence`, `applied`, `notices` |
| `POST maintenance/confirm` | `{kind: apply\|undo, …the values about to be written}` | `{token, expiresAt}`; writes nothing |
| `POST maintenance/apply` | `{rowId, lat, lon, street?, postcode?, town?, source, token}` | `{undoId, rowId, written}` |
| `POST maintenance/undo` | `{undoId, token}` | `{undoId, rowId, restored}` |
| `POST maintenance/ignore` | `{rowId, ignored}` | `{rowId, ignored}` |

- **One confirmation per write.** The user confirms each row in a dialog that names
  what will be written; TravStats then asks `confirm` for a single-use ticket bound
  to exactly those values and sends it with `apply` or `undo`. A plugin MUST refuse
  a write without a valid ticket.
- **Who sends the stops.** TravStats sends, with each proposals request, the
  account's venue-named TravTrack findings of the last two years, deduped and
  rounded to the plugin's precision; unnamed stays of 20+ minutes outside privacy
  zones are sent too. At `1km` none are sent, and none when TravTrack is not the
  account's source. The plugin uses them for that answer only and keeps no history.
- **Writes.** Only on `apply`: the coordinates, and the street only when the row's
  own street is empty. The plugin keeps the previous values in a local undo log;
  `undo` restores them and answers `409 {"error":"changed"}` when the row was
  edited since. A source that refuses writes answers `409 {"error":"readOnly"}`; an
  unknown row or undo `404 {"error":"notFound"}`.
- **Routes** (owner of the registration only; an admin does not reach another
  account's plugin): `GET /settings/suggestion-plugins/:id/capabilities`,
  `GET …/:id/maintenance`, `POST …/:id/maintenance/{confirm,apply,undo,ignore}`. A
  failure is `400 PLUGIN_FAILED` with the reason in `error`; a missing capability
  is `409 PLUGIN_NO_MAINTENANCE`. Timeout 15 s, body cap 1 MB. The inbox reads a
  cached copy and polls the notices without the row list.

## Errors, limits and `Retry-After`

What TravStats does with each answer, and what the settings page shows as the
plugin's "letzter Fehler" (last error):

| The plugin … | Reason |
|---|---|
| does not answer within 5 s (connect 2 s) | `timeout` |
| cannot be reached | `unreachable` |
| answers 401 or 403 | `auth` |
| answers 429 | `rateLimited` — `Retry-After` (seconds or an HTTP date) is honoured |
| answers 5xx | `server` |
| answers bad JSON, a body over the schema, an unknown major `version`, a redirect | `protocol` |
| sits on the LAN and the account is not the admin | `privateTarget` |

After a failure TravStats waits 15 minutes, doubling up to 6 hours, before it
asks that plugin again; the open findings it missed are asked once it answers.
Per plugin it makes **at most 60 calls an hour and 300 a day**, one at a time.

## Versioning

`version` is an integer major. TravStats sends the highest it speaks and the
plugin answers with the one it used; an unknown major is `protocol`. Inside a
major, fields may be added in either direction and must be ignored when
unknown.

## Where a plugin may live

The forgejo#411 rule applies on every call, with DNS pinned per connection:

- an ordinary account's plugin must be a **public https** address;
- the admin's own plugin may be a container beside TravStats on the LAN, and
  only there plain `http` (for example `http://travstats-plugin:8080/`);
- redirects are never followed.

## A minimal plugin in Node

```js
const http = require("node:http");
const crypto = require("node:crypto");

const SECRET = process.env.PLUGIN_SECRET;
const seen = new Map(); // request id -> time: the mandatory replay cache

function valid(req, body) {
  const ts = Number(req.headers["travstats-timestamp"]);
  const id = String(req.headers["travstats-request-id"] || "");
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isInteger(ts) || Math.abs(now - ts) > 300 || seen.has(id)) return false;
  const text = `${req.method}\n${req.url}\n${ts}\n${id}\n${body}`;
  const expected = Buffer.from(`v1=${crypto.createHmac("sha256", SECRET).update(text).digest("hex")}`);
  const given = Buffer.from(String(req.headers["travstats-signature"] || ""));
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return false;
  seen.set(id, now);
  for (const [k, at] of seen) if (now - at > 600) seen.delete(k);
  return true;
}

http
  .createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (!valid(req, body)) return res.writeHead(401).end();
      const { stop } = JSON.parse(body);
      const suggestions = lookUp(stop); // your source: a database, an API, a file
      if (!suggestions.length) return res.writeHead(204).end();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ version: 1, suggestions }));
    });
  })
  .listen(8080);

function lookUp(stop) {
  return []; // e.g. [{ name: "…", lat: stop.lat, lon: stop.lon, confidence: 0.8 }]
}
```

The minimal example keeps every id for its window without a bound. The
template adds a body cap, a bounded replay cache (full: `503` for new requests,
never an evicted live id), a health endpoint
(`GET /health`, unsigned) and the test.

### The same check in Python

```python
import hashlib, hmac, time

def valid(secret: bytes, method, path, headers, body: bytes, seen: dict) -> bool:
    ts, rid = int(headers["TravStats-Timestamp"]), headers["TravStats-Request-Id"]
    if abs(time.time() - ts) > 300 or rid in seen:
        return False
    text = f"{method}\n{path}\n{ts}\n{rid}\n".encode() + body
    expected = "v1=" + hmac.new(secret, text, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, headers["TravStats-Signature"]):
        return False
    seen[rid] = ts
    return True
```

## Deploying

`docker compose up -d` in the template directory builds a `node:alpine` image
that runs as `node`, read-only, with the secret from `PLUGIN_SECRET` and your
data mounted read-only. `compose.yaml` joins the network of your TravStats
container, so the admin can register `http://travstats-plugin:8080/`.

## Past days

"Vergangene Tage abfragen" asks one plugin about the stops of up to 90 past
days, as a job, if the plugin allows it ("Vergangene Tage abfragen erlauben").
It is bound by the same hourly and daily limits — it simply takes longer —,
skips stops the plugin has already answered, and only ever suggests.

---

Ein Projekt von [`<abrechen2 />`](https://www.abrechen2.de/) · A project by
[`<abrechen2 />`](https://www.abrechen2.de/en/)
