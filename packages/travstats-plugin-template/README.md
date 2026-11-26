# TravStats suggestion plugin — template

A minimal plugin for [TravStats](https://travstats.de) external suggestion
sources: TravStats asks it, signed, about a stop it found in your location
history, and it answers with places. This one answers from a JSON file of
places; replace `lookup` in `src/server.js` with your own source.

- **Contract:** `contract/v1.schema.json` (JSON Schema, exported from the
  TravStats server, do not edit) and the guide `docs/features/plugins.md` in
  the TravStats repository.
- **Run:** `PLUGIN_SECRET=… npm start` (Node ≥ 20, no dependencies), or
  `docker compose up -d` with `compose.yaml`.
- **Test:** `npm test` replays signed requests: the guide's fixture vector, an
  answered stop, and the refusals (wrong secret, stale timestamp, replayed
  request id).

- **List (optional):** a hello with `list: {defaultName, columns}` makes
  TravStats keep one place list per registration; accepted suggestions join it,
  and `externalRef: {id, label, fields}` fills the announced columns. A plugin
  that keeps its own copy of the contract must vendor this exact file.

A plugin only ever answers. It never writes into TravStats, and it should not
keep the coordinates it is asked about longer than it needs them.

---

Ein Projekt von [`<abrechen2 />`](https://www.abrechen2.de/) · A project by
[`<abrechen2 />`](https://www.abrechen2.de/en/)
