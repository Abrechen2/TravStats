# Abhängigkeiten – geprüfte Reichweite

Stand 13.09.2026, Lockfiles von **39715ec5**, identisch zur dafür untersuchten Auditbasis 9678e6cd. Frischer `npm audit --json`: Root **0**, Backend **4 Paketmeldungen hoher Priorität**, Frontend **15 Paketmeldungen (10 hoch, 5 mittel)**. Das sind Paket-/Abhängigkeitsmeldungen, keine 19 unabhängig ausnutzbaren TravStats-Lücken. Die Frontendzählung enthält viele weitergereichte Deck.gl-Abhängigkeiten. Rohberichte: `block18-npm-audit-{root,backend,frontend}.json`; tatsächliche Installationspfade in `block17-*-dependency-paths.json`.

| Paket / installierter Pfad | Prüfung im TravStats-Code | Bewertung |
| --- | --- | --- |
| Multer 2.2.0, direkte Backendabhängigkeit | Tatsächlicher authentifizierter Receipt-Upload, 202-Byte-Multipartprobe in eigener Linux/Node-22-Runtime; unangemeldete Kontrolle 401 | **AUD-097, P1 bestätigt:** unbehandelte RangeError erreicht den Prozess. Windows/Node 24 antwortet dagegen 500. Weitere Multer-Meldungen nicht separat als reproduziert zählen. |
| Nodemailer 9.0.6, direkte Backendabhängigkeit | Mailservice-Aufrufe und Eingabepfade geprüft. Normale Benachrichtigungsempfänger werden mit `z.string().email()` validiert; kein App-Aufruf von `resolveContent()` oder eigener Empfängerdomain-Allowlist gefunden. SMTP-Absender wird administrativ konfiguriert. | Verwundbare Version vorhanden, aber kein bestätigter normaler Nutzerpfad zum beschriebenen langen Kommalistenangriff oder zu den übrigen Spezialbedingungen. Aktualisierung erforderlich; keine Lastprobe und kein Mailversand durchgeführt. |
| Undici 7.28.0 unter Cheerio/OpenAI | App verwendet Cheerio zum Parsen mit `load`, keine `fromURL`-Aufrufe gefunden. Keine eigenen Undici-Cache-/Retryinterceptors, `setCookie` oder manipulierbaren blobartigen Bodyobjekte gefunden. | Betroffene Pakete vorhanden; spezifische Advisory-Voraussetzungen im geprüften App-Pfad nicht nachgewiesen. Das in Node eingebaute `fetch` hat eine eigene Undici-Version und wird nicht mit dieser npm-Instanz gleichgesetzt. |
| js-yaml 3.15.0 Backend / 4.3.0 Frontend | Backendpfad über ts-jest/Babel/Istanbul; Frontendpfad über ESLint. Kein produktiver App-YAML-Import gefunden. | Hier Entwicklungs-/Prüfwerkzeuge betroffen. Keine bestätigte remote erreichbare TravStats-YAML-Lücke. |
| DOMPurify 3.4.12, optional unter jsPDF 4.2.1 | Keine App-Verwendung von `IN_PLACE`, Hooks oder jsPDF-HTML-Rendering gefunden; PDF-Code zeichnet Inhalte direkt. | Verwundbare Bibliothek vorhanden; für die konkrete Meldung nötige Hook-/IN_PLACE-Kombination nicht belegt. |
| fflate 0.7.4 unter Deck.gl/@loaders.gl/compression | Kein direkter App-Aufruf von `unzipSync` oder Benutzer-ZIP-Eingang für diese Maploader gefunden. jsPDF verwendet separat fflate 0.8.3. | Nicht pauschal dem PDF-Export zurechnen. Fehlender erreichbarer App-Pfad ist keine Garantie für sämtliche transitiven Loader. |
| image-size ≤2.0.2 unter texture-compressor/Deck.gl | Abhängigkeit führt in Node-Texturwerkzeuge; kein direkter produktiver App-Aufruf gefunden. | Advisory betrifft bestimmte Bildparser. Kein bestätigter betroffener TravStats-Uploadpfad; nicht mit dem separat geprüften Multerproblem vermischen. |

Die Bewertung der Erreichbarkeit ist eine Schlussfolgerung aus Paketbaum und überprüften Aufrufen, keine Behauptung, Drittcode vollständig geprüft zu haben. Keine automatischen Paketupdates oder `npm audit fix` ausgeführt. Multer zuerst korrigieren und auf der tatsächlichen Containerlaufzeit gegenprüfen; übrige Pakete regulär aktualisieren und bestehende Tests ausführen.

Primärquellen, am 13.09.2026 abgeglichen:

- Multer: [Prozessabbruch durch Multipart-Feldnamen, korrigiert ab 2.3.0](https://github.com/expressjs/multer/security/advisories/GHSA-wc9g-mqfw-jrwm).
- Nodemailer: [quadratische Verarbeitung von Adresslisten, korrigiert ab 9.1.0](https://github.com/nodemailer/nodemailer/security/advisories/GHSA-2x7j-588g-ccc2). Diese Versionsangabe gilt für genau diese Meldung, nicht pauschal für alle Nodemailer-Advisories.
- Undici: [Retry-Interceptor und inkonsistente Antwortlänge, 7.x-Korrektur ab 7.29.0](https://github.com/nodejs/undici/security/advisories/GHSA-8xcm-r25x-g524).
- DOMPurify: [IN_PLACE mit entfernendem Hook, korrigiert ab 3.4.13](https://github.com/cure53/DOMPurify/security/advisories/GHSA-55q2-fjhq-7xh7).

Die übrigen konkreten Advisory-IDs, betroffenen Bereiche und gemeldeten Korrekturen stehen unverändert in den npm-Rohberichten; dafür wird keine weitergehende unabhängige Reproduktion behauptet.
