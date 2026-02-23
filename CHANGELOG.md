# Changelog

All notable changes to TravStats are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html)

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
