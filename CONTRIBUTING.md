# Contributing to TravStats

## Branches

| Branch | Purpose |
|--------|-------|
| `Main` | Stable production base — only via PR |
| `feature/...` | New features |
| `fix/...` | Bug fixes |
| `chore/...` | Infrastructure, deps, refactoring without feature impact |

## Workflow

1. Create a branch from `Main`
2. Commit changes (Conventional Commits, see below)
3. Run build checks locally: `npm run typecheck && npm run lint`
4. Open a PR against `Main` — CI must be green
5. No merge without review and green CI

## Commit Format (Conventional Commits)

```
<type>: <kurze Beschreibung>

[optionaler Body]
```

| Type | When |
|------|------|
| `feat` | New feature |
| `fix` | Bug fix |
| `chore` | Build, CI, deps (no feature/fix) |
| `docs` | Documentation only |
| `refactor` | No feature, no fix — code structure |
| `perf` | Performance improvement |
| `test` | Add/correct tests |
| `ci` | CI/CD changes |

Examples:
```
feat: Email-Import als primären Tab in Flug-hinzufügen-Modal
fix: authStore 401-Handler nach Store-Hydration wiederherstellen
chore: Abhängigkeiten auf aktuelle Versionen aktualisiert
```

## Versioning

Semantic Versioning: `MAJOR.MINOR.PATCH[-prerelease]`

- **MAJOR** — Breaking changes (API, DB schema)
- **MINOR** — New features, backwards compatible
- **PATCH** — Bug fixes

Compute a suggestion: `bash scripts/suggest-next-version.sh`

## Release Process

1. Set `backend/VERSION` to the new version
2. Update `CHANGELOG.md` — Unreleased → `[VERSION] - YYYY-MM-DD`
3. Update the version field in `package.json` (root + frontend + backend)
4. Commit: `chore: bump version to X.Y.Z`
5. Tag: `git tag vX.Y.Z && git push origin vX.Y.Z`
6. The `release.yml` workflow starts automatically (CI → Docker → GitHub Release)

## Code Standards

See [CLAUDE.md](CLAUDE.md) for the full rules.
Short version: no `any`, Pino instead of `console.log`, immutability, Zod for validation.

## Security

Please do **not** report security vulnerabilities as a public issue.
Instead, contact the maintainer directly.
