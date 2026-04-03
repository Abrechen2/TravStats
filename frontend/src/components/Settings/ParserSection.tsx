import { SectionCard, SectionTitle } from "./SettingsShared";
import InlineHelp from "../Help/InlineHelp";
import ParserConfiguration from "./ParserConfiguration";
import TemplateStatusView from "../TemplateStatusView";
import { useTranslation } from "../../hooks/useTranslation";
import { settingsApi } from "../../lib/api";
import { useToastStore } from "../../store/toastStore";
import { logger } from "../../lib/logger";

interface ParserSectionProps {
  boardingPassParserStrategy: string | null;
  onSetBoardingPassParserStrategy: (
    value: "parser-only" | "parser-with-api" | "api-only" | null
  ) => void;
}

export default function ParserSection({
  boardingPassParserStrategy,
  onSetBoardingPassParserStrategy,
}: ParserSectionProps): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const addToast = useToastStore((state) => state.addToast);

  return (
    <SectionCard>
      <SectionTitle
        title={t("settings:parser.title")}
        description={t("settings:parser.description")}
      />
      <InlineHelp
        title="Boarding Pass Parsing Strategien"
        category="basic"
        content={
          <div className="space-y-2">
            <p>Die App unterstützt verschiedene Strategien für das Parsing von Boarding-Pässen:</p>
            <ul className="list-disc list-inside space-y-1 ml-2 text-sm">
              <li>
                <strong>Automatisch:</strong> LLM wird bevorzugt (wenn verfügbar), sonst
                Barcode-Parser mit LLM-Fallback
              </li>
              <li>
                <strong>Nur Parser:</strong> Nur schneller Frontend-Parser, kein API-Call (offline,
                kostenlos)
              </li>
              <li>
                <strong>Parser + API Kontrolle:</strong> Parser für Geschwindigkeit, API zur
                Validierung
              </li>
              <li>
                <strong>Nur API:</strong> Direkt LLM/API verwenden (robust, funktioniert für alle
                Airlines)
              </li>
            </ul>
          </div>
        }
      />
      <div>
        <label className="label">Parsing-Strategie</label>
        <select
          value={boardingPassParserStrategy || "auto"}
          onChange={async (e) => {
            const value =
              e.target.value === "auto"
                ? null
                : (e.target.value as "parser-only" | "parser-with-api" | "api-only");
            onSetBoardingPassParserStrategy(value);
            try {
              await settingsApi.update({ boardingPassParserStrategy: value });
              addToast("success", "Boarding Pass Parser-Strategie gespeichert");
            } catch (error) {
              logger.error("Failed to save boarding pass parser strategy:", error);
              addToast("error", "Fehler beim Speichern");
            }
          }}
          className="input"
        >
          <option value="auto">Automatisch (Empfohlen)</option>
          <option value="parser-only">Nur Parser</option>
          <option value="parser-with-api">Parser + API Kontrolle</option>
          <option value="api-only">Nur API</option>
        </select>
        <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
          {boardingPassParserStrategy === null
            ? "LLM wird bevorzugt, wenn verfügbar. Sonst Barcode-Parser mit LLM-Fallback."
            : boardingPassParserStrategy === "parser-only"
              ? "Nur Frontend-Parser. Schnell, kostenlos, offline. Kein Fallback."
              : boardingPassParserStrategy === "parser-with-api"
                ? "Parser für Geschwindigkeit, API zur Validierung. Beste Balance."
                : "Direkt LLM/API verwenden. Robust, funktioniert für alle Airlines."}
        </p>
      </div>
      <ParserConfiguration />
      <TemplateStatusView />
    </SectionCard>
  );
}
