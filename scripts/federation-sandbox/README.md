# Isolated two-instance federation driver

This is test code, never an application route or public service. It runs the actual
comparison peer router, Prisma services and frontend Web Crypto implementation in two
independent Node processes/databases. Client crypto runs in the QA driver for this transport
test; browser key persistence/consent has a separate browser test. It is not a full-server
image deployment or a multi-host/public-Internet test.

## Requirements and containment

- Dedicated sandbox VM with Docker, OpenSSL, a Node 22 image containing the backend's locked
  dependencies and a fresh PostgreSQL database for each instance. Never use a populated
  application database. Both database names must start with `federation_sandbox_`.
- A Docker `--internal` network with **no published ports**, two test hostnames
  `alpha.federation.test` and `beta.federation.test`, and an additional hostname
  `wrong.federation.test` resolving to beta. Do not modify real DNS.
- Use addresses inside that isolated network which pass `publicAddress()`. In the measured
  run a dedicated `11.40.0.0/24` internal network was used. This is public address space:
  **never route it externally, connect the containers to another network or reuse it on a
  normal LAN**. There is no production SSRF exception, mocked DNS, or disabled TLS checking.
- Generate a short-lived, sandbox-only CA and distinct TLS certificates with the respective
  DNS SANs. The wrong hostname must NOT appear in beta's certificate. Generate separate
  Ed25519 instance signing keys. Private keys stay in a private sandbox directory, mode 0600.
- `NODE_EXTRA_CA_CERTS` points to the **public** test CA certificate inside each container.
  Do not install the CA system-wide or set `NODE_TLS_REJECT_UNAUTHORIZED=0`.

## Build and launch

From the repository root, after installing locked dependencies and generating Prisma:

```sh
backend/node_modules/.bin/esbuild scripts/federation-sandbox/server.ts \
  --bundle --platform=node --format=cjs --packages=external --outfile=/private-qa/server.cjs
```

Create each fresh schema using the branch's normal migrations. A schema-only dump from an
already migrated **isolated test database** also works; do not copy real data. Mount the
bundle at `/app/backend/qa-server.cjs` beside that image's `node_modules`, not just in an
unrelated directory: Prisma's dynamic package import needs normal module resolution.

For each new container set:

```text
FEDERATION_SANDBOX=1
NODE_ENV=test
SANDBOX_PUBLIC_ORIGIN=https://alpha.federation.test    # beta in the second process
SANDBOX_KEY_FILE=/qa/alpha/peer.key                    # written into the sandbox DB's instance settings
QA_KEYS=/qa/alpha                                      # contains tls.key and tls.crt
NODE_EXTRA_CA_CERTS=/qa/ca.crt
DATABASE_URL=<dedicated sandbox database URL>
```

Run `node /app/backend/qa-server.cjs`, with no application entrypoint, published ports or
existing application volumes. Wait for `FEDERATION_SANDBOX_READY` in both logs. Start only
new QA containers; this procedure does not authorize replacing any running instance.
The control port binds **container loopback only**, and is reached using `docker exec`.

Name the containers `travstats-federation-40-alpha-<run>` and
`travstats-federation-40-beta-<run>`. On the VM:

```sh
FEDERATION_QA_RUN=<run> python3 run.py
```

The runner prints only test names, results, byte counts and elapsed time. It transfers public
keys/fingerprints independently through its control channel. No private key, recovery code,
credential or travel content is printed. All account data is synthetic. The runner changes
its own grants/devices/peer state, so a new run needs freshly started QA processes and test
accounts. Stop only these owned QA containers after testing; retain the private databases
and certificates until deliberate cleanup. Do not apply blanket Docker cleanup commands.

## Measured 2026-10-13

Node 22.23.3; two instances and two separate databases on one sandbox VM. All 13 checks in
`run.py` passed. A 32 MiB publication (128 chunks) published and decrypted in 12.46 seconds,
with matching SHA-256. This is a laboratory observation, not a throughput promise.

The first run exposed a real transport bug: automatic address-family selection requested an
array from the pinned lookup callback, which returned one address. `exchange()` now sets the
selected address family and disables automatic reselection. A real Node/TLS regression test
covers this without weakening DNS/IP pinning or hostname verification. See
[Node's socket connection options](https://nodejs.org/api/net.html#socketconnectoptions-connectlistener).

The initial driver also needed its bundle mounted beside dependencies; that was a test
packaging failure. Neither failed run is counted as a pass. The final passing run used the
corrected transport and ordinary certificate verification.
