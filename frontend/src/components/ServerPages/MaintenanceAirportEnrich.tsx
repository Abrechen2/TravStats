import { useState, type JSX } from "react";
import axios from "axios";
import { airportsApi } from "../../lib/api/airports";
import { logger } from "../../lib/logger";
import { useTranslation } from "../../hooks/useTranslation";
import { ActionControl, InputControl, SettingItem } from "../ui/settings";

type EnrichFailure =
  "invalidCode" | "notFound" | "forbidden" | "rateLimited" | "unreachable" | "failed";

const CODE_SHAPE = /^(?:[A-Za-z]{3}|[A-Za-z]{4})$/;

/** Why a fetch failed, as its own reason (a 404 and an unreachable source are not the same). */
export function enrichFailureOf(error: unknown): EnrichFailure {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    if (status === 404) return "notFound";
    if (status === 400) return "invalidCode";
    if (status === 401 || status === 403) return "forbidden";
    if (status === 429) return "rateLimited";
    if (status === 503 || !error.response) return "unreachable";
  }
  return "failed";
}

/**
 * Maintenance › System: "Flughafen nachladen" — `POST /airports/enrich` for one
 * IATA/ICAO code (forgejo#407). A single lookup, not a job; the answer or the
 * reason it failed stays under the row.
 */
export default function MaintenanceAirportEnrich(): JSX.Element {
  const { t } = useTranslation(["settingsRows"]);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<string | null>(null);
  const [failure, setFailure] = useState<EnrichFailure | null>(null);

  const run = async (): Promise<void> => {
    setFound(null);
    if (!CODE_SHAPE.test(code.trim())) {
      setFailure("invalidCode");
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      const airport = await airportsApi.enrich(code);
      setFound(
        t("settingsRows:maintenance.enrich.found", {
          name: airport.name ?? code.trim().toUpperCase(),
          code: airport.iata ?? airport.icao ?? code.trim().toUpperCase(),
        })
      );
    } catch (error) {
      logger.error("Failed to fetch the airport:", error);
      setFailure(enrichFailureOf(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingItem
      title={t("settingsRows:maintenance.enrich.t")}
      sub={t("settingsRows:maintenance.enrich.s")}
      help={t("settingsRows:maintenance.enrich.h")}
      scope="allAccounts"
      expert
      error={failure ? t(`settingsRows:maintenance.enrich.failure.${failure}`) : undefined}
      control={
        <div className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-sm)" }}>
          <InputControl
            value={code}
            onChange={(next) => {
              setCode(next);
              setFailure(null);
              setFound(null);
            }}
            placeholder={t("settingsRows:maintenance.enrich.placeholder")}
          />
          <ActionControl
            label={t("settingsRows:maintenance.enrich.action")}
            busy={busy}
            disabled={code.trim() === ""}
            onClick={() => void run()}
          />
        </div>
      }
    >
      {found ? (
        <p role="status" className="text-sm" style={{ color: "var(--ts-muted)" }}>
          {found}
        </p>
      ) : null}
    </SettingItem>
  );
}
