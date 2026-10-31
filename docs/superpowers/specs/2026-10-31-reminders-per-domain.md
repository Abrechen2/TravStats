# Reminders per domain (settings redesign, package 11)

Server part. Web page and Companion follow (order: server, web, Companion).

## Contract

### GET / PUT `/api/v1/settings/notifications`

Additive: the three legacy fields stay exactly as old clients know them.

```jsonc
{
  "notificationEmail": "a@b.c" | null,
  "notifyBefore24h": boolean,          // legacy, derived (see below)
  "notifyBefore2h": boolean,           // legacy, derived
  "domains": {                          // always all six
    "flight" | "cruise" | "rail" | "bus" | "ferry" | "lodging": {
      "enabled": boolean,
      "leadHours": number[],            // sorted descending
      "channel": "app" | "mail" | "both"
    }
  },
  "mail": { "available": boolean, "reason": "no_email" | null },
  "push": { "available": boolean, "reason": "no_relay" | "no_device_token" | "token_rejected" | null }
}
```

PUT accepts `notificationEmail`, `notifyBefore24h`, `notifyBefore2h` (legacy) and
`domains` (any subset of the six domains, each with any subset of
`enabled` / `leadHours` / `channel`; unknown keys are 400). The response is the
GET body.

- `leadHours`: integers 1-168, unique, the presets 24 and 2 plus **at most one**
  custom value. `[]` is valid and means no reminder for that domain; `enabled`
  stays an explicit, separate switch.
- Legacy PUT of `notifyBefore24h` / `notifyBefore2h` adds or removes that preset
  in every domain row (a custom lead is kept). A `domains` PUT materialises a row for
  all six domains and re-derives the legacy fields (`notifyBefore24h` = some enabled domain has 24).
- An account with no row for a domain (created after the migration, never saved)
  reads the legacy switches and its paired devices through the same rule as the
  backfill (`services/reminders/prefs.ts#legacyPref`).
- `push` describes the CALLING device. A PAT / device token is judged by its own
  device row; a browser session by the account's devices (available when any can be
  pushed to). Order: `no_relay` (admin push off or no relay URL) > `no_device_token`
  (no registered token, revoked / expired pairing) > `token_rejected` (every token of
  the caller was named dead by the relay). The Companion schedules locally only while
  `push.available` is false.
- `mail.reason = "no_email"` when mail is chosen but there is no address: the mail part is
  skipped, the push part is not.

### Push payload (sealed for the device)

`type` is `"<domain>.reminder"` (`flight.reminder` unchanged), plus `domain`,
`entryId`, `id` (the claim id), `title`, `body`, `sentAt`; `flightId` only for flights.
`collapseId` is `reminder:<entryId>`. A relay 410 `token-invalid` no longer deletes the
device row: it sets `tokenRejectedAt`, the device is skipped, and a registration
(`PUT /devices/me/push`) with a DIFFERENT token clears it.

### Scheduling

- Cron stays every 15 minutes. A reminder is due when `anchor - lead <= now`, the anchor
  is still ahead, and it is at most 60 minutes late (later: skipped). Every integer lead
  is therefore hit by some tick (a 60-minute window, 15-minute cadence); a custom lead is
  scheduled like the presets because each run covers the presets plus every lead in use
  (`activeLeadHours`). An outage shorter than an hour is caught up, a longer one is not.
- Durable dedupe: `reminder_claims`, one row per account, domain, entry, lead and channel
  (`mail`, or `push:<apiTokenId>` per device). Claim before send; a claim without `sentAt`
  is a lease, retaken after 10 minutes (or at once after a failed send). A sent claim
  re-arms only when the entry's anchor moved by more than 30 minutes.
- Right before each send the entry (exists, `scheduled`, anchor unchanged), the account
  (active), the domain switch, the lead and the channel are read again.
- Channels are independent: a mail failure does not skip the push and vice versa. Push goes
  to every paired device with the reminder switch on and the trip not muted.
- Anchors: flight / ferry / bus / rail first leg / cruise day-1 stop are their stored real
  instants. **Lodging:** the stored check-in time in the stay's zone; without a time 15:00 in
  the stay's zone; without a zone 15:00 in the account's profile zone (UTC if unset). A
  nonexistent local time (DST gap) moves to the next valid instant, a repeated one is the
  earlier; the lead is subtracted in UTC. This **replaces the old 08:00-on-check-in-day**
  lodging reminder.

### Existing accounts (migration `20261031120900_reminders_per_domain`)

Per domain: mail on when there is an address and a matching switch (lodging: the 24 h
switch only); app on when a paired device has its reminder switch on; lead hours from
the e-mail switches, else 24 and 2. Nothing is switched on that was off; idempotent
(`ON CONFLICT DO NOTHING`). Known deviation: one lead list serves both channels, so a
flight account with mail on 24 h only and push (formerly 24 h and 2 h) now gets push at 24 h only.

## Open for the Companion

- Read `push` with the PAT; schedule local reminders only while `push.available` is false.
- Handle `<domain>.reminder` payload types.
