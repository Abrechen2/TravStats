# TravStats on Unraid

Community Apps templates for TravStats live in their own dedicated repo
(Unraid CA submission rules require it):

👉 **[github.com/Abrechen2/docker-templates](https://github.com/Abrechen2/docker-templates)**

Two XMLs are published from there:

- [`travstats.xml`](https://raw.githubusercontent.com/Abrechen2/docker-templates/main/travstats.xml)
- [`travstats-db.xml`](https://raw.githubusercontent.com/Abrechen2/docker-templates/main/travstats-db.xml)

This page covers install order, dependency containers, and submission to
the CA feed.

## Install on an existing Unraid box

TravStats is a single-container app but **requires** a separate PostGIS
database. A local Ollama LLM container is optional but recommended for email
import.

### 1. Install PostGIS

Use our companion template [`travstats-db.xml`](travstats-db.xml) — it pre-fills
the container name, DB name and user so the default `DATABASE_URL` in the
TravStats template matches without extra editing. Just pick a strong password
(`openssl rand -base64 32`) and keep it for step 3.

If you prefer to install PostGIS manually instead, use image
`postgis/postgis:15-3.4` with:
- **Container name:** `travstats-db`
- `POSTGRES_DB` = `flights`
- `POSTGRES_USER` = `flights`
- `POSTGRES_PASSWORD` = *(strong — `openssl rand -base64 32`)*
- Persistent volume mapped to `/mnt/user/appdata/travstats-db`

Plain `postgres:15` does **not** work — TravStats migrations require the
PostGIS spatial extension.

### 2. (Optional) Install Ollama

1. **Apps** tab → **Ollama**
2. Persistent volume to `/mnt/user/appdata/ollama`
3. Inside the container console, pull the default model:
   ```sh
   ollama pull gemma3:12b
   ```

### 3. Install TravStats

1. **Apps** tab → search **TravStats**, click **Install**
2. Set `DATABASE_URL` to
   `postgresql://flights:<your-password>@travstats-db:5432/flights`
3. Apply. When the container is healthy, open
   `http://<unraid-ip>:<port>/setup` — the first-run wizard captures
   instance name, public URL, user cap and registration mode. Everything
   else (API keys, backup schedule, WebDAV, Ollama endpoint + model) is
   configurable from **Admin → Settings** in the UI after login. On
   Unraid, point Ollama at `http://ollama:11434` from the admin UI if
   you installed the CA in step 2.

The JWT secret and encryption key are auto-generated on first boot and
persisted inside the `/mnt/user/appdata/travstats/secrets/` subdirectory
of the main data volume — one mount, no separate secrets share to worry
about.

## Template maintenance (for the maintainer)

The canonical template URL is

```
https://raw.githubusercontent.com/Abrechen2/TravStats/main/docs/unraid/travstats.xml
```

### Submit to Community Apps

1. Fork [community-apps-templates](https://github.com/Squidly271/AppFeed)
   *(or follow the current CA submission instructions at
   <https://forums.unraid.net/topic/57181-community-applications/>)*
2. Open a PR pointing at the `travstats.xml` raw URL above
3. Respond to the reviewer's feedback — common asks are:
   - Pin a specific image tag instead of `latest` for the default (you can
     override this per-release if CA requires reproducible installs)
   - Confirm `Privileged=false` is enough
   - Provide a logo on a non-transparent background

### Icon

`docs/images/logo-large.png` is served via GitHub raw. If you need a smaller
square icon for the CA card, generate one and commit it to
`docs/unraid/icon.png`, then update the `<Icon>` URL in `travstats.xml`.
