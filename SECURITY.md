# Security — TravStats

**Last audit:** 2026-04-13
**Scope:** Full-stack (Express/TypeScript backend + React/Vite frontend), Docker deployment behind reverse proxy
**Approach:** Black-box pentest + full-source code review — all discovered findings mitigated prior to release.

---

## Current Status

| Measure | Status |
|---------|--------|
| Authentication (JWT HttpOnly cookie) | OK |
| Rate limiting (15 distinct limiters) | OK |
| Input validation (Zod on all endpoints) | OK |
| CORS (same-origin only) | OK |
| SQL injection protection (Prisma ORM) | OK |
| XSS protection (React + Helmet CSP) | OK |
| CSRF protection (SameSite=Strict cookie) | OK |
| Security headers (Helmet + nginx) | OK |
| Secrets management (.env, encrypted at rest) | OK |
| Dependency vulnerabilities (npm audit) | OK (0 vulnerabilities) |
| Shell injection protection (spawn, no exec) | OK |
| nginx server_tokens off | OK |
| Dotfile access blocked (nginx) | OK |

---

## Security Architecture

### Authentication

- JWT stored in **HttpOnly cookie** (not localStorage, not Bearer header)
- `SameSite=Strict`, `Secure` auto-detected via `X-Forwarded-Proto`
- Cookie max age: 7 days
- Bearer header fallback **removed** to prevent XSS extraction
- Force-change-password token delivered via separate HttpOnly cookie

### Authorization

- All API routes behind `authenticate` middleware
- Admin routes additionally behind `requireAdmin` middleware
- User isolation: all queries include `WHERE userId = :userId`
- Deactivated accounts cannot authenticate (checked on every request)

### Rate Limiting

| Endpoint | Limit | Key |
|----------|-------|-----|
| Auth (login, register) | 10 / 15 min | IP |
| Password reset | 5 / 15 min | IP |
| Flight creation | 20 / hour | IP |
| Flight lookup (external API) | 30 / 15 min | IP |
| Batch creation | 50 / hour | userId or IP |
| Email/PDF/boarding pass parse | 10-20 / 15 min | userId or IP |
| Stats calculation | 30 / min | userId or IP |
| Admin export | 5 / hour | userId or IP |
| Backup restore | 3 / hour | userId or IP |
| Settings | 60 / 15 min | userId or IP |
| File uploads | 30 / hour | IP |
| Analytics events | 100 / 15 min | IP |
| Global API | 10,000 / 15 min | IP |
| Setup initialize | 10 / 15 min | IP |

### Input Validation

- **Zod schemas** on all auth endpoints (login, register, password reset)
- **Zod schemas** on flight creation, update, and query parameters
- **Typed schemas** on pending-update preview and apply endpoints
- **Whitelisted event types** on analytics endpoint
- **Length-bounded** invitation tokens (max 128 chars)
- **Regex-validated** route colors (`/^#[0-9a-fA-F]{3,8}$/`)
- **Scheme-restricted** profile picture URLs (http/https only)
- Body size limits: JSON max size via `express.json({ limit })`, payload checks in Zod

### Secrets & Encryption

- API keys (AirLabs, Aviationstack, OpenSky) encrypted at rest via `encryptApiKey()`
- SMTP password encrypted at rest via `encryptApiKey()`
- JWT secret from environment variable
- No hardcoded secrets in source code
- `.env` file gitignored
- Docker deployment: secrets volume, not env vars in compose

### Backup Security

- Backup download: path-containment check against `BACKUP_BASE_DIR`
- Backup restore: `targetDatabaseUrl` removed from API (server-side env only)
- Database dump: `spawn()` with argument arrays (no shell injection)
- Backup restore rate limited (3/hour)

### nginx

- `server_tokens off` (no version disclosure)
- Security headers on all static responses (X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy)
- Dotfile access blocked (`location ~ /\. { deny all; }`)
- API headers handled exclusively by Helmet (no duplication)
- Source map requests return 204 (no source code exposure)
- SPA fallback via `try_files` (no directory listing)

### Logging & Monitoring

- Security events logged with Pino (structured JSON)
- Failed auth attempts: IP, user-agent, URL, reason
- Invalid tokens: logged with context
- Admin access denials: logged with userId
- No sensitive data in logs (passwords, tokens filtered)
- Log files in `data/logs/` (app.log, error.log, http.log)

---

## Audit History

| Date | Scope | Summary |
|------|-------|---------|
| 2026-04-13 | Black-box pentest + code review | 22 findings — all CRITICAL/HIGH mitigated; remaining items accepted by design (see below) |
| 2026-04-12 | Code review + dependency audit | 32 findings — all mitigated |
| 2026-04-06 | Initial black-box + code review | All findings mitigated before release |

Detailed per-finding reports are kept internally to avoid providing an attack roadmap for already-mitigated issues. Verification commands below let anyone reproduce the current hardened state against their own deployment.

### Accepted Items (by design)

| Area | Reason |
|------|--------|
| Temporary admin-reset password in API response | Required for self-hosted instances without outgoing SMTP |
| Leaderboard usernames visible to signed-in users | Intentional — shared tracker for small trusted groups |
| TLS termination | Delegated to the operator's reverse proxy (nginx/Caddy/Traefik); app is LAN-only HTTP by default |

---

## Tested Attack Vectors — No Vulnerability Found

| Attack | Result |
|--------|--------|
| SQL injection (login, register, flight fields) | Blocked — Prisma parameterized queries |
| NoSQL injection (JSON objects in string fields) | Blocked — Zod type validation (400) |
| XSS in username/password/flight fields | Blocked — Zod + React auto-escaping |
| JWT alg:none / signature forgery | Blocked — returns 401 |
| JWT via Bearer header | Blocked — only HttpOnly cookie accepted |
| Cookie injection (userId, isAdmin) | Blocked — only `auth_token` cookie used |
| Mass assignment (isAdmin:true in login) | Blocked — Zod ignores unknown fields |
| CORS cross-origin (evil.com) | Blocked — no Access-Control headers |
| Path traversal (`../../etc/passwd`) | Blocked — nginx normalizes, 404 |
| HTTP TRACE/TRACK | Blocked — 405 Not Allowed |
| Open registration | Blocked — requires invitation token |
| Force re-setup | Blocked — 404 after initial setup |
| X-Forwarded-For rate limit bypass | Not effective — proper IP extraction |
| Host header injection on password reset | Not vulnerable — Zod validation |
| Oversized payload (100KB+) | Blocked — body limit + rate limit |
| Username enumeration via login timing | Protected — bcrypt always runs (dummy hash) |
| Password reset user enumeration | Protected — generic response |
| Directory fuzzing (30k+ paths) | No hidden endpoints or leaked files |
| Nuclei automated scan | Zero findings |
| WAF detection (wafw00f) | No WAF needed — LAN-only service |

---

## Verification Commands

```bash
TARGET="http://localhost:3000"   # replace with your deployment URL

# Health check (no version leak)
curl -s $TARGET/health

# Security headers on static assets
curl -sI $TARGET/assets/js/index-*.js | grep -iE "x-frame|x-content|referrer|permissions"

# Security headers on API
curl -sI $TARGET/api/v1/flights | grep -iE "x-frame|x-content|csp|hsts|referrer"

# Dotfile access blocked
curl -sI $TARGET/.env          # should be 403 Forbidden
curl -sI $TARGET/.git/config   # should be 403 Forbidden

# Auth required on all endpoints
curl -s $TARGET/api/v1/flights                # 401
curl -s $TARGET/api/v1/admin/users            # 401
curl -s $TARGET/api/v1/settings               # 401

# JWT alg:none rejected
curl -s $TARGET/api/v1/flights \
  -H 'Cookie: auth_token=eyJhbGciOiJub25lIn0.eyJ1c2VySWQiOjF9.' # 401

# Bearer header rejected
curl -s $TARGET/api/v1/flights \
  -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOjF9.fake' # 401

# CORS: no cross-origin headers for foreign origins
curl -sI $TARGET/api/v1/flights -H 'Origin: https://evil.com' | grep -i access-control
# (should return nothing)

# Rate limiting active
curl -sI $TARGET/api/v1/flights | grep -i ratelimit

# HTTP methods blocked
curl -sI -X TRACE $TARGET/    # 405
curl -sI -X OPTIONS $TARGET/  # 405

# Registration disabled
curl -s -X POST $TARGET/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"test","password":"Test1234!"}' # 403

# Setup already complete
curl -s $TARGET/api/v1/setup/status # setupComplete: true

# nginx version hidden
curl -sI $TARGET/ | grep -i server  # "Server: nginx" (no version)

# npm audit clean
cd backend && npm audit
cd frontend && npm audit

# Port scan against your own deployment
nmap -sV -p- --open <your-host>
# Expected for a default deploy: HTTP port of the container only
```

---

## Reporting Vulnerabilities

If you discover a security issue, please report it privately via
[GitHub Security Advisories](https://github.com/Abrechen2/TravStats/security/advisories/new).
Include: affected endpoint, reproduction steps, and potential impact.

**Do not** open a public issue for security vulnerabilities.
