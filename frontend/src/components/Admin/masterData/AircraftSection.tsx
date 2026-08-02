import { useEffect, useState } from "react";
import { aircraftApi } from "../../../lib/api/catalogue";
import type { Aircraft } from "../../../types/catalogue";
import { useTranslation } from "../../../hooks/useTranslation";
import { useToastStore } from "../../../store/toastStore";
import { logger } from "../../../lib/logger";

/** Admin master data for aircraft types. See AirlinesSection for the shape. */
export default function AircraftSection(): JSX.Element {
  const { t } = useTranslation(["admin", "common"]);
  const addToast = useToastStore((s) => s.addToast);
  const [aircraft, setAircraft] = useState<Aircraft[]>([]);
  const [query, setQuery] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);

  const [newName, setNewName] = useState("");
  const [newIcao, setNewIcao] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(() => {
      void (async () => {
        setLoading(true);
        try {
          const list = await aircraftApi.list(query);
          if (!cancelled) {
            setAircraft(list.items);
            setTotal(list.total);
          }
        } catch (err) {
          logger.warn("Failed to load aircraft", err);
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

  const createAircraft = async (): Promise<void> => {
    if (!newName.trim()) {
      addToast("error", t("admin:airlineAircraftMasterData.aircraft.missingFields"));
      return;
    }
    setCreating(true);
    try {
      const created = await aircraftApi.create({
        name: newName.trim(),
        icao: newIcao.trim() || undefined,
      });
      addToast("success", t("admin:airlineAircraftMasterData.aircraft.created"));
      setAircraft((prev) => [created, ...prev]);
      setNewName("");
      setNewIcao("");
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        t("admin:airlineAircraftMasterData.aircraft.createFailed");
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
          🛩 {t("admin:airlineAircraftMasterData.aircraft.title")}
        </h3>
        <p className="text-sm text-(--text-muted) mt-1">
          {t("admin:airlineAircraftMasterData.aircraft.description")}
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-4">
        <input
          type="text"
          className="input"
          placeholder={t("admin:airlineAircraftMasterData.aircraft.name")}
          value={newName}
          onChange={(e): void => setNewName(e.target.value)}
        />
        <input
          type="text"
          className="input"
          placeholder="ICAO"
          value={newIcao}
          onChange={(e): void => setNewIcao(e.target.value)}
        />
        <button
          type="button"
          onClick={(): void => {
            void createAircraft();
          }}
          disabled={creating}
          className="rounded-md bg-(--accent) px-3 py-2 text-sm font-medium text-(--bg-base) hover:bg-(--accent-dim) disabled:opacity-50"
        >
          {creating ? t("common:buttons.saving") : t("admin:airlineAircraftMasterData.aircraft.add")}
        </button>
      </div>

      <input
        type="search"
        className="input mb-3"
        placeholder={t("admin:airlineAircraftMasterData.aircraft.searchPlaceholder")}
        value={query}
        onChange={(e): void => setQuery(e.target.value)}
      />

      {loading ? (
        <p className="text-sm text-(--text-muted)">{t("common:loading.default")}</p>
      ) : aircraft.length === 0 ? (
        <p className="text-sm text-(--text-muted)">
          {t("admin:airlineAircraftMasterData.aircraft.empty")}
        </p>
      ) : (
        <ul
          className="divide-y max-h-[28rem] overflow-y-auto"
          style={{ borderColor: "var(--color-border)" }}
        >
          {aircraft.map((ac) => (
            <li key={ac.id} className="flex items-center justify-between py-2 text-sm">
              <div>
                <span className="font-medium text-(--text-primary)">{ac.name}</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                {ac.isUserAdded && (
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
                {ac.icao && <span className="text-(--text-muted) font-mono">{ac.icao}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {total > aircraft.length && (
        <p className="mt-2 text-xs text-(--text-muted)">
          {t("admin:masterData.showingOf", { shown: aircraft.length, total })}
        </p>
      )}
    </section>
  );
}
