# TravStats Feature Roadmap

## Phase 0: Qualitätssicherung & Delivery (vor Woche 1)
*Legt die Basis für verlässliche Releases und Sicherheitsstandards*

### 🧪 0. CI/CD-Pipeline & Sicherheits-Scans
- [x] Pipeline mit Linting, Tests, Type-Checks und Docker-Build
- [x] Abhängigkeits-Scanning und Vulnerability-Alerts
- [x] Secret- und JWT-Config-Checks (z. B. via Trivy/Gitleaks)
- [x] Automatisierte Preview-Deployments für PRs


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

### 🏆 4. Badges & Achievements System
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

### 🗺️ 5. Flughafen-Collection
- [x] Besuchte Flughäfen sammeln
- [x] Fortschritt zu Sammlungen (z.B. "Alle deutschen Flughäfen")
- [x] Seltene Flughäfen hervorheben
- [x] Flughafen-Detailseite mit allen Besuchen

## Phase 3: Praktische Tools (Woche 5-6)
*Erhöht den praktischen Nutzen der App*
### ?Y'? 6. Reisekosten-Tracker
- [x] Ticketpreis-Feld hinzufOgen
- [x] Gesamtausgaben Dashboard
- [ ] Kosten pro Airline/Strecke analysieren
- [ ] Budget-Tracking und Prognosen
- [ ] W??hrungsumrechnung
- [ ] Beleg-Upload (Fotos/PDF) mit OCR fOr Betr??ge
- [ ] Automatische W??hrungs- und Steuerkategorie-Erkennung

### ✈️ 7. Vielflieger-Meilen Tracker
- [x] Meilen-Berechnung pro Airline
- [x] Status-Level anzeigen (Silver, Gold, Platinum)
- [x] Fortschritt zum nächsten Level
- [x] Ablaufdatum von Meilen

### 🏷️ 8. Flug-Tags & Kategorien
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

### ⚙️ 9. Einstellungsseite
- [ ] **Benutzer-Profil:**
  - Benutzername ändern
  - E-Mail-Adresse verwalten
  - Profilbild hochladen
  - Passwort ändern
  - Account löschen (mit Bestätigung)
- [x] **Anzeige-Einstellungen:**
  - Dark/Light Mode Toggle (bereits implementiert, hier zentral steuerbar)
  - Sprache wählen (Deutsch/Englisch)
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
  - E-Mail-Benachrichtigungen aktivieren/deaktivieren
  - Flug-Erinnerungen (24h/48h vorher)
  - Check-in Reminder
  - Neue Feature-Updates
- [ ] **Datenschutz & Sicherheit:**
  - Zwei-Faktor-Authentifizierung (2FA)
  - Aktive Sessions anzeigen
  - Login-Historie
  - Daten-Export anfordern (DSGVO)
  - Daten vollständig löschen
- [ ] **Backup & Sync:**
  - Automatisches Backup aktivieren
  - Backup-Intervall einstellen
  - Export-Format-Präferenzen
  - Cloud-Sync Einstellungen

## Phase 4: Umwelt & Analysen (Woche 7-8)
*Fokus auf Nachhaltigkeit und tiefere Analysen*

### 🌱 10. CO2-Fußabdruck Tracker
- [x] CO2-Berechnung pro Flug (nach Flugzeugtyp & Klasse)
- [x] Gesamt-CO2-Bilanz
- [x] Vergleich verschiedener Klassen
- [x] Kompensations-Vorschläge
- [x] Monatliche CO2-Trends

### 📊 11. Erweiterte Routen-Analyse
- [x] Häufigste Routen identifizieren
- [x] Route-Statistiken (Durchschnittsdauer, Verspätungen)
- [x] Beste Reisezeit für Routen
- [x] Alternative Routen vorschlagen
- [x] Multi-Leg- und Open-Jaw-Reisen mit Umsteigezeit-Prüfung (MCT)

### 📈 12. Heatmap & Intensitäts-Visualisierung
- [x] Jahres-Heatmap (wie GitHub Contributions)
- [x] Monatliche Aktivitäts-Heatmap
- [x] Geografische Heatmap (wo am meisten geflogen)

## Phase 5: Import & Export (Woche 9-10)
*Vereinfacht Dateneingabe und -verwaltung*

### 📸 13. Boarding Pass Scanner (OCR)
- [x] Kamera-Integration
- [x] QR/Barcode-Scanner
- [x] OCR für Text-Extraktion
- [x] PDF-Import von E-Tickets
- [x] Automatisches Ausfüllen des Formulars

### 📄 14. Erweiterte Export-Funktionen
- [x] PDF-Report Generator
- [ ] Excel-Export mit Pivot-Tabellen
- [x] KML-Export für Google Earth
- [ ] JSON/CSV Bulk-Import
- [ ] Import von anderen Apps (TripIt, etc.)
- [x] Beta: Frühe JSON/CSV-Import-/Export-Pfade hinter Feature-Flag aktivieren, um Migrationstests zu ermöglichen
- [ ] Strikte Schema-Validierung und Duplikat-Erkennung fOr Bulk-Importe
- [ ] IATA/ICAO-Autocomplete und Flugnummer-Lookups zur Datenanreicherung

### 💾 15. Backup & Sync
- [x] Automatische Backups
- [x] Import/Export aller Daten
- [x] Versionierung
- [x] Cloud-Sync (optional)

## Phase 6: Sharing & Social (Woche 11-12)
*Teilen und vergleichen mit anderen*

### 🎨 16. Flugkarten-Generator
- [x] Schöne Share-Grafiken erstellen
- [x] Jahresrückblick-Karten
- [x] Animierte Routen-Videos
- [x] Social Media Templates
- [x] Download als PNG/SVG

### 🌐 17. Trip-Zusammenfassung
- [x] Mehrere Flüge zu Reisen gruppieren
- [x] Reise-Timeline
- [x] Notizen und Fotos zu Reisen
- [x] Reiseberichte erstellen
- [x] Multi-Leg-Ketten mit Segment-Details und realistischen Umsteigezeiten
- [x] Abo-Benachrichtigungen für neue Routentrends oder Preisalarme

### 👥 18. Freunde-Vergleich (Optional)
- [x] Freunde hinzufügen
- [x] Leaderboards
- [x] Gemeinsame besuchte Orte
- [x] Wettbewerbe/Challenges

## Phase 7: Mobile & PWA (Woche 13-14)
*Mobile Optimierung und Offline-Fähigkeit*

### 📱 19. Progressive Web App
- [x] Service Worker für Offline-Funktionalität
- [x] App-Installation ermöglichen
- [x] Push-Benachrichtigungen
- [x] Mobile-optimierte UI

### 🔔 20. Benachrichtigungen & Countdown
- [x] Countdown für nächsten Flug
- [x] Check-in Erinnerungen (24h vorher)
- [x] Gate-Change Benachrichtigungen
- [x] Flugstatus-Updates

## Phase 8: Qualität, Performance & Insights (kontinuierlich)
*Querschnittsthemen für Stabilität, Wachstum und Nutzerfeedback*

### 🧭 21. Onboarding & Guided Tour
### ?Y?? 21. Onboarding & Guided Tour
- [ ] Gefuhrtes Tutorial mit Tooltips auf Karten- und Statistikseiten
- [x] Onboarding-Checklist mit ersten Aktionen (Flug anlegen, Filter nutzen, Export testen)
- [ ] Demo-Daten-Umschalter fOr neue Nutzer

### 📈 22. Nutzungs-Analytics
- [x] Ereignis-Tracking fOr Karten, Filter, Exporte und Routen-Analysen
- [ ] Dashboard mit Feature-Nutzung zur Roadmap-Priorisierung
- [x] Opt-in und Anonymisierung fOr datenschutzkonformes Tracking

### 🚀 23. Performance & Skalierung
- [ ] Server-Side-Pagination oder Streaming fOr gro?Ye Flugmengen
- [ ] Caching fOr h??ufige Routen-/Statistik-Abfragen
- [ ] Map-Layer-Clustering und Lazy-Loading fOr Charts/Module
- [ ] Performance-Regression-Checks in der CI/CD-Pipeline
- [ ] Stress-Tests fOr Import/Export, um Konflikte und Inkonsistenzen zu vermeiden

### 🛡️ 24. Sicherheit & Compliance-Erweiterungen
- [ ] Rate-Limiting und Log-Redaction im Express-Backend
- [ ] FrOhzeitige Planung fOr 2FA, Session-?obersicht und DSGVO-Export/L??schung (Verzahnung mit Phase 3 "Einstellungsseite")
- [ ] Wiederkehrende Dependency- und Secret-Scans (aufbauend auf Phase 0)
- [ ] Durchg??ngige Frontend- und Backend-Validierung inkl. Schema-H??rtung
- [ ] Konsistenz-Checks bei Importen (z. B. doppelte Routen/FlOge)

## Phase 9: Erweiterte Features (Woche 15+)
*Nice-to-have Features für Power-User*

### 🔍 25. Smart Search & Erweiterte Filter
- [x] Volltextsuche über alle Felder
- [x] Kombinierte Filter
- [x] Gespeicherte Suchanfragen
- [x] Schnellfilter-Chips

### 💺 26. Sitzplatz-Präferenz Tracker
- [x] Fenster vs. Gang Statistik
- [x] Beste Sitzplätze pro Flugzeugtyp
- [x] Sitzplan-Integration
- [x] Präferenz-Empfehlungen

### 🎯 27. Ziele & Bucket List
- [x] Wunsch-Destinationen markieren
- [x] Fortschritt zu Zielen
- [x] Inspiration für neue Ziele
- [x] Preisalarme (externe Integration)

### 🩺 28. Wellbeing & Jetlag Insights
- [x] Jetlag- und Schlaf-Score basierend auf Zeitzonenwechseln
- [x] Empfehlungen für Schlaf-/Hydrationsfenster vor und nach Flügen
- [x] Integration mit bestehenden Zeit- und Distanz-Statistiken
- [x] Optionales Logging für Ruhezeiten und Trainings

---

## Technische Verbesserungen (Parallel)

### Backend
- [x] PostgreSQL Optimierungen
- [x] Caching-Layer (Redis)
- [x] API-Performance-Optimierung
- [x] Rate Limiting
- [x] Datenbank-Backups

### Frontend
- [x] Performance-Optimierung (Code-Splitting)
- [x] Lazy Loading für Komponenten
- [x] Optimistic UI Updates
- [x] Error Boundaries verbessern
- [x] Accessibility (A11y) verbessern

### Testing
- [x] Unit Tests (Jest)
- [x] Integration Tests
- [x] E2E Tests (Playwright)
- [x] Test Coverage >80%

### DevOps
- [x] CI/CD Pipeline
- [x] Automated Deployments
- [x] Monitoring & Logging
- [x] Error Tracking (Sentry)

---

## Priorisierung

**Must Have (MVP+):**
1, 2, 3, 6, 8, 9, 14, 21, 22, 23, 24

**Should Have:**
4, 5, 7, 10, 11, 13, 15, 19, 20

**Could Have:**
12, 16, 17, 18, 25, 26, 27, 28

**Won't Have (Vorerst):**
-

---

*Letzte Aktualisierung: 2025-02-15*

