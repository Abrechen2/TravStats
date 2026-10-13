# Friend comparisons — DEV forgejo#40

Branch: `dev/federation-40`. Experimental, beta-gated; no deployment.
The current implementation is **device-encrypted protocol v2**. See
[FEDERATION_E2E.md](FEDERATION_E2E.md) for the trust model, complete travel-data coverage,
key recovery, capacity limits and validation. It supersedes the previous v1 implementation:
plaintext friend/group reads are disabled, and groups may explicitly share full data.

## Enable in a DEV environment

Apply the Prisma migrations through the normal DEV workflow. Enable the instance beta flag.
The UI entry is `/comparison` under More, in German and English. It requires an authenticated
cookie session; personal API tokens are rejected. Browser crypto requires HTTPS or localhost.
First create a device key and save its encrypted backup and recovery code separately.

Cross-instance communication additionally requires this on each server (examples only):

```dotenv
FEDERATION_ENABLED=1
FEDERATION_PUBLIC_ORIGIN=https://travstats.example.org
FEDERATION_KEY_FILE=/secure/travstats/federation-ed25519.pem
```

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

The cookie UI API is `/api/v1/comparison`; encrypted publication routes are nested under
`/sealed`. The signed server peer API is `/api/v1/comparison-peer`. No public user directory.
The source-data/file endpoints are owner-only; they never let a friend fetch plaintext.

The supported restore hook revokes grants/links/devices, disables peers and deletes ciphertext.
Manual SQL/machine restores must suspend federation and re-enrol peers/devices before access.
The hook cannot intercept external restore tools. Device recovery material lives with users,
not in the server database backup.
