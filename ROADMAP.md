# TravStats Roadmap (Stand 2025-12-05)

## Aktueller Stand
- Docker-first Deployment (PostgreSQL + App + optional Ollama) mit Setup-Wizard.
- Flights: CRUD mit Kategorien/Tags/Kosten, Kartenansicht (GeoJSON), Zusammenfassung (Fluege, Distanz, Flugzeit, Kosten) und Top-Routen. Optionaler Flight-Lookup ueber AirLabs/Aviationstack/OpenSky via API-Key.
- Imports: Boarding-Pass-Scanner, E-Mail-Upload (.eml/.msg/.txt) mit Regex-Parser und optionaler KI (Ollama). Pending-Review-Flow inkl. Dubletten-Check.
- Admin & Accounts: Invite-only Default, Admin-Panel fuer User-Status, Einladungen, JSON-Export, Max-User-Warnung.
- Gamification & Analytics: Achievements, Leaderboard, Basis-Analytics-Events (local DB).

## Kurzfristige Prio (naechste Iteration)
- Add-Flight Flow & Lookup haerten  
  - Fehlermeldungen fuer fehlende API-Keys/Rate-Limits klaeren  
  - OpenSky/Aviationstack Fallback testen/dokumentieren  
  - Mobile/LAN Tests fuer relative API-URL/CORS
- E-Mail-Import Feinschliff
  - Anleitung fuer IMAP/Webhook oder klarer Hinweis auf Upload-Flow
  - Bessere UI-States und Fehlermeldungen bei Mehrfach-Fluegen
  - Enhanced Parser Optimierungen (Optional):
    - Regex-Parser erweitern mit aircraft/seatClass patterns fuer besseren Fallback
    - LLM-Prompt-Tuning fuer hoehere aircraft/seatClass Extraktionsrate (aktuell 60%)
    - Groesseres LLM-Modell testen (qwen2.5:7b statt llama3.2:3b) fuer bessere Ergebnisse
- Deploy & Qualitaet  
  - CI-Pipeline mit Lint + Tests + Build + Container-Smoke-Test  
  - Kleine E2E/Happy-Path fuer Auth + Flight-CRUD + Import-Akzeptanz
- Daten & Performance  
  - Robustere Airport-Seeds/Lookups (Logging, Duplicate-Handling)  
  - Limits fuer GeoJSON/Map (Pagination/Cap) fuer grosse Datensaetze

## Mittelfristig
- Batch-Import (CSV/JSON) mit Mapping, Validierung und Dubletten-Erkennung.
- PDF/E-Ticket Import (Gate/Sitz/Zeit/Gebuehren) neben Boarding-Pass-Scan.
- Kosten-Features: Waehrungs-Umrechnung, Budget-Ansichten, Steuer-Kategorien.
- Mobile/PWA-Optimierungen (Service Worker, Offline-Lesen/Queue).
- Monitoring/Logging (Pino/Sentry o.a.) und automatische Backups.

## Spaeter / Nice to Have
- Sharing: Exportierbare Karten/PNGs, Jahres-Review.
- CO2/Umwelt-Module.
- Social ueber Leaderboard hinaus (Freunde/Vergleich).
- Trip-Zusammenfassungen und mehrstufige Reisen.

*Letzte Aktualisierung: 2025-12-05*
