# Encrypted sharing and server connections — DEV forgejo#40

Branch: `dev/federation-40`. Experimental, beta-gated; no deployment.
The current implementation is **device-encrypted protocol v2**. See
[FEDERATION_E2E.md](FEDERATION_E2E.md) for the trust model, complete travel-data coverage,
key recovery, capacity limits and validation. It supersedes the previous v1 implementation:
plaintext friend/group reads are disabled, and groups may explicitly share full data.

## Enable in a DEV environment

Apply the Prisma migrations through the normal DEV workflow. Enable the instance beta flag.
The UI entry is `/encrypted-share` under Tools, behind the beta key `encryptedShare`, in German and English. It requires an authenticated
cookie session; personal API tokens are rejected. Browser crypto requires HTTPS or localhost.
First create a device key and save its encrypted backup and recovery code separately.

Cross-instance communication needs a server identity. Since 2026-10-16 an admin sets it in
**Admin → Instanz → Server-Verbindungen** (origin, key generated in the UI, peers pinned there).
The `FEDERATION_*` environment variables are no longer read. An install that still carries
them has them copied into these settings once, on the first start of this version (only where
the settings are still empty).

### Servers on one LAN: `FEDERATION_PRIVATE_PEERS`

By default a peer is a public `https://host` origin (no port) reached only at public addresses.
An operator whose servers share a network opts in with an environment variable (deployment
setting, like a port; honoured in production too), a comma-separated CIDR list:

```
FEDERATION_PRIVATE_PEERS=192.168.178.0/24,fd00::/8
```

With it set, a peer origin (connection file, QR, admin pin, envelope) and this server's own
origin may be `http://192.168.178.187:3010`: http and explicit ports are allowed, an IP literal
must lie in a listed range, and a DNS name must resolve only to listed or public addresses.
Plain http or an explicit port is used only when every answer is in a listed (non-public)
range; a name with a public answer needs https on port 443. Loopback, link-local (169.254.169.254 included), unspecified and multicast stay
refused even if a CIDR covers them. An invalid entry is ignored with a boot warning; the list is
logged once. Signatures, key pinning, nonces and admission are unchanged. Unset = no change.

Generate the server's Ed25519 private key on the target host with `openssl genpkey -algorithm
ED25519`, writing it to the absolute configured path with mode 0600, outside uploads/database
backups. Never print, share or commit it. Deployment and any restart require the owner's
separate approval. This task performed neither.

Admins mutually pin server public keys and independently compare their fingerprints. Users
then connect via single-use invitations and comparison codes. Separately, each recipient's
DEVICE fingerprint must be independently verified in the browser before publishing. A server
key is not a device key; server admission alone does not authenticate someone's device.

Plain HTTP, private/loopback/link-local peer destinations, redirects and unverified peers are
rejected. Do not weaken the network policy for LAN testing. Same-instance comparisons work
without network federation. For remote tests use admitted public HTTPS DEV servers with
synthetic data. Original production data is unnecessary.

The cookie UI API is `/api/v1/encrypted-share`; encrypted publication routes are nested under
`/sealed`. The friend leaderboard at `/compare` is a separate feature (spec 2026-10-16) and needs
no device keys. The signed server peer API is `/api/v1/comparison-peer`. No public user directory.
The source-data/file endpoints are owner-only; they never let a friend fetch plaintext.

The supported restore hook revokes grants/links/devices, disables peers and deletes ciphertext.
Manual SQL/machine restores must suspend federation and re-enrol peers/devices before access.
The hook cannot intercept external restore tools. Device recovery material lives with users,
not in the server database backup.

## Isolated federation verification

The [two-instance sandbox driver](../scripts/federation-sandbox/README.md) exercises the real
HTTPS peer protocol in an egress-isolated lab, with separate databases and a private test CA.
It found the Node 22 DNS callback issue now fixed in `exchange()`. See
[FEDERATION_E2E.md](FEDERATION_E2E.md#validation-in-this-task) for measured checks and remaining
limits. The UI additionally provides local QR-image fingerprint verification and an owner-only
sharing overview. No deployment to an existing instance follows from these test results.

A dev server without `SECRETS_DIR` tries to write its encryption key to `/app/data/secrets`; set `SECRETS_DIR`, otherwise the federation key no longer decrypts after a restart.
