# ADR 0003 — Push notifications through the relay, end to end encrypted

Status: **proposed**, 2026-10-02. The owner approved the design on 2026-10-01
("Entscheide du alles so wie empfohlen, bester Weg für User gewinnt"); he has
not yet seen the built branch `feat/push-notifications`. This is the server
half. The app half is Companion ADR 0011 (replaces Companion ADR 0004), still
pending with companion#41. The binding design is the Companion spec
`docs/superpowers/specs/2026-10-01-push-notifications-design.md`.

## Context

A flight change (time, gate, terminal, cancellation, diversion) or a departure
reminder should reach the phone while the app is closed, and nobody between the
user's server and the phone (relay, Apple, Google) may be able to read it.

- APNs and FCM credentials belong to the app's publisher, not to every
  self-hosted server. A TravStats instance therefore cannot talk to Apple or
  Google itself.
- Before this change the server only detected changes (5-minute job,
  `PendingFlightUpdate`), sent e-mail reminders, and left the phone to find out
  on app open.

## Decision

### D1 — A relay holds the platform keys; the server never does

`push.travstats.de` (separate repo `travstats-push`, hosted by the owner)
authenticates an instance, rate-limits it and forwards to APNs / FCM. The
server talks to it through `services/push/relayClient.ts`
(`POST /v1/instances` to register itself once, `POST /v1/push` afterwards). A
self-hosted relay is possible, but needs its own APNs/FCM keys and an app build
that carries them; that is a known limit, not a supported path.

### D2 — Payloads are sealed per device (travstats-push v1)

`services/push/seal.ts`: ephemeral X25519 key per message against the device's
public key, HKDF-SHA256 (salt = ephemeral pub ‖ device pub, info
`travstats-push v1`), ChaCha20-Poly1305 with a random 12-byte nonce, wire
string `base64url(eph_pub ‖ nonce ‖ ct ‖ tag)`. Plaintext is JSON of at most
2 KB, rendered on the server in the device's locale (DE primary, EN mirror).
Server, Android JS and the Swift extension share one vector file. The private
key never leaves the phone.

### D3 — What the server stores

- `DevicePush`: 1:1 with the pairing `ApiToken` (`onDelete: Cascade`, so
  unpairing or revoking forgets it). Holds platform, native push token, APNs
  environment, device public key, the two switches (flight changes, reminders)
  and locale. Registered with `PUT /api/v1/devices/me/push`; `GET` never
  returns token or key; `DELETE` removes it.
- `PushDelivery`: unique `(deviceId, eventKey)`. This is the dedupe, so the
  5-minute job never sends the same change twice.
- `AdminSettings` push fields: `pushEnabled` (default false), `pushConsentAt`,
  `pushRelayUrl` (default `https://push.travstats.de`), `pushInstanceId`,
  `pushInstanceSecret` (encrypted with the existing AES-256-GCM helper), and a
  pause marker for 429. AeroAPI keys follow the existing user / admin / env
  resolution, encrypted and masked.

### D4 — What the relay sees, and what it never sees

Sees, in transit: the instance id and secret, the device token, the platform,
the ciphertext, the sender's IP. Stores only a hash of the secret, a name and a
daily counter. Never sees: flight data, text, user identity, device keys.
Cannot read the ciphertext. Apple and Google see the token and the ciphertext.

### D5 — Off until the admin agrees

`pushEnabled` defaults to false. Until an admin switches it on in the admin
settings, next to the text of what the relay receives, the server does not
register with the relay and does not contact it at all. The phone is told via
`serverPushEnabled` in the device-route answers and shows that the admin has
not agreed yet.

### D6 — Triggers

- **Flight changes:** from the existing detection in the 5-minute job, whether
  the change is applied directly or waits as `PendingFlightUpdate` (the text
  then asks for confirmation). Provider cancellation (`statusOverride:
  cancelled`) is proposed as `status: cancelled`; diversion
  (`statusOverride: diverted`) is read directly by the dispatcher. Gate,
  terminal and status alone count as significant.
- **Status checkpoints:** `smartCheckSchedule` now checks at T−24 h, T−3 h,
  then every 15 minutes before departure (the older checkpoints stay).
- **Reminders:** the 24 h and 2 h reminders also go to the phone, per device
  switch.
- The dispatcher (`notifications/dispatcher.ts`) is the single entry point
  (`notifyFlightChanged`, `notifyReminder`); further event kinds are a small
  addition later.

### D7 — Failure behaviour

A push problem never fails the status job or the reminder run.

- Relay calls have a bounded timeout (8 s); `sendToRelay` never throws and
  returns one of `sent`, `token-invalid`, `paused`, `disabled`, `failed`.
- `410` removes that device's `DevicePush` row.
- `429` pauses all pushing until the relay's `Retry-After`.
- Other errors (including `401`, `403`, `502`, timeouts) drop the message and
  are logged; there is no retry loop.
- The dispatcher catches and logs everything it does.

### D8 — AeroAPI is the first provider when a key exists

`services/aeroapiLookup.ts` (FlightAware AeroAPI) is tried first when a key is
resolvable, then the previous order. It selects the leg that matches the
planned departure.

## Consequences

- Without push, an app without permission or a relay outage, behaviour is the
  old one: local reminders and detection on app open.
- Flight status costs more provider calls (about 18 per flight with the new
  checkpoints); AeroAPI Personal is nearly free, AeroDataBox's free tier covers
  only a few flights per month.
- The privacy policy, the Companion wiki, the admin docs and the admin UI must
  all state what the relay receives (D4, D5).

## Known limits

- The AeroAPI mapping is tested against a fixture derived from the
  documentation. It must be checked against a real recorded response before
  anyone relies on it.
- Not verified end to end: the full path to a real phone needs the owner's APNs
  and FCM keys, the live relay and the app part (companion#41).
- A self-hosted relay needs its own app keys (D1).
- MIUI may delay or drop FCM messages for apps without Autostart.

## Not in scope

Web push for browsers, UnifiedPush/ntfy, provider push alerts, push for
imports or inbox suggestions.
