# TravStats on Unraid

`travstats.xml` is a Community Apps-compatible template. This page covers
installation order, dependency containers, and submission to the CA feed.

## Install on an existing Unraid box

TravStats is a single-container app but **requires** a separate PostGIS
database. A local Ollama LLM container is optional but recommended for email
import.

### 1. Install PostGIS

1. **Apps** tab → search **PostGIS** (or `postgis/postgis`)
2. Install with:
   - **Container name:** `travstats-db`
   - `POSTGRES_DB` = `flights`
   - `POSTGRES_USER` = `flights`
   - `POSTGRES_PASSWORD` = *(strong — `openssl rand -base64 32`)*
   - Persistent volume mapped to `/mnt/user/appdata/travstats-db`

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
3. *(Optional)* If you installed Ollama, set `OLLAMA_URL=http://ollama:11434`
4. Apply. When the container is healthy, open
   `http://<unraid-ip>:<port>/setup` — the first-run wizard captures
   instance name, public URL, user cap and registration mode. Everything
   else (API keys, backup schedule, WebDAV, Ollama model) is configurable
   from the admin UI later.

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
