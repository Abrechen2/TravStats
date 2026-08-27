# TravStats on Unraid

Community Apps templates for TravStats live in their own dedicated repo
(Unraid CA submission rules require it):

👉 **[github.com/Abrechen2/docker-templates](https://github.com/Abrechen2/docker-templates)**

Two XMLs are published from there. The `my-` prefix is Unraid's convention
for user-added templates and is part of the filename:

- [`my-travstats.xml`](https://raw.githubusercontent.com/Abrechen2/docker-templates/main/my-travstats.xml)
- [`my-travstats-db.xml`](https://raw.githubusercontent.com/Abrechen2/docker-templates/main/my-travstats-db.xml)

This page covers install order, dependency containers, and how the templates
reach the CA feed.

## Install on an existing Unraid box

TravStats is a single-container app but **requires** a separate PostGIS
database. A local Ollama LLM container is optional but recommended for email
import.

Both containers sit on the default `bridge` network and talk **through the
Unraid host**, not to each other directly: the TravStats template ships
`--add-host=host.docker.internal:host-gateway`, and every cross-container
address below is `host.docker.internal:<published-port>`. Docker's default
bridge has no DNS, so container names such as `travstats-db` do **not**
resolve — that is why the database must publish its port on the host.

### 1. Install PostGIS

Use our companion template
[`my-travstats-db.xml`](https://raw.githubusercontent.com/Abrechen2/docker-templates/main/my-travstats-db.xml)
(**Apps** tab → search **travstats-db**) — it pre-fills the container name,
DB name, user and the published host port `5432`, so the default
`DATABASE_URL` in the TravStats template matches without extra editing. Just
pick a strong password (`openssl rand -base64 32`) and keep it for step 3.

If you prefer to install PostGIS manually instead, use image
`postgis/postgis:15-3.4` with:
- **Container name:** `travstats-db`
- `POSTGRES_DB` = `flights`
- `POSTGRES_USER` = `flights`
- `POSTGRES_PASSWORD` = *(strong — `openssl rand -base64 32`)*
- `PGDATA` = `/var/lib/postgresql/data/pgdata`
- Persistent volume mapped to `/mnt/user/appdata/travstats-db`
- Port `5432` **published on the host** — TravStats connects through it

Plain `postgres:15` does **not** work — TravStats migrations require the
PostGIS spatial extension.

### 2. (Optional) Install Ollama

1. **Apps** tab → **Ollama**
2. Persistent volume to `/mnt/user/appdata/ollama`
3. Keep port `11434` published on the host
4. Inside the container console, pull the default model:
   ```sh
   ollama pull gemma3:12b
   ```

### 3. Install TravStats

1. **Apps** tab → search **TravStats**, click **Install**
2. In `DATABASE_URL`, replace only the `CHANGEME` part with the password
   from step 1 — the rest of the prefilled value already matches the
   companion template:
   `postgresql://flights:<your-password>@host.docker.internal:5432/flights`
   *(If PostGIS publishes a different host port, adjust `:5432` to match.)*
3. Apply. When the container is healthy, open
   `http://<unraid-ip>:<port>/setup` — the first-run wizard captures
   instance name, public URL, user cap and registration mode. Everything
   else (API keys, backup schedule, WebDAV, Ollama endpoint + model) is
   configurable from **Admin → Settings** in the UI after login. On
   Unraid, point Ollama at `http://host.docker.internal:11434` from the
   admin UI if you installed the CA in step 2.

The JWT secret and encryption key are auto-generated on first boot and
persisted inside the `/mnt/user/appdata/travstats/secrets/` subdirectory
of the main data volume — one mount, no separate secrets share to worry
about.

## Template maintenance (for the maintainer)

The canonical template URLs — the ones the CA feed reads — are:

```
https://raw.githubusercontent.com/Abrechen2/docker-templates/main/my-travstats.xml
https://raw.githubusercontent.com/Abrechen2/docker-templates/main/my-travstats-db.xml
```

There are no copies of these XMLs in this repo, deliberately: two sources of
truth drift, and the drifted one is the one a stranger installs from.

### Community Apps feed

`Abrechen2/docker-templates` is **already registered** in the CA feed as
*"Abrechen2's Repository"* — no per-template PR is needed. CA re-scrapes the
repo periodically, so a pushed change to an XML reaches the store on its own
within hours; users then see it after their next Apps refresh.

To verify what CA actually serves — as opposed to what the repo says —
read the live feed rather than trusting the template:

```sh
curl -s https://raw.githubusercontent.com/Squidly271/AppFeed/master/applicationFeed.json \
  | python3 -c "import json,sys; \
      [print(a['Name'], a.get('Icon')) for a in json.load(sys.stdin)['applist'] \
       if 'travstats' in a.get('Name','').lower()]"
```

Reviewer feedback on submission, if it ever comes up again, has historically
asked to pin a specific image tag instead of `latest`, and to confirm
`Privileged=false` is enough.

### Icon

The brand mark is **vendored into the template repo** as
[`icon.svg`](https://raw.githubusercontent.com/Abrechen2/docker-templates/main/icon.svg),
byte-identical to `docs/images/logo.svg` here. Template and icon live in the
same repo on purpose — the `<Icon>` URL then cannot be broken by a
restructure of the application repo. `my-travstats-db.xml` follows the same
rule with `icon-travstats-db.svg`.

SVG is fine: around 120 of the ~4100 apps in the CA feed ship an SVG icon.
A PNG on a non-transparent background is only worth producing for looks —
the current mark is 120 × 140, so Unraid's square tile letterboxes it.

**The trap that already cost us a logo:** the `<Icon>` URL pointed at branch
`Main` on `Abrechen2/TravStats` while the default branch is `main`.
`raw.githubusercontent.com` is case-sensitive, so it returned 404 and CA
listed TravStats with no logo — silently, because nothing validates an icon
URL. After changing any URL in a template, curl it:

```sh
curl -sI -o /dev/null -w '%{http_code} %{content_type}\n' "<url>"
```
