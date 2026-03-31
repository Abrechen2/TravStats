# Contributing to TravStats

## Branches

| Branch | Zweck |
|--------|-------|
| `Main` | Stabile Produktionsbasis — nur via PR |
| `feature/...` | Neue Features |
| `fix/...` | Bugfixes |
| `chore/...` | Infrastruktur, Deps, Refactoring ohne Feature-Impact |

## Workflow

1. Branch von `Main` erstellen
2. Änderungen committen (Conventional Commits, s.u.)
3. Build-Checks lokal ausführen: `npm run typecheck && npm run lint`
4. PR nach `Main` öffnen — CI muss grün sein
5. Kein Merge ohne Review und grünes CI

## Commit-Format (Conventional Commits)

```
<type>: <kurze Beschreibung>

[optionaler Body]
```

| Type | Wann |
|------|------|
| `feat` | Neues Feature |
| `fix` | Bugfix |
| `chore` | Build, CI, Deps (kein Feature/Fix) |
| `docs` | Nur Dokumentation |
| `refactor` | Kein Feature, kein Fix — Code-Struktur |
| `perf` | Performance-Verbesserung |
| `test` | Tests hinzufügen/korrigieren |
| `ci` | CI/CD-Änderungen |

Beispiele:
```
feat: Email-Import als primären Tab in Flug-hinzufügen-Modal
fix: authStore 401-Handler nach Store-Hydration wiederherstellen
chore: Abhängigkeiten auf aktuelle Versionen aktualisiert
```

## Versionierung

Semantic Versioning: `MAJOR.MINOR.PATCH[-prerelease]`

- **MAJOR** — Breaking Changes (API, DB-Schema)
- **MINOR** — Neue Features, rückwärtskompatibel
- **PATCH** — Bugfixes

Vorschlag berechnen: `bash scripts/suggest-next-version.sh`

## Release-Prozess

1. `backend/VERSION` auf neue Version setzen
2. `CHANGELOG.md` aktualisieren — Unreleased → `[VERSION] - YYYY-MM-DD`
3. `package.json` (root + frontend + backend) version-Feld aktualisieren
4. Commit: `chore: bump version to X.Y.Z`
5. Tag: `git tag vX.Y.Z && git push origin vX.Y.Z`
6. `release.yml` Workflow startet automatisch (CI → Docker → GitHub Release)

## Code-Standards

Siehe [CLAUDE.md](CLAUDE.md) für vollständige Regeln.
Kurzfassung: kein `any`, Pino statt `console.log`, Immutability, Zod für Validierung.

## Sicherheit

Sicherheitslücken bitte **nicht** als öffentliches Issue melden.
Stattdessen direkt an den Maintainer.
