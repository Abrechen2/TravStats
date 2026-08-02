import { useEffect, useState } from "react";
import { airlinesApi } from "../../../lib/api/catalogue";
import type { Airline } from "../../../types/catalogue";
import { useTranslation } from "../../../hooks/useTranslation";
import { useToastStore } from "../../../store/toastStore";
import { logger } from "../../../lib/logger";

/**
 * Admin master data for airlines: a searchable list of the seeded catalogue
 * plus an "add custom" form. Split out of the former combined flight
 * master-data page so each catalogue is its own admin sub-section.
 */
export default function AirlinesSection(): JSX.Element {
  const { t } = useTranslation(["admin", "common"]);
  const addToast = useToastStore((s) => s.addToast);
  const [airlines, setAirlines] = useState<Airline[]>([]);
  const [query, setQuery] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const [newName, setNewName] = useState("");
  const [newIata, setNewIata] = useState("");
  const [newIcao, setNewIcao] = useState("");
  const [newCallsign, setNewCallsign] = useState("");
  const [newCountry, setNewCountry] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(() => {
      void (async () => {
        setLoading(true);
        try {
          const list = await airlinesApi.search(query);
          if (!cancelled) setAirlines(list);
        } catch (err) {
          logger.warn("Failed to load airlines", err);
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query]);

  const createAirline = async (): Promise<void> => {
    if (!newName.trim()) {
      addToast("error", t("admin:airlineAircraftMasterData.airline.missingFields"));
      return;
    }
    setCreating(true);
    try {
      const created = await airlinesApi.create({
        name: newName.trim(),
        iata: newIata.trim() || undefined,
        icao: newIcao.trim() || undefined,
        callsign: newCallsign.trim() || undefined,
        country: newCountry.trim() || undefined,
      });
      addToast("success", t("admin:airlineAircraftMasterData.airline.created"));
      setAirlines((prev) => [created, ...prev]);
      setNewName("");
      setNewIata("");
      setNewIcao("");
      setNewCallsign("");
      setNewCountry("");
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        t("admin:airlineAircraftMasterData.airline.createFailed");
      addToast("error", msg);
    } finally {
      setCreating(false);
    }
  };

  return (
    <section
      className="rounded-lg p-5"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
    >
      <header className="mb-4">
        <h3 className="text-lg font-semibold text-(--text-primary)">
          ✈ {t("admin:airlineAircraftMasterData.airline.title")}
        </h3>
        <p className="text-sm text-(--text-muted) mt-1">
          {t("admin:airlineAircraftMasterData.airline.description")}
        </p>
      </header>

      {/* Add form */}
      <div className="grid grid-cols-1 md:grid-cols-6 gap-2 mb-4">
        <input
          type="text"
          className="input"
          placeholder={t("admin:airlineAircraftMasterData.airline.name")}
          value={newName}
          onChange={(e): void => setNewName(e.target.value)}
        />
        <input
          type="text"
          className="input"
          placeholder="IATA"
          value={newIata}
          onChange={(e): void => setNewIata(e.target.value)}
        />
        <input
          type="text"
          className="input"
          placeholder="ICAO"
          value={newIcao}
          onChange={(e): void => setNewIcao(e.target.value)}
        />
        <input
          type="text"
          className="input"
          placeholder={t("admin:airlineAircraftMasterData.airline.callsign")}
          value={newCallsign}
          onChange={(e): void => setNewCallsign(e.target.value)}
        />
        <input
          type="text"
          className="input"
          placeholder={t("admin:airlineAircraftMasterData.airline.country")}
          value={newCountry}
          onChange={(e): void => setNewCountry(e.target.value)}
        />
        <button
          type="button"
          onClick={(): void => {
            void createAirline();
          }}
          disabled={creating}
          className="rounded-md bg-(--accent) px-3 py-2 text-sm font-medium text-(--bg-base) hover:bg-(--accent-dim) disabled:opacity-50"
        >
          {creating ? t("common:buttons.saving") : t("admin:airlineAircraftMasterData.airline.add")}
        </button>
      </div>

      {/* Search + list */}
      <input
        type="search"
        className="input mb-3"
        placeholder={t("admin:airlineAircraftMasterData.airline.searchPlaceholder")}
        value={query}
        onChange={(e): void => setQuery(e.target.value)}
      />

      {loading ? (
        <p className="text-sm text-(--text-muted)">{t("common:loading.default")}</p>
      ) : airlines.length === 0 ? (
        <p className="text-sm text-(--text-muted)">
          {t("admin:airlineAircraftMasterData.airline.empty")}
        </p>
      ) : (
        <ul
          className="divide-y max-h-[28rem] overflow-y-auto"
          style={{ borderColor: "var(--color-border)" }}
        >
          {airlines.slice(0, 50).map((a) => (
            <li key={a.id} className="flex items-center justify-between py-2 text-sm">
              <div>
                <span className="font-medium text-(--text-primary)">{a.name}</span>
                {a.country && <span className="text-(--text-muted)"> · {a.country}</span>}
              </div>
              <div className="flex items-center gap-2 text-xs">
                {a.isUserAdded && (
                  <span
                    className="px-2 py-0.5 rounded-full"
                    style={{
                      background: "var(--bg-elevated)",
                      color: "var(--accent)",
                      border: "1px solid var(--accent)",
                    }}
                  >
                    {t("admin:airlineAircraftMasterData.userAdded")}
                  </span>
                )}
                {a.iata && <span className="text-(--text-muted) font-mono">{a.iata}</span>}
                {a.icao && <span className="text-(--text-muted) font-mono">{a.icao}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
