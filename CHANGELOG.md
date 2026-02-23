# Changelog

All notable changes to TravStats are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html)

## [1.0.1] - 2026-02-23

### Added
- Prettier formatter for frontend TypeScript/TSX/CSS (`format` and `format:check` scripts)
- ts-prune dead code detection scripts in frontend and backend (`dead-code` script)
- Vitest coverage reporting with v8 provider and regression thresholds (`test:coverage` script)
- ruff.toml Python linter config; auto-fixed 220 issues in training scripts
- bandit security config (`.bandit.yml`) for Python script scanning
- License whitelist (`LICENSE_WHITELIST.txt`) covering all project dependencies
- Pre-commit hooks: trailing whitespace, YAML/JSON validation, secret detection, ruff, Prettier
- GitHub Actions CI workflow: backend (typecheck + lint + test with Postgres), frontend (typecheck + lint + format + coverage), Python (ruff + bandit)
- Dev setup scripts (`scripts/setup-dev.sh` and `scripts/setup-dev.ps1`) for onboarding
- Smoke test script (`scripts/smoke-test.sh`) for post-deploy verification

### Changed
- Docker security hardening: `cap_drop: ALL` + minimal `cap_add`, `no-new-privileges`, log rotation, and resource limits on `app`, `db`, and `ollama` services

### Fixed
- Removed unnecessary `CAP_SETUID`/`CAP_SETGID` from app container (root can setuid without them)
- Corrected pre-commit prettier hook entry to properly forward filenames (`npx --prefix frontend prettier --write`)
- Removed dead coverage config block from `vite.config.ts` (shadowed by `vitest.config.ts`)

## [1.0.0] - 2026-02-23

### Added
- Initial stable release
- Flight tracking with map visualization (Leaflet, 3D Globe)
- Statistics dashboard (distance, time, routes, heatmaps)
- Achievements & Gamification system (20+ badges)
- Boarding pass scanner (QR/Barcode + OCR via Tesseract.js)
- Email booking import (manual upload + IMAP polling)
- Flight data lookup (AirLabs API integration)
- OpenFlights airport database (~14.000 airports)
- Export: CSV, GeoJSON, KML
- Tags & Categories (business/private)
- Cost tracking per flight
- Dark/Light mode
- Multi-language support (DE/EN)
- LLM-powered parsing (Ollama integration)
- LoRA fine-tuning pipeline for email/boarding-pass models
- Pre-training data quality analysis (checkTrainingData.py)
- Post-training model evaluation (evalModel.py)
- Training metrics parsing (loss, steps, epochs)
- Docker deployment with nginx + supervisor
- JWT authentication with secure cookie handling
