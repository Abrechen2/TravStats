# Contributing to TravStats

Thanks for your interest in TravStats. This is a solo-maintained side project,
so please set expectations accordingly: response times can vary, and the scope
is intentionally focused on what small households and groups actually need.
That said, contributions, bug reports and feature ideas are genuinely welcome.

---

## Reporting bugs

Use the **Bug Report** template on the
[issue tracker](https://github.com/Abrechen2/TravStats/issues/new/choose).

For functional bugs, the fastest way to a fix is to include the anonymised
diagnostic bundle:

1. In the app, click the **Bug** button in the top navigation
2. Click **Report Bug** — this copies a sanitised JSON bundle and opens a
   pre-filled issue form
3. Paste the bundle into the *Diagnostic Bundle* section

The bundle contains: recent log tails, settings (no credentials), per-status
flight counts, and system info. IPs, emails, tokens and UUIDs are redacted
server-side.

## Suggesting features

Use the **Feature Request** template. Please explain the use case first —
"what are you trying to do?" — before the implementation detail. Many ideas
turn out to already be on the [roadmap](ROADMAP.md).

## Security vulnerabilities

Please report privately via
[GitHub Security Advisories](https://github.com/Abrechen2/TravStats/security/advisories/new)
**before** opening a public issue.

---

## Pull requests

Small, focused PRs land fastest. For anything larger than a bug fix or a
trivial feature, open an issue first so we can align on approach.

### Workflow

1. Fork the repo, create a branch from `Main`
   - `feature/<short-name>` for features
   - `fix/<short-name>` for bug fixes
   - `chore/<short-name>` for build/deps/refactor
2. Make your change
3. Run local checks (must pass):
   ```bash
   cd backend  && npx tsc --noEmit && npm run lint
   cd frontend && npx tsc --noEmit && npm run lint && npx vitest --run
   ```
4. Commit using [Conventional Commits](https://www.conventionalcommits.org/):
   ```
   feat: add CSV bulk import for manual flights
   fix: authStore 401 handler survives store hydration
   chore(deps): bump prisma to 5.20
   ```
   Accepted types: `feat`, `fix`, `chore`, `docs`, `refactor`, `perf`, `test`, `ci`.
5. Open a PR against `Main` with a short summary and screenshots for UI changes
6. CI must be green — one review round, then merge

### What makes a PR easy to merge

- Scope kept tight — one logical change per PR
- Tests for new logic (Vitest on the frontend, Jest on the backend)
- No `any` in TypeScript — use `unknown` + type guards
- User-facing strings added in both German and English (`frontend/src/i18n`)
- New dependencies justified in the PR description

---

## Local development

```bash
# Install everything
npm run install:all

# Start backend (:8000) + frontend (:3000) together
npm run dev

# Backend only
npm run dev:backend

# Frontend only
npm run dev:frontend
```

Full developer reference: [CLAUDE.md](CLAUDE.md).

---

## Code style (short version)

- TypeScript `strict: true`, ESLint + Prettier (printWidth 100, double quotes)
- `unknown` instead of `any`; cast via type guards
- `async / await`, never `.then()`
- Pino structured logging, never `console.log`
- Immutability: spread copies, never mutate
- Zod schemas for all API input

---

## License

By contributing you agree that your contributions are licensed under
**AGPL-3.0-or-later**, the same licence as the project.
