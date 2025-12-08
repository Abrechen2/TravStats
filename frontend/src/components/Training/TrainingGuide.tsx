import { useState } from 'react';

interface AccordionSection {
  id: string;
  title: string;
  content: React.ReactNode;
}

export default function TrainingGuide() {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['introduction']));

  const toggleSection = (sectionId: string) => {
    setExpandedSections((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(sectionId)) {
        newSet.delete(sectionId);
      } else {
        newSet.add(sectionId);
      }
      return newSet;
    });
  };

  const sections: AccordionSection[] = [
    {
      id: 'introduction',
      title: 'Einführung',
      content: (
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              Was ist Model Training?
            </h3>
            <p className="text-gray-700 dark:text-gray-300">
              Model Training ermöglicht es Ihnen, das lokale Ollama LLM (Large Language Model) mit
              Ihren eigenen Flugdaten zu trainieren. Durch das Training lernt das Modell, Flugdaten
              aus E-Mails und Boarding Passes besser zu erkennen und zu extrahieren.
            </p>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              Warum sollte man das Modell trainieren?
            </h3>
            <ul className="list-disc list-inside space-y-1 text-gray-700 dark:text-gray-300">
              <li>
                <strong>Bessere Genauigkeit:</strong> Das Modell lernt Ihre spezifischen
                E-Mail-Formate und Boarding-Pass-Layouts kennen
              </li>
              <li>
                <strong>Weniger manuelle Korrekturen:</strong> Automatische Extraktion wird
                präziser
              </li>
              <li>
                <strong>Lokale Verarbeitung:</strong> Alle Daten bleiben auf Ihrem Server, keine
                Cloud-API nötig
              </li>
              <li>
                <strong>Kontinuierliche Verbesserung:</strong> Je mehr Daten Sie trainieren, desto
                besser wird das Modell
              </li>
            </ul>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              Voraussetzungen
            </h3>
            <ul className="list-disc list-inside space-y-1 text-gray-700 dark:text-gray-300">
              <li>
                <strong>Developer Mode:</strong> Muss in den Einstellungen aktiviert sein
              </li>
              <li>
                <strong>Ollama:</strong> Muss installiert und erreichbar sein (separater Container
                oder lokale Installation)
              </li>
              <li>
                <strong>Hardware:</strong>
                <ul className="list-circle list-inside ml-4 mt-1 space-y-1">
                  <li>
                    <strong>CPU:</strong> Funktioniert, aber langsam (mehrere Stunden für Training)
                  </li>
                  <li>
                    <strong>GPU:</strong> Empfohlen für schnelleres Training (NVIDIA GPU mit CUDA
                    Support)
                  </li>
                  <li>
                    <strong>RAM:</strong> Mindestens 8GB, 16GB+ empfohlen
                  </li>
                </ul>
              </li>
              <li>
                <strong>Daten:</strong> Mindestens 5 annotierte Einträge (Emails oder Boarding
                Passes)
              </li>
            </ul>
          </div>
        </div>
      ),
    },
    {
      id: 'workflow',
      title: 'Workflow-Übersicht',
      content: (
        <div className="space-y-4">
          <p className="text-gray-700 dark:text-gray-300">
            Der Training-Workflow besteht aus 4 Hauptschritten:
          </p>
          <ol className="list-decimal list-inside space-y-3 text-gray-700 dark:text-gray-300">
            <li>
              <strong>Daten sammeln:</strong> Laden Sie E-Mails (.eml, .msg, .txt) oder Boarding
              Passes (.png, .jpg, .jpeg) hoch
            </li>
            <li>
              <strong>Daten annotieren:</strong> Extrahieren und korrigieren Sie die Flugdaten
              manuell. Das System lernt aus Ihren Korrekturen.
            </li>
            <li>
              <strong>Training starten:</strong> Starten Sie das LoRA-Training mit mindestens 5
              annotierten Einträgen. Das Training kann je nach Hardware und Datenmenge mehrere
              Stunden dauern.
            </li>
            <li>
              <strong>Modell testen:</strong> Nach erfolgreichem Training wird das Modell
              automatisch in Ollama verfügbar. Testen Sie es mit neuen Daten über den Parser.
            </li>
          </ol>
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg p-4">
            <p className="text-sm text-blue-900 dark:text-blue-100">
              <strong>Tipp:</strong> Beginnen Sie mit 5-10 hochwertigen, gut annotierten Einträgen.
              Qualität ist wichtiger als Quantität!
            </p>
          </div>
        </div>
      ),
    },
    {
      id: 'steps',
      title: 'Detaillierte Schritte',
      content: (
        <div className="space-y-6">
          {/* Schritt 1 */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              Schritt 1: Daten hochladen
            </h3>
            <div className="space-y-2 text-gray-700 dark:text-gray-300">
              <p>
                <strong>Unterstützte Formate:</strong>
              </p>
              <ul className="list-disc list-inside ml-4 space-y-1">
                <li>
                  <strong>E-Mails:</strong> .eml, .msg, .txt
                </li>
                <li>
                  <strong>Boarding Passes:</strong> .png, .jpg, .jpeg, .webp
                </li>
              </ul>
              <p className="mt-3">
                <strong>Best Practices:</strong>
              </p>
              <ul className="list-disc list-inside ml-4 space-y-1">
                <li>
                  Verwenden Sie E-Mails von verschiedenen Airlines (Lufthansa, Ryanair, etc.) für
                  bessere Abdeckung
                </li>
                <li>
                  Boarding Passes sollten gut lesbar sein (hohe Auflösung, kein Blur)
                </li>
                <li>
                  Mindestens 5 Einträge sind erforderlich, 10-20 sind für den Start ideal
                </li>
                <li>
                  Verschiedene Formate und Layouts helfen dem Modell, flexibler zu werden
                </li>
              </ul>
            </div>
          </div>

          {/* Schritt 2 */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              Schritt 2: Annotation
            </h3>
            <div className="space-y-4 text-gray-700 dark:text-gray-300">
              <div>
                <h4 className="font-semibold mb-2">E-Mail-Annotation:</h4>
                <ul className="list-disc list-inside ml-4 space-y-1">
                  <li>
                    <strong>Automatische Extraktion verstehen:</strong> Das System versucht
                    automatisch, Flugdaten zu extrahieren. Prüfen Sie die Vorschläge sorgfältig.
                  </li>
                  <li>
                    <strong>Flugdaten korrigieren:</strong> Korrigieren Sie alle falsch erkannten
                    Felder (Flugnummer, Abflug/Ankunft, Datum, etc.)
                  </li>
                  <li>
                    <strong>Tags hinzufügen:</strong> Verwenden Sie Tags, um Einträge zu
                    kategorisieren (z.B. "lufthansa", "business", "international")
                  </li>
                  <li>
                    <strong>Mehrfach-Flüge:</strong> Eine E-Mail kann mehrere Flüge enthalten.
                    Fügen Sie alle Flüge hinzu, die in der E-Mail gefunden werden.
                  </li>
                </ul>
              </div>
              <div>
                <h4 className="font-semibold mb-2">Boarding Pass-Annotation:</h4>
                <ul className="list-disc list-inside ml-4 space-y-1">
                  <li>
                    <strong>QR-Code vs. Bild-Erkennung:</strong> QR-Codes werden automatisch
                    gelesen. Bei Bildern wird OCR (Optical Character Recognition) verwendet.
                  </li>
                  <li>
                    <strong>Felder verstehen:</strong> Prüfen Sie alle extrahierten Felder:
                    Flugnummer, Abflug/Ankunft, Datum, Zeit, Sitzplatz, etc.
                  </li>
                  <li>
                    <strong>Fehlerkorrektur:</strong> OCR kann Fehler machen, besonders bei
                    schlechter Bildqualität. Korrigieren Sie alle Fehler sorgfältig.
                  </li>
                </ul>
              </div>
            </div>
          </div>

          {/* Schritt 3 */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              Schritt 3: Training vorbereiten
            </h3>
            <div className="space-y-2 text-gray-700 dark:text-gray-300">
              <ul className="list-disc list-inside ml-4 space-y-1">
                <li>
                  <strong>Status-Check:</strong> Stellen Sie sicher, dass mindestens 5 Einträge
                  den Status "pending" haben
                </li>
                <li>
                  <strong>Filter und Tags verwenden:</strong> Sie können Filter verwenden, um
                  bestimmte Einträge für das Training auszuwählen
                </li>
                <li>
                  <strong>Mindestanzahl prüfen:</strong> Der "Training starten" Button ist erst
                  aktiv, wenn mindestens 5 Einträge vorhanden sind
                </li>
              </ul>
            </div>
          </div>

          {/* Schritt 4 */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              Schritt 4: Training starten
            </h3>
            <div className="space-y-2 text-gray-700 dark:text-gray-300">
              <ul className="list-disc list-inside ml-4 space-y-1">
                <li>
                  <strong>Training-Button:</strong> Klicken Sie auf "Training starten" im Training
                  Dashboard
                </li>
                <li>
                  <strong>Hardware-Anforderungen:</strong>
                  <ul className="list-circle list-inside ml-4 mt-1 space-y-1">
                    <li>
                      <strong>CPU:</strong> Training kann 2-8 Stunden dauern, je nach Datenmenge
                    </li>
                    <li>
                      <strong>GPU:</strong> Training dauert typischerweise 30 Minuten bis 2 Stunden
                    </li>
                  </ul>
                </li>
                <li>
                  <strong>Geschätzte Dauer:</strong> Wird während des Trainings basierend auf dem
                  Fortschritt angezeigt
                </li>
                <li>
                  <strong>Fortschritts-Tracking:</strong> Sie können den Fortschritt in Echtzeit
                  im Training Dashboard verfolgen
                </li>
              </ul>
            </div>
          </div>

          {/* Schritt 5 */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              Schritt 5: Training überwachen
            </h3>
            <div className="space-y-2 text-gray-700 dark:text-gray-300">
              <p>
                <strong>Job-Status:</strong>
              </p>
              <ul className="list-disc list-inside ml-4 space-y-1">
                <li>
                  <strong>pending:</strong> Training wartet auf Start
                </li>
                <li>
                  <strong>running:</strong> Training läuft aktuell
                </li>
                <li>
                  <strong>completed:</strong> Training erfolgreich abgeschlossen
                </li>
                <li>
                  <strong>failed:</strong> Training fehlgeschlagen (siehe Logs für Details)
                </li>
              </ul>
              <p className="mt-3">
                <strong>Fortschritts-Phasen:</strong>
              </p>
              <ol className="list-decimal list-inside ml-4 space-y-1">
                <li>
                  <strong>Initialisierung:</strong> System bereitet Training vor
                </li>
                <li>
                  <strong>Modell laden:</strong> Base-Modell wird von Ollama geladen
                </li>
                <li>
                  <strong>Datensatz vorbereiten:</strong> Training-Daten werden verarbeitet und
                  tokenisiert
                </li>
                <li>
                  <strong>Training:</strong> LoRA-Training läuft (Epochen und Steps werden
                  angezeigt)
                </li>
                <li>
                  <strong>Modell speichern:</strong> Trainiertes Modell wird gespeichert
                </li>
                <li>
                  <strong>Export zu Ollama:</strong> Modell wird in Ollama verfügbar gemacht
                </li>
              </ol>
              <p className="mt-3">
                <strong>Logs verstehen:</strong> Klicken Sie auf "Details" bei einem Job, um die
                vollständigen Logs zu sehen. Die Logs zeigen:
              </p>
              <ul className="list-disc list-inside ml-4 space-y-1">
                <li>Training-Fortschritt (Epochen, Steps, Loss-Werte)</li>
                <li>Fehlermeldungen (falls vorhanden)</li>
                <li>Hardware-Nutzung (CPU/GPU)</li>
                <li>Checkpoint-Informationen</li>
              </ul>
            </div>
          </div>

          {/* Schritt 6 */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              Schritt 6: Training abbrechen/fortsetzen
            </h3>
            <div className="space-y-2 text-gray-700 dark:text-gray-300">
              <p>
                <strong>Wann abbrechen?</strong>
              </p>
              <ul className="list-disc list-inside ml-4 space-y-1">
                <li>Wenn Sie einen Fehler in den Logs sehen</li>
                <li>Wenn das Training zu lange dauert und Sie die Parameter ändern möchten</li>
                <li>Wenn Sie neue, bessere Daten hinzufügen möchten</li>
              </ul>
              <p className="mt-3">
                <strong>Checkpoint-System:</strong>
              </p>
              <ul className="list-disc list-inside ml-4 space-y-1">
                <li>
                  Das System speichert automatisch Checkpoints während des Trainings
                </li>
                <li>
                  Bei einem Neustart kann das Training vom letzten Checkpoint fortgesetzt werden
                </li>
                <li>
                  Die letzten 3 Checkpoints werden gespeichert
                </li>
              </ul>
              <p className="mt-3">
                <strong>Fortsetzen von vorherigem Training:</strong>
              </p>
              <ul className="list-disc list-inside ml-4 space-y-1">
                <li>
                  Wenn Sie ein neues Training starten, wird automatisch das letzte erfolgreiche
                  Modell als Basis verwendet
                </li>
                <li>
                  Dies ermöglicht inkrementelles Training: Jedes Training verbessert das vorherige
                  Modell
                </li>
              </ul>
            </div>
          </div>

          {/* Schritt 7 */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              Schritt 7: Ergebnisse nutzen
            </h3>
            <div className="space-y-2 text-gray-700 dark:text-gray-300">
              <ul className="list-disc list-inside ml-4 space-y-1">
                <li>
                  <strong>Automatische Verfügbarkeit:</strong> Nach erfolgreichem Training wird das
                  Modell automatisch in Ollama verfügbar gemacht
                </li>
                <li>
                  <strong>Parser-Konfiguration anpassen:</strong> Gehen Sie zu Einstellungen →
                  Parser-Konfiguration und wählen Sie "Ollama" als Parser-Typ
                </li>
                <li>
                  <strong>Testen mit neuen Daten:</strong> Laden Sie neue E-Mails oder Boarding
                  Passes hoch und testen Sie die verbesserte Extraktion
                </li>
                <li>
                  <strong>Iteratives Training:</strong> Wenn die Ergebnisse noch nicht optimal
                  sind, fügen Sie mehr annotierte Daten hinzu und trainieren Sie erneut
                </li>
              </ul>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'technical',
      title: 'Technische Details',
      content: (
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              LoRA (Low-Rank Adaptation)
            </h3>
            <p className="text-gray-700 dark:text-gray-300 mb-2">
              LoRA ist eine effiziente Methode zum Fine-Tuning von großen Sprachmodellen. Statt das
              gesamte Modell neu zu trainieren, werden nur kleine, trainierbare Matrizen hinzugefügt.
            </p>
            <ul className="list-disc list-inside ml-4 space-y-1 text-gray-700 dark:text-gray-300">
              <li>
                <strong>Vorteile:</strong> Viel schneller und speichereffizienter als
                Full-Fine-Tuning
              </li>
              <li>
                <strong>Speicher:</strong> Benötigt nur wenige MB zusätzlichen Speicher statt GB
              </li>
              <li>
                <strong>Training:</strong> Kann auf CPU durchgeführt werden, ist aber auf GPU viel
                schneller
              </li>
            </ul>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              Base Model
            </h3>
            <p className="text-gray-700 dark:text-gray-300">
              Das Standard-Base-Modell ist <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">qwen2.5:7b</code>.
              Dieses Modell wird von Ollama bereitgestellt und muss vor dem ersten Training
              heruntergeladen werden (~4-5 GB).
            </p>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              Hyperparameter
            </h3>
            <div className="space-y-2 text-gray-700 dark:text-gray-300">
              <p>Die folgenden Hyperparameter werden verwendet:</p>
              <ul className="list-disc list-inside ml-4 space-y-1">
                <li>
                  <strong>Epochs:</strong> 3 (Anzahl der Durchläufe durch den gesamten Datensatz)
                </li>
                <li>
                  <strong>Learning Rate:</strong> 2e-4 (Wie schnell das Modell lernt)
                </li>
                <li>
                  <strong>Batch Size:</strong> Wird automatisch basierend auf verfügbarer Hardware
                  bestimmt
                </li>
                <li>
                  <strong>LoRA Rank:</strong> 8 (Größe der LoRA-Matrizen)
                </li>
                <li>
                  <strong>LoRA Alpha:</strong> 16 (Skalierungsfaktor)
                </li>
                <li>
                  <strong>Max Length:</strong> 2048 (Maximale Token-Länge pro Beispiel)
                </li>
              </ul>
              <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-lg p-4 mt-3">
                <p className="text-sm text-yellow-900 dark:text-yellow-100">
                  <strong>Hinweis:</strong> Diese Parameter sind für die meisten Anwendungsfälle
                  optimal. Änderungen erfordern Code-Anpassungen.
                </p>
              </div>
            </div>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              Hardware-Optimierung
            </h3>
            <div className="space-y-2 text-gray-700 dark:text-gray-300">
              <p>
                <strong>CPU vs. GPU:</strong>
              </p>
              <ul className="list-disc list-inside ml-4 space-y-1">
                <li>
                  <strong>CPU:</strong> Funktioniert, aber sehr langsam (2-8 Stunden). Nutzt alle
                  verfügbaren CPU-Kerne.
                </li>
                <li>
                  <strong>GPU:</strong> Deutlich schneller (30 Minuten - 2 Stunden). Erfordert
                  NVIDIA GPU mit CUDA Support. Automatische Erkennung und Nutzung.
                </li>
              </ul>
              <p className="mt-3">
                <strong>Speicher:</strong>
              </p>
              <ul className="list-disc list-inside ml-4 space-y-1">
                <li>
                  <strong>Base Model:</strong> ~4-5 GB RAM/VRAM
                </li>
                <li>
                  <strong>Training:</strong> +2-4 GB zusätzlich
                </li>
                <li>
                  <strong>Empfohlen:</strong> Mindestens 8 GB RAM, 16 GB+ für bessere Performance
                </li>
              </ul>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'troubleshooting',
      title: 'Troubleshooting',
      content: (
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              Häufige Fehler und Lösungen
            </h3>
            <div className="space-y-3">
              <div>
                <h4 className="font-semibold text-gray-900 dark:text-white">
                  "Training job failed" - Training fehlgeschlagen
                </h4>
                <ul className="list-disc list-inside ml-4 space-y-1 text-gray-700 dark:text-gray-300">
                  <li>
                    Prüfen Sie die Logs im Training Dashboard (klicken Sie auf "Details")
                  </li>
                  <li>
                    Häufige Ursachen: Zu wenig Speicher, Ollama nicht erreichbar, ungültige
                    Trainingsdaten
                  </li>
                  <li>
                    Lösung: Mehr RAM/VRAM bereitstellen, Ollama-Status prüfen, Datenqualität
                    überprüfen
                  </li>
                </ul>
              </div>
              <div>
                <h4 className="font-semibold text-gray-900 dark:text-white">
                  "Ollama model not found" - Modell nicht gefunden
                </h4>
                <ul className="list-disc list-inside ml-4 space-y-1 text-gray-700 dark:text-gray-300">
                  <li>
                    Das Base-Modell muss in Ollama verfügbar sein
                  </li>
                  <li>
                    Lösung: Führen Sie <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">ollama pull qwen2.5:7b</code> aus
                  </li>
                </ul>
              </div>
              <div>
                <h4 className="font-semibold text-gray-900 dark:text-white">
                  "CUDA out of memory" - GPU-Speicher voll
                </h4>
                <ul className="list-disc list-inside ml-4 space-y-1 text-gray-700 dark:text-gray-300">
                  <li>
                    Die GPU hat nicht genug VRAM
                  </li>
                  <li>
                    Lösung: Reduzieren Sie die Batch Size (Code-Anpassung) oder verwenden Sie CPU
                  </li>
                </ul>
              </div>
              <div>
                <h4 className="font-semibold text-gray-900 dark:text-white">
                  Training läuft sehr langsam
                </h4>
                <ul className="list-disc list-inside ml-4 space-y-1 text-gray-700 dark:text-gray-300">
                  <li>
                    CPU-Training ist deutlich langsamer als GPU-Training
                  </li>
                  <li>
                    Lösung: Verwenden Sie eine GPU, wenn verfügbar, oder reduzieren Sie die
                    Datenmenge
                  </li>
                </ul>
              </div>
            </div>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              Logs interpretieren
            </h3>
            <div className="space-y-2 text-gray-700 dark:text-gray-300">
              <p>
                Die Training-Logs enthalten wichtige Informationen:
              </p>
              <ul className="list-disc list-inside ml-4 space-y-1">
                <li>
                  <strong>Epoch/Step:</strong> Zeigt den Fortschritt (z.B. "Epoch 1/3, Step 10/50")
                </li>
                <li>
                  <strong>Loss:</strong> Sollte während des Trainings abnehmen. Steigender Loss
                  kann auf Overfitting hinweisen
                </li>
                <li>
                  <strong>Error-Messages:</strong> Zeigen spezifische Probleme an
                </li>
                <li>
                  <strong>Hardware-Info:</strong> Zeigt, ob CPU oder GPU verwendet wird
                </li>
              </ul>
            </div>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              Performance-Optimierung
            </h3>
            <ul className="list-disc list-inside ml-4 space-y-1 text-gray-700 dark:text-gray-300">
              <li>
                <strong>GPU verwenden:</strong> Deutlichste Performance-Verbesserung
              </li>
              <li>
                <strong>Mehr RAM:</strong> Ermöglicht größere Batch Sizes
              </li>
              <li>
                <strong>SSD statt HDD:</strong> Schnelleres Laden der Daten
              </li>
              <li>
                <strong>Weniger gleichzeitige Prozesse:</strong> Mehr Ressourcen für Training
              </li>
            </ul>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              Wann mehr Daten helfen
            </h3>
            <ul className="list-disc list-inside ml-4 space-y-1 text-gray-700 dark:text-gray-300">
              <li>
                Wenn das Modell bestimmte Airlines/Formate nicht erkennt
              </li>
              <li>
                Wenn die Extraktion inkonsistent ist
              </li>
              <li>
                Wenn neue, unbekannte Formate hinzukommen
              </li>
              <li>
                <strong>Aber:</strong> Qualität ist wichtiger als Quantität. 10 gut annotierte
                Einträge sind besser als 50 schlechte
              </li>
            </ul>
          </div>
        </div>
      ),
    },
    {
      id: 'best-practices',
      title: 'Best Practices',
      content: (
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              Datenqualität &gt; Datenmenge
            </h3>
            <p className="text-gray-700 dark:text-gray-300 mb-2">
              Es ist besser, weniger, aber hochwertige Daten zu haben, als viele schlechte Daten.
            </p>
            <ul className="list-disc list-inside ml-4 space-y-1 text-gray-700 dark:text-gray-300">
              <li>
                Korrigieren Sie alle Fehler sorgfältig während der Annotation
              </li>
              <li>
                Verwenden Sie verschiedene Airlines und Formate für bessere Abdeckung
              </li>
              <li>
                Stellen Sie sicher, dass alle Felder korrekt ausgefüllt sind
              </li>
            </ul>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              Regelmäßiges Training
            </h3>
            <ul className="list-disc list-inside ml-4 space-y-1 text-gray-700 dark:text-gray-300">
              <li>
                Trainieren Sie regelmäßig, wenn Sie neue Daten hinzufügen
              </li>
              <li>
                Jedes Training verbessert das vorherige Modell (inkrementelles Training)
              </li>
              <li>
                Beginnen Sie mit 5-10 Einträgen und fügen Sie nach und nach mehr hinzu
              </li>
            </ul>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              Tagging-Strategien
            </h3>
            <p className="text-gray-700 dark:text-gray-300 mb-2">
              Tags helfen, Daten zu organisieren und können für Filterung verwendet werden:
            </p>
            <ul className="list-disc list-inside ml-4 space-y-1 text-gray-700 dark:text-gray-300">
              <li>
                <strong>Airline:</strong> "lufthansa", "ryanair", "emirates"
              </li>
              <li>
                <strong>Klasse:</strong> "economy", "business", "first"
              </li>
              <li>
                <strong>Typ:</strong> "domestic", "international", "long-haul"
              </li>
              <li>
                <strong>Quelle:</strong> "email", "boarding-pass", "manual"
              </li>
            </ul>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              Backup vor Training
            </h3>
            <ul className="list-disc list-inside ml-4 space-y-1 text-gray-700 dark:text-gray-300">
              <li>
                Erstellen Sie ein Backup Ihrer Datenbank vor dem ersten Training
              </li>
              <li>
                Training-Daten werden nicht gelöscht, aber es ist gut, vorsichtig zu sein
              </li>
              <li>
                Verwenden Sie die Export-Funktion im Admin-Panel für Backups
              </li>
            </ul>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              Weitere Tipps
            </h3>
            <ul className="list-disc list-inside ml-4 space-y-1 text-gray-700 dark:text-gray-300">
              <li>
                Testen Sie das trainierte Modell immer mit neuen, nicht annotierten Daten
              </li>
              <li>
                Dokumentieren Sie, welche Daten Sie für welches Training verwendet haben
              </li>
              <li>
                Überwachen Sie die Loss-Werte: Sie sollten während des Trainings abnehmen
              </li>
              <li>
                Bei Problemen: Prüfen Sie die Logs zuerst, dann die Datenqualität
              </li>
            </ul>
          </div>
        </div>
      ),
    },
  ];

  return (
    <div className="max-w-4xl mx-auto">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
        <div className="p-6 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            Model Training Guide
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            Umfassende Anleitung zum Training von LLM-Modellen mit eigenen Daten
          </p>
        </div>

        <div className="divide-y divide-gray-200 dark:divide-gray-700">
          {sections.map((section) => {
            const isExpanded = expandedSections.has(section.id);
            return (
              <div key={section.id} className="border-b border-gray-200 dark:border-gray-700 last:border-b-0">
                <button
                  onClick={() => toggleSection(section.id)}
                  className="w-full px-6 py-4 text-left flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  <span className="text-lg font-semibold text-gray-900 dark:text-white">
                    {section.title}
                  </span>
                  <svg
                    className={`w-5 h-5 text-gray-500 dark:text-gray-400 transition-transform ${
                      isExpanded ? 'transform rotate-180' : ''
                    }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </button>
                {isExpanded && (
                  <div className="px-6 py-4 bg-gray-50 dark:bg-gray-900/50">
                    {section.content}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

