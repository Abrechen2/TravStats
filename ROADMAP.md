# TravStats Feature Roadmap

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
- [ ] Achievement-Datenmodell erstellen
- [ ] 20+ verschiedene Badges definieren:
  - Weltenbummler (5+ Kontinente)
  - Vielflieger (100+ Flüge)
  - Nachtflug-König (10+ Nachtflüge)
  - Business-Traveler (50+ Business Class)
  - Marathon-Flyer (10+ Stunden Flug)
  - Wochenend-Krieger (Flüge Fr-So)
- [ ] Badge-Unlock-Animation
- [ ] Badge-Galerie-Seite

### 🗺️ 5. Flughafen-Collection
- [ ] Besuchte Flughäfen sammeln
- [ ] Fortschritt zu Sammlungen (z.B. "Alle deutschen Flughäfen")
- [ ] Seltene Flughäfen hervorheben
- [ ] Flughafen-Detailseite mit allen Besuchen

## Phase 3: Praktische Tools (Woche 5-6)
*Erhöht den praktischen Nutzen der App*

### 💰 6. Reisekosten-Tracker
- [ ] Ticketpreis-Feld hinzufügen
- [ ] Gesamtausgaben Dashboard
- [ ] Kosten pro Airline/Strecke analysieren
- [ ] Budget-Tracking und Prognosen
- [ ] Währungsumrechnung

### ✈️ 7. Vielflieger-Meilen Tracker
- [ ] Meilen-Berechnung pro Airline
- [ ] Status-Level anzeigen (Silver, Gold, Platinum)
- [ ] Fortschritt zum nächsten Level
- [ ] Ablaufdatum von Meilen

### 🏷️ 8. Flug-Tags & Kategorien
- [ ] Tag-System implementieren
- [ ] **Geschäftlich vs. Privat Tracking:**
  - Dropdown-Feld im Flugformular (Geschäftlich/Privat/Urlaub)
  - Statistik-Seite mit Aufteilung Geschäft/Privat
  - Separate Distanz-Statistiken pro Kategorie
  - Kosten-Tracking pro Kategorie (für Steuer)
  - Zeiterfassung für Geschäftsreisen
- [ ] Vordefinierte Tags (Konferenz, Familienbesuch, Wochenendtrip, etc.)
- [ ] Benutzerdefinierte Tags
- [ ] Farb-Codierung auf Karte (Geschäft = Blau, Privat = Grün)
- [ ] Filter nach Tags und Kategorien

### ⚙️ 9. Einstellungsseite
- [ ] **Benutzer-Profil:**
  - Benutzername ändern
  - E-Mail-Adresse verwalten
  - Profilbild hochladen
  - Passwort ändern
  - Account löschen (mit Bestätigung)
- [ ] **Anzeige-Einstellungen:**
  - Dark/Light Mode Toggle (bereits implementiert, hier zentral steuerbar)
  - Sprache wählen (Deutsch/Englisch)
  - Zeitzone einstellen
  - Datumsformat (DD.MM.YYYY / MM/DD/YYYY / YYYY-MM-DD)
  - Zeitformat (24h / 12h AM/PM)
- [ ] **Einheiten & Formate:**
  - Distanz-Einheiten (Kilometer / Meilen / Nautische Meilen)
  - Währung für Kostentracking
  - Temperatur-Einheit (Celsius / Fahrenheit)
- [ ] **Standard-Werte:**
  - Standard-Status für neue Flüge (scheduled/flown)
  - Standard-Sitzklasse
  - Lieblings-Airline vorauswählen
  - Standard-Flugkategorie (Geschäft/Privat)
- [ ] **Karten-Einstellungen:**
  - Standard-Kartenansicht (OpenStreetMap / Satellite)
  - Zoom-Level beim Start
  - Marker-Stil (Pin / Kreis / Custom)
  - Farb-Schema für Routen
- [ ] **Benachrichtigungen:**
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
- [ ] CO2-Berechnung pro Flug (nach Flugzeugtyp & Klasse)
- [ ] Gesamt-CO2-Bilanz
- [ ] Vergleich verschiedener Klassen
- [ ] Kompensations-Vorschläge
- [ ] Monatliche CO2-Trends

### 📊 11. Erweiterte Routen-Analyse
- [ ] Häufigste Routen identifizieren
- [ ] Route-Statistiken (Durchschnittsdauer, Verspätungen)
- [ ] Beste Reisezeit für Routen
- [ ] Alternative Routen vorschlagen

### 📈 12. Heatmap & Intensitäts-Visualisierung
- [ ] Jahres-Heatmap (wie GitHub Contributions)
- [ ] Monatliche Aktivitäts-Heatmap
- [ ] Geografische Heatmap (wo am meisten geflogen)

## Phase 5: Import & Export (Woche 9-10)
*Vereinfacht Dateneingabe und -verwaltung*

### 📸 13. Boarding Pass Scanner (OCR)
- [ ] Kamera-Integration
- [ ] QR/Barcode-Scanner
- [ ] OCR für Text-Extraktion
- [ ] PDF-Import von E-Tickets
- [ ] Automatisches Ausfüllen des Formulars

### 📄 14. Erweiterte Export-Funktionen
- [ ] PDF-Report Generator
- [ ] Excel-Export mit Pivot-Tabellen
- [ ] KML-Export für Google Earth
- [ ] JSON/CSV Bulk-Import
- [ ] Import von anderen Apps (TripIt, etc.)

### 💾 15. Backup & Sync
- [ ] Automatische Backups
- [ ] Import/Export aller Daten
- [ ] Versionierung
- [ ] Cloud-Sync (optional)

## Phase 6: Sharing & Social (Woche 11-12)
*Teilen und vergleichen mit anderen*

### 🎨 16. Flugkarten-Generator
- [ ] Schöne Share-Grafiken erstellen
- [ ] Jahresrückblick-Karten
- [ ] Animierte Routen-Videos
- [ ] Social Media Templates
- [ ] Download als PNG/SVG

### 🌐 17. Trip-Zusammenfassung
- [ ] Mehrere Flüge zu Reisen gruppieren
- [ ] Reise-Timeline
- [ ] Notizen und Fotos zu Reisen
- [ ] Reiseberichte erstellen

### 👥 18. Freunde-Vergleich (Optional)
- [ ] Freunde hinzufügen
- [ ] Leaderboards
- [ ] Gemeinsame besuchte Orte
- [ ] Wettbewerbe/Challenges

## Phase 7: Mobile & PWA (Woche 13-14)
*Mobile Optimierung und Offline-Fähigkeit*

### 📱 19. Progressive Web App
- [ ] Service Worker für Offline-Funktionalität
- [ ] App-Installation ermöglichen
- [ ] Push-Benachrichtigungen
- [ ] Mobile-optimierte UI

### 🔔 20. Benachrichtigungen & Countdown
- [ ] Countdown für nächsten Flug
- [ ] Check-in Erinnerungen (24h vorher)
- [ ] Gate-Change Benachrichtigungen
- [ ] Flugstatus-Updates

## Phase 8: Erweiterte Features (Woche 15+)
*Nice-to-have Features für Power-User*

### 🔍 21. Smart Search & Erweiterte Filter
- [ ] Volltextsuche über alle Felder
- [ ] Kombinierte Filter
- [ ] Gespeicherte Suchanfragen
- [ ] Schnellfilter-Chips

### 💺 22. Sitzplatz-Präferenz Tracker
- [ ] Fenster vs. Gang Statistik
- [ ] Beste Sitzplätze pro Flugzeugtyp
- [ ] Sitzplan-Integration
- [ ] Präferenz-Empfehlungen

### 🎯 23. Ziele & Bucket List
- [ ] Wunsch-Destinationen markieren
- [ ] Fortschritt zu Zielen
- [ ] Inspiration für neue Ziele
- [ ] Preisalarme (externe Integration)

---

## Technische Verbesserungen (Parallel)

### Backend
- [ ] PostgreSQL Optimierungen
- [ ] Caching-Layer (Redis)
- [ ] API-Performance-Optimierung
- [ ] Rate Limiting
- [ ] Datenbank-Backups

### Frontend
- [ ] Performance-Optimierung (Code-Splitting)
- [ ] Lazy Loading für Komponenten
- [ ] Optimistic UI Updates
- [ ] Error Boundaries verbessern
- [ ] Accessibility (A11y) verbessern

### Testing
- [ ] Unit Tests (Jest)
- [ ] Integration Tests
- [ ] E2E Tests (Playwright)
- [ ] Test Coverage >80%

### DevOps
- [ ] CI/CD Pipeline
- [ ] Automated Deployments
- [ ] Monitoring & Logging
- [ ] Error Tracking (Sentry)

---

## Priorisierung

**Must Have (MVP+):**
1, 2, 3, 6, 8, 9, 14

**Should Have:**
4, 5, 7, 10, 11, 13, 15

**Could Have:**
12, 16, 17, 19, 20, 21, 22

**Won't Have (Vorerst):**
18, 23

---

*Letzte Aktualisierung: 2025-01-20*
