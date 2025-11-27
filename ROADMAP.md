# TravStats Feature Roadmap

## Phase 0: Qualitätssicherung & Delivery (vor Woche 1)
*Legt die Basis für verlässliche Releases und Sicherheitsstandards*

### 🧪 0. CI/CD-Pipeline & Sicherheits-Scans
- [ ] Pipeline mit Linting, Tests, Type-Checks und Docker-Build
- [ ] Abhängigkeits-Scanning und Vulnerability-Alerts
- [ ] Secret- und JWT-Config-Checks (z. B. via Trivy/Gitleaks)
- [ ] Automatisierte Preview-Deployments für PRs


### Hotfixes (ASAP)
- [x] Backend startet nicht: Merge-Konflikte in `backend/src/routes/flights.ts` und `backend/src/services/flightLookup.ts` bereinigen, Flight-Lookup-Endpoint vereinheitlichen (Aviationstack vs. AirLabs) und Rate-Limiter wieder aktivieren.
- [ ] Auth mobil: API-Basis-URL fuer LAN-Zugriff konfigurierbar/relativ machen (`frontend/src/lib/api.ts`) und CORS/SameSite fuer mobile Clients anpassen. (Basis-URL/CORS/SameSite umgesetzt, Live-Test auf Geraeten offen)
- [x] Achievements: `checkAndUpdateAchievements` so anpassen, dass nur freigeschaltete Achievements Persistenz erzeugen (neue Nutzer starten sonst vollstaendig freigeschaltet).
- [ ] Add-Flight-Flow: Simplified-Form-Komponenten ohne Konflikte bauen, Lookup-Flow (V2) gegen den aktiven Endpoint testen und automatisierten Happy-Path-Test ergaenzen. (Konflikte behoben, Lookup/E2E-Tests fehlen)
- [x] 3D-Marker: Dedup primaer ueber IATA/ICAO (Fallback Koordinaten) und 0/0-Koordinaten filtern, um gestapelte Marker zu vermeiden (`frontend/src/components/GlobeView.tsx`).
- [x] Build-Smoketest: Kurzen `npm run build`/`npm run test`-Smoke-Check in README/CI ergaenzen, damit Backend/Frontend-Breaks sofort auffallen.
- [ ] OpenSky OAuth: Flight-Endpunkt liefert 404 trotz gueltigem Token (Client-Credentials). Korrekte OAuth-Flight-URL recherchieren oder States/Tracks-Fallback bauen, damit OpenSky als Free-Fallback funktioniert.
## Phase 1: Kern-Visualisierungen (Woche 1-2)
*Erweitert die Statistik-Seite mit wichtigen Kennzahlen*

### ✅ 1. Distanz-Visualisierung
- [x] Gesamte geflogene Distanz berechnen
- [x] Äquivalente anzeigen (Erdumrundungen, Mond-Distanz, etc.)
- [x] Durchschnittliche Distanz pro Flug
- [x] Distanz-Rangliste der längsten Strecken
- [x] Visuelle Darstellung mit Icons

### ✅ 2. Zeitbasierte Diagramme
- [x] Flüge pro Monat/Jahr als Balkendiagramm
- [x] Trend-Analyse mit Liniendiagramm
- [x] Saisonale Muster visualisieren
- [x] Wochentags-Analyse (Welcher Tag am meisten?)
- [x] Integration mit Chart.js oder Recharts

### ✅ 3. Kalender-Ansicht
- [x] Monatskalender mit Flug-Markierungen
- [x] Jahresübersicht-Kalender
- [x] Heatmap für Reiseintensität
- [x] Klickbare Tage mit Flugdetails

## Phase 2: Gamification & Achievements (Woche 3-4)
*Macht die App unterhaltsamer und motivierender*

### ✅ 4. Badges & Achievements System
- [x] Achievement-Datenmodell erstellen
- [x] 20+ verschiedene Badges definieren:
  - Weltenbummler (5+ Kontinente)
  - Vielflieger (100+ Flüge)
  - Nachtflug-König (10+ Nachtflüge)
  - Business-Traveler (50+ Business Class)
  - Marathon-Flyer (10+ Stunden Flug)
  - Wochenend-Krieger (Flüge Fr-So)
- [x] Badge-Unlock-Animation
- [x] Badge-Galerie-Seite

### ✅ 5. Flughafen-Collection
- [x] Besuchte Flughäfen sammeln
- [x] Fortschritt zu Sammlungen (z.B. "Alle deutschen Flughäfen")
- [x] Seltene Flughäfen hervorheben
- [x] Flughafen-Detailseite mit allen Besuchen

## Phase 3: Praktische Tools (Woche 5-6)
*Erhöht den praktischen Nutzen der App*

### 💰 6. Reisekosten-Tracker
- [x] Ticketpreis-Feld hinzufügen
- [x] Gesamtausgaben Dashboard
- [x] Kosten pro Airline/Strecke analysieren
- [ ] Budget-Tracking und Prognosen
- [ ] Währungsumrechnung
- [ ] Beleg-Upload (Fotos/PDF) mit OCR für Beträge
- [ ] Automatische Währungs- und Steuerkategorie-Erkennung

### ✅ 7. Automatic Flight Data Lookup (AirLabs API)
- [x] AirLabs API Integration (Free Tier: 1000 req/month)
- [x] Flight Number Lookup Service
- [x] API-Endpunkt für Flugnummer-Abfrage
- [x] Smart Flight-First UX im Add Flight Dialog
- [x] Automatisches Ausfüllen aller Flugdetails
- [x] Boarding Pass Scanner mit Online-Validierung
- [x] Dark Mode Support für Flight Form
- [x] Step-by-Step geführter Eingabeprozess
- [ ] Vielflieger-Meilen Tracking (Future Feature)

### ✅ 8. Flug-Tags & Kategorien
- [x] Tag-System implementieren
- [x] **Geschäftlich vs. Privat Tracking:**
  - Dropdown-Feld im Flugformular (Geschäftlich/Privat/Urlaub)
  - Statistik-Seite mit Aufteilung Geschäft/Privat
  - Separate Distanz-Statistiken pro Kategorie
  - Kosten-Tracking pro Kategorie (für Steuer)
- [ ] Vordefinierte Tags (Konferenz, Familienbesuch, Wochenendtrip, etc.)
- [x] Benutzerdefinierte Tags
- [x] Farb-Codierung auf Karte (Geschäft = Blau, Privat = Grün)
- [x] Filter nach Tags und Kategorien

### ✅ 9. Einstellungsseite
- [x] **Benutzer-Profil:**
  - Benutzername ändern
  - E-Mail-Adresse verwalten
  - Profilbild hochladen
  - Passwort ändern (UI vorhanden, Backend pending)
  - Account löschen (mit Bestätigung - UI vorhanden)
- [x] **Anzeige-Einstellungen:**
  - Dark/Light Mode Toggle (bereits implementiert, hier zentral steuerbar)
  - Sprache wählen (Deutsch/Englisch - UI vorhanden)
  - Zeitzone einstellen
  - Datumsformat (DD.MM.YYYY / MM/DD/YYYY / YYYY-MM-DD)
  - Zeitformat (24h / 12h AM/PM)
- [x] **Einheiten & Formate:**
  - Distanz-Einheiten (Kilometer / Meilen / Nautische Meilen)
  - Währung für Kostentracking
  - Temperatur-Einheit (Celsius / Fahrenheit)
- [x] **Standard-Werte:**
  - Standard-Status für neue Flüge (scheduled/flown)
  - Standard-Sitzklasse
  - Lieblings-Airline vorauswählen
  - Standard-Flugkategorie (Geschäft/Privat)
- [x] **Karten-Einstellungen:**
  - Standard-Kartenansicht (OpenStreetMap / Satellite)
  - Zoom-Level beim Start
  - Marker-Stil (Pin / Kreis / Custom)
  - Farb-Schema für Routen
- [x] **Benachrichtigungen:**
  - E-Mail-Benachrichtigungen aktivieren/deaktivieren (UI)
  - Flug-Erinnerungen (24h/48h vorher - UI)
  - Check-in Reminder (UI)
  - Neue Feature-Updates (UI)
- [x] **Datenschutz & Sicherheit:**
  - Zwei-Faktor-Authentifizierung (2FA - UI vorhanden)
  - Aktive Sessions anzeigen (UI vorhanden)
  - Login-Historie (UI vorhanden)
  - Daten-Export anfordern (DSGVO - UI vorhanden)
  - Daten vollständig löschen (UI vorhanden)
- [x] **Backup & Sync:**
  - Automatisches Backup aktivieren (UI)
  - Backup-Intervall einstellen (UI)
  - Export-Format-Präferenzen (UI)
  - Cloud-Sync Einstellungen (UI)

## Phase 4: Umwelt & Analysen (Woche 7-8)
*Fokus auf Nachhaltigkeit und tiefere Analysen*

### 🌱 10. CO2-Fußabdruck Tracker
- [ ] CO2-Berechnung pro Flug (nach Flugzeugtyp & Klasse)
- [ ] Gesamt-CO2-Bilanz
- [ ] Vergleich verschiedener Klassen
- [ ] Kompensations-Vorschläge
- [ ] Monatliche CO2-Trends

### 📊 11. Erweiterte Routen-Analyse
- [x] Häufigste Routen identifizieren
- [x] Route-Statistiken (Durchschnittsdauer)
- [ ] Beste Reisezeit für Routen
- [ ] Alternative Routen vorschlagen
- [ ] Multi-Leg- und Open-Jaw-Reisen mit Umsteigezeit-Prüfung (MCT)

### ✅ 12. Heatmap & Intensitäts-Visualisierung
- [x] Jahres-Heatmap (wie GitHub Contributions)
- [x] Monatliche Aktivitäts-Heatmap
- [ ] Geografische Heatmap (wo am meisten geflogen)

## Phase 5: Import & Export (Woche 9-10)
*Vereinfacht Dateneingabe und -verwaltung*

### ✅ 13. Boarding Pass Scanner (OCR)
- [x] Kamera-Integration
- [x] QR/Barcode-Scanner (PDF417, QR, Aztec, Data Matrix)
- [x] OCR für Text-Extraktion (jsQR, @zxing)
- [x] **Multi-Format Parser mit Fallback-Chain:**
  - [x] Standard IATA BCBP Format (beginnt mit 'M')
  - [x] Intelligenter Fallback-Parser (RegEx-basierte Extraktion)
  - [ ] URL-basierte Boarding Passes (Lufthansa Web-BP, Ryanair, etc.)
  - [ ] Airline-spezifische Parser (Lufthansa, Ryanair, easyJet, etc.)
- [x] **Debug-Modus:**
  - [x] Rohen gescannten Text anzeigen
  - [x] Format-Erkennung und Parsing-Methode
  - [x] Schritt-für-Schritt Parsing-Log
- [x] Online-Validierung mit Flight Lookup API (falls Flugnummer erkannt)
- [ ] **OCR-Integration für Text-basierte Boarding Passes:**
  - [ ] Tesseract.js für Text-Erkennung
  - [ ] Layout-Analyse (Spalten, Zeilen erkennen)
  - [ ] Smart Field Extraction (Label → Wert Zuordnung)
- [ ] PDF-Import von E-Tickets
- [x] Automatisches Ausfüllen des Formulars

### 📄 14. Erweiterte Export-Funktionen
- [x] CSV-Export
- [x] GeoJSON-Export
- [x] KML-Export für Google Earth
- [ ] PDF-Report Generator (aktuell nur HTML-Export als .pdf)
- [ ] Excel-Export mit Pivot-Tabellen

### 📥 15. Batch Import System
- [ ] **CSV/JSON Bulk-Import:**
  - Datei-Upload mit Drag & Drop Support
  - Template-Download für CSV-Format
  - Spalten-Mapping UI (Flexible Zuordnung der CSV-Spalten)
  - Vorschau der zu importierenden Daten (erste 10 Zeilen)
  - Progress Bar während Import
- [ ] **Validierung & Fehlerbehandlung:**
  - Strikte Schema-Validierung mit Zod
  - Duplikat-Erkennung (gleiche Flugnummer + Datum + Route)
  - Fehler-Report mit Zeilennummer und Fehlerbeschreibung
  - Partial Import (erfolgreiche Zeilen importieren, fehlerhafte überspringen)
  - Download der fehlerhaften Zeilen als CSV zur Korrektur
- [ ] **Automatische Datenanreicherung:**
  - IATA/ICAO-Autocomplete für Flughäfen
  - Automatisches Airport-Enrichment (Koordinaten, Namen)
  - Optional: Flugnummer-Lookup für fehlende Details
  - Automatische Währungsumrechnung
- [ ] **Import-Quellen:**
  - Import von anderen Apps (TripIt, MyFlightRadar24, etc.)
  - Airline-CSV-Export kompatibel (Lufthansa, Emirates, etc.)
  - Custom Format mit flexiblem Mapper
- [ ] **Post-Import:**
  - Import-Summary Dashboard (X Flüge hinzugefügt, Y übersprungen)
  - Undo-Funktion für letzten Import
  - Import-Historie mit Rollback-Möglichkeit

### 💾 16. Backup & Sync
- [ ] Automatische Backups (Backend-Logik fehlt)
- [x] Import/Export aller Daten (CSV, GeoJSON, KML)
- [ ] Versionierung
- [ ] Cloud-Sync (optional)

### Neue Importquelle: Buchungsbestaetigungs-Mail
- [ ] E-Mail-Weiterleitung an Server (dedizierte Inbox/Webhook) und MIME-Parser, der PNR/LOC, Name, Airline, Flugnummer, Datum/Zeit, Airports, Sitz/Terminal/Gate, Preis/PNR extrahiert.
- [ ] Nutzer-Zuordnung via Custom Weiterleitungsadresse für jeden Nutzer ; automatisch einen Flug-Entwurf mit den gefundenen Feldern erzeugen.
- [ ] UI-Preview: Zur Kontrolle in sonder Bereich Speichern, beim nächsten öffen dann zur review auffordern mit Popup fenster dann fehlende Felder markieren, manuell nachpflegen lassen, erst danach final speichern.

### 🔗 17. Backend-Integration für URL-basierte Boarding Passes
- [ ] **URL-Decoder Service:**
  - [ ] Lufthansa Web-BP URL-Parser (https://lh.de/bp/...)
  - [ ] Ryanair Boarding Pass Decoder
  - [ ] easyJet/Wizz Air URL-Patterns
  - [ ] British Airways/Eurowings Formate
- [ ] **Web-Scraping/API-Integration:**
  - [ ] Headless Browser für JavaScript-gerenderte Boarding Passes
  - [ ] Session-Management für authentifizierte Requests
  - [ ] Screenshot-Fallback wenn Parsing fehlschlägt
- [ ] **Sicherheit & Rate Limiting:**
  - [ ] Request-Validierung (nur bekannte Airline-Domains)
  - [ ] Rate Limiting pro User (max 10 URL-Requests/Tag)
  - [ ] Timeout-Handling (max 10s pro Request)
  - [ ] User-Agent Rotation gegen Blocking




## Phase 5.5: Daten-Anreicherung & Validierung 🆕
*Automatische Verbesserung der Datenqualität mit kostenlosen Quellen*

### ✅ 17. OpenFlights Airport Database
- [x] OpenFlights Datenbank-Import (~14.000 Flughäfen)
- [x] Automatischer Koordinaten-Lookup für IATA/ICAO
- [x] Automatischer IATA/ICAO-Lookup für Koordinaten
- [x] Nearest-Airport-Suche (Umkreis-basiert)
- [x] Airport-Enrichment bei Flug-Erstellung
- [x] API-Endpunkte für Airport-Suche und -Lookup
- [x] Duplikat-Vermeidung durch konsistente Daten

**Vorteile:**
- Löst Problem mit doppelten Markern auf der Karte
- Automatisches Ausfüllen fehlender Flughafen-Daten
- Konsistente IATA/ICAO-Codes für alle Flughäfen
- Komplett kostenlos (keine externen API-Calls)
- Schnelle lokale Lookups statt langsame externe Abfragen

**Nutzung:**
```bash
# Einmalig: OpenFlights-Datenbank importieren
npm run seed:airports:openflights

# Danach werden alle neuen Flüge automatisch angereichert
```

### 📊 18. Daten-Validierung & Korrektur
- [x] Automatische Enrichment-Pipeline in Flug-Erstellung
- [x] Koordinaten-zu-Airport-Matching (5km Radius)
- [x] IATA/ICAO-Normalisierung
- [ ] Batch-Update für bestehende Flüge
- [ ] Duplikat-Erkennung bei Import
- [ ] Fuzzy-Matching für Flughafen-Namen
- [ ] Validierungs-Report für inkonsistente Daten

## Phase 6: Sharing & Social (Woche 11-12)
*Teilen und vergleichen mit anderen*

### 🎨 19. Flugkarten-Generator
- [ ] Schöne Share-Grafiken erstellen
- [ ] Jahresrückblick-Karten
- [ ] Animierte Routen-Videos
- [ ] Social Media Templates
- [ ] Download als PNG/SVG

### 🌐 20. Trip-Zusammenfassung
- [ ] Mehrere Flüge zu Reisen gruppieren
- [ ] Reise-Timeline
- [ ] Notizen und Fotos zu Reisen
- [ ] Reiseberichte erstellen
- [ ] Multi-Leg-Ketten mit Segment-Details und realistischen Umsteigezeiten
- [ ] Abo-Benachrichtigungen für neue Routentrends oder Preisalarme

### 👥 21. Freunde-Vergleich (Optional)
- [ ] Freunde hinzufügen
- [x] Leaderboards (in Achievement-System vorhanden)
- [ ] Gemeinsame besuchte Orte
- [ ] Wettbewerbe/Challenges

## Phase 7: Mobile & PWA (Woche 13-14)
*Mobile Optimierung und Offline-Fähigkeit*

### 📱 22. Progressive Web App
- [ ] Service Worker für Offline-Funktionalität
- [ ] App-Installation ermöglichen (manifest.json)
- [ ] Push-Benachrichtigungen
- [x] Mobile-optimierte UI (Responsive Design vorhanden)

### 🔔 23. Benachrichtigungen & Countdown
- [ ] Countdown für nächsten Flug
- [ ] Check-in Erinnerungen (24h vorher)
- [ ] Gate-Change Benachrichtigungen
- [ ] Flugstatus-Updates

## Phase 8: Qualität, Performance & Insights (kontinuierlich)
*Querschnittsthemen für Stabilität, Wachstum und Nutzerfeedback*

### 🧭 24. Onboarding & Guided Tour
- [ ] Geführtes Tutorial mit Tooltips auf Karten- und Statistikseiten
- [x] Onboarding-Checklist mit ersten Aktionen (Flug anlegen, Filter nutzen, Export testen)
- [ ] Demo-Daten-Umschalter für neue Nutzer

### 📈 25. Nutzungs-Analytics
- [x] Ereignis-Tracking für Karten, Filter, Exporte und Routen-Analysen
- [ ] Dashboard mit Feature-Nutzung zur Roadmap-Priorisierung
- [x] Opt-in und Anonymisierung für datenschutzkonformes Tracking

### 🚀 26. Performance & Skalierung
- [ ] Server-Side-Pagination oder Streaming für große Flugmengen
- [ ] Caching für häufige Routen-/Statistik-Abfragen (Redis - Backend)
- [ ] Map-Layer-Clustering und Lazy-Loading für Charts/Module
- [ ] Performance-Regression-Checks in der CI/CD-Pipeline
- [ ] Stress-Tests für Import/Export, um Konflikte und Inkonsistenzen zu vermeiden

#### 🗺️ Map Performance Optimierungen
**Phase 1: Quick Wins** ✅ (Implementiert)
- [x] Route-Aggregation (eine Polyline pro Route statt pro Flug)
- [x] Heatmap-Farben basierend auf Flughäufigkeit (grün→gelb→orange→rot)
- [x] Canvas Renderer aktivieren (`preferCanvas` für schnelleres Rendering)
- [x] React.memo() für Map und AirportMarkers
- [x] useMemo() für Route-Berechnungen und Farb-Logik
- [x] useCallback() für Event-Handlers

**Phase 2: Clustering & Aggregation** (Geplant)
- [ ] Marker Clustering für Flughäfen (react-leaflet-cluster)
- [ ] Polyline Simplification mit Douglas-Peucker Algorithmus (simplify-js)
- [ ] Adaptive Detailstufen basierend auf Zoom-Level
- [ ] Cluster-Statistiken in Popups

**Phase 3: Virtualisierung** (Geplant)
- [ ] Viewport-Culling (nur sichtbare Routen rendern)
- [ ] Debouncing für Map-Updates (lodash debounce)
- [ ] Lazy Loading für AirportMarkers außerhalb des Viewports
- [ ] Progressive Route-Loading (wichtige Routen zuerst)

**Phase 4: WebGL-Rendering** (Für >1000 Flüge)
- [ ] deck.gl Integration für WebGL-beschleunigtes Rendering
- [ ] PathLayer für Flugrouten
- [ ] ScatterplotLayer für Flughäfen
- [ ] Interaktive Layer-Controls

**Erwartete Performance-Gewinne:**
- Phase 1: 60-80% weniger DOM-Elemente, 50% schnellere Re-Renders
- Phase 2: 70% weniger Marker bei vielen Airports
- Phase 3: 80% weniger Elemente bei ausgezoomter Ansicht
- Phase 4: 10x Performance bei 1000+ Flügen

### 🛡️ 27. Sicherheit & Compliance-Erweiterungen
- [x] Rate-Limiting im Express-Backend (100 req/15min)
- [ ] Log-Redaction für sensitive Daten
- [ ] Frühzeitige Planung für 2FA-Backend, Session-Übersicht und DSGVO-Export/Löschung
- [ ] Wiederkehrende Dependency- und Secret-Scans (aufbauend auf Phase 0)
- [x] Durchgängige Frontend- und Backend-Validierung inkl. Schema-Härtung (Zod)
- [ ] Konsistenz-Checks bei Importen (z. B. doppelte Routen/Flüge)

## Phase 9: Erweiterte Features (Woche 15+)
*Nice-to-have Features für Power-User*

### 🔍 28. Smart Search & Erweiterte Filter
- [ ] Volltextsuche über alle Felder
- [x] Kombinierte Filter (Airline, Datum, Status, Tags)
- [ ] Gespeicherte Suchanfragen
- [x] Schnellfilter-Chips

### 💺 29. Sitzplatz-Präferenz Tracker
- [ ] Fenster vs. Gang Statistik
- [ ] Beste Sitzplätze pro Flugzeugtyp
- [ ] Sitzplan-Integration
- [ ] Präferenz-Empfehlungen

### 🎯 30. Ziele & Bucket List
- [ ] Wunsch-Destinationen markieren
- [ ] Fortschritt zu Zielen
- [ ] Inspiration für neue Ziele
- [ ] Preisalarme (externe Integration)

### 🩺 31. Wellbeing & Jetlag Insights
- [ ] Jetlag- und Schlaf-Score basierend auf Zeitzonenwechseln
- [ ] Empfehlungen für Schlaf-/Hydrationsfenster vor und nach Flügen
- [ ] Integration mit bestehenden Zeit- und Distanz-Statistiken
- [ ] Optionales Logging für Ruhezeiten und Trainings

---

## Technische Verbesserungen (Parallel)

### Backend
- [x] PostgreSQL Optimierungen (Indizes, Relationen)
- [ ] Caching-Layer (Redis)
- [x] API-Performance-Optimierung (Pagination)
- [x] Rate Limiting (100 req/15min)
- [ ] Datenbank-Backups (automatisiert)

### Frontend
- [x] Performance-Optimierung (Vite, Code-Splitting)
- [x] Lazy Loading für Komponenten (React.lazy teilweise)
- [ ] Optimistic UI Updates
- [x] Error Boundaries verbessern
- [x] Accessibility (A11y) verbessern (Basis vorhanden)

### Testing
- [x] Unit Tests (Jest für Backend)
- [x] Integration Tests (Supertest)
- [ ] E2E Tests (Playwright)
- [ ] Test Coverage >80%
- [ ] **Boarding Pass Testing Tools:**
  - [ ] Barcode-Generator für Testdaten (IATA BCBP Format)
  - [ ] Mock Boarding Pass Generator (verschiedene Airlines)
  - [ ] Automated Scanner Tests mit generierten Barcodes

### DevOps
- [ ] CI/CD Pipeline (GitHub Actions)
- [ ] Automated Deployments
- [ ] Monitoring & Logging (Winston/Pino)
- [ ] Error Tracking (Sentry)

---

## Priorisierung

**Must Have (MVP+):**
1, 2, 3, 6, 8, 9, 13, 14, 15, 17, 18, 24, 25, 27

**Should Have:**
4, 5, 11, 12, 16, 26

**Could Have:**
7, 10, 19, 20, 21, 23, 28, 29, 30, 31

**Won't Have (Vorerst):**
CI/CD (0), PWA (22), Social Features (19-21)

---

## Implementierungsstatus

### ✅ Vollständig implementiert:
- Phase 1: Kern-Visualisierungen (100%)
- Phase 2: Gamification & Achievements (100%)
- **Phase 5.5: Daten-Anreicherung (100%)** 🎉

### 🟡 Teilweise implementiert:
- Phase 3: Praktische Tools (~70% - Einstellungs-UI vorhanden, Backend teilweise)
- Phase 4: Umwelt & Analysen (~40% - Routen-Analyse und Heatmap)
- Phase 5: Import & Export (~60% - Scanner und Export ohne PDF)
- Phase 8: Qualität & Analytics (~40% - Basis vorhanden)

### ❌ Nicht implementiert:
- Phase 0: CI/CD-Pipeline (0%)
- Phase 6: Sharing & Social (0%, außer Leaderboard)
- Phase 7: Mobile & PWA (0%, nur responsives Design)
- Phase 9: Erweiterte Features (10% - nur Filter)

---

*Letzte Aktualisierung: 2025-11-22*
*Roadmap-Status basierend auf tatsächlicher Code-Analyse*
### Add Flight UX Polish (Backlog)
- [ ] Boarding-Pass-Scan weiter anreichern (Gate/Terminal/Seat-Class/Zeiten) und API-Fallback klar anzeigen
- [ ] Lookup-Fehlerzust�nde (kein Backend/kein API-Key) mit klaren Hinweisen im Dialog
- [ ] Dunkelmodus f�r alle Add-Flight-Dialogteile inkl. Scanner-Overlay konsistent testen
- [ ] Eingabefelder ergonomisch skalieren (Breite/H�he) und Responsiveness pr�fen
- [ ] Validierung/Tests f�r neuen Add-Flight-Flow (V2) erg�nzen
