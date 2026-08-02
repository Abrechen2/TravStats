import { useEffect, useState } from "react";
import { shipsApi } from "../../../lib/api/cruise";
import type { Ship } from "../../../types/cruise";
import { useTranslation } from "../../../hooks/useTranslation";
import { useToastStore } from "../../../store/toastStore";
import { logger } from "../../../lib/logger";

/**
 * Admin master data for ships. Split out of the former combined cruise
 * master-data page so ships and ports are separate admin sub-sections,
 * mirroring the flight side.
 */
export default function ShipsSection(): JSX.Element {
  const { t } = useTranslation(["admin", "cruise", "common"]);
  const addToast = useToastStore((s) => s.addToast);
  const [ships, setShips] = useState<Ship[]>([]);
  const [query, setQuery] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const [newName, setNewName] = useState("");
  const [newLine, setNewLine] = useState("");
  const [newImo, setNewImo] = useState("");
  const [newYear, setNewYear] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const list = await shipsApi.search(query);
        if (!cancelled) setShips(list);
      } catch (err) {
        logger.warn("Failed to load ships", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [query]);

  const createShip = async (): Promise<void> => {
    if (!newName.trim() || !newLine.trim()) {
      addToast("error", t("admin:cruiseMasterData.ship.missingFields"));
      return;
    }
    setCreating(true);
    try {
      const created = await shipsApi.create({
        name: newName.trim(),
        cruiseLine: newLine.trim(),
        imo: newImo.trim() || undefined,
        yearBuilt: newYear ? Number.parseInt(newYear, 10) : undefined,
      });
      addToast("success", t("admin:cruiseMasterData.ship.created"));
      setShips((prev) => [created, ...prev]);
      setNewName("");
      setNewLine("");
      setNewImo("");
      setNewYear("");
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        t("admin:cruiseMasterData.ship.createFailed");
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
          🚢 {t("admin:cruiseMasterData.ship.title")}
        </h3>
        <p className="text-sm text-(--text-muted) mt-1">
          {t("admin:cruiseMasterData.ship.description")}
        </p>
      </header>

      {/* Add form */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-2 mb-4">
        <input
          type="text"
          className="input"
          placeholder={t("admin:cruiseMasterData.ship.name")}
          value={newName}
          onChange={(e): void => setNewName(e.target.value)}
        />
        <input
          type="text"
          className="input"
          placeholder={t("admin:cruiseMasterData.ship.cruiseLine")}
          value={newLine}
          onChange={(e): void => setNewLine(e.target.value)}
        />
        <input
          type="text"
          className="input"
          placeholder="IMO"
          value={newImo}
          onChange={(e): void => setNewImo(e.target.value)}
        />
        <input
          type="number"
          className="input"
          placeholder={t("admin:cruiseMasterData.ship.year")}
          value={newYear}
          onChange={(e): void => setNewYear(e.target.value)}
        />
        <button
          type="button"
          onClick={(): void => {
            void createShip();
          }}
          disabled={creating}
          className="rounded-md bg-(--accent) px-3 py-2 text-sm font-medium text-(--bg-base) hover:bg-(--accent-dim) disabled:opacity-50"
        >
          {creating ? t("common:buttons.saving") : t("admin:cruiseMasterData.ship.add")}
        </button>
      </div>

      {/* Search + list */}
      <input
        type="search"
        className="input mb-3"
        placeholder={t("admin:cruiseMasterData.ship.searchPlaceholder")}
        value={query}
        onChange={(e): void => setQuery(e.target.value)}
      />

      {loading ? (
        <p className="text-sm text-(--text-muted)">{t("common:loading.default")}</p>
      ) : ships.length === 0 ? (
        <p className="text-sm text-(--text-muted)">{t("admin:cruiseMasterData.ship.empty")}</p>
      ) : (
        <ul
          className="divide-y max-h-[28rem] overflow-y-auto"
          style={{ borderColor: "var(--color-border)" }}
        >
          {ships.slice(0, 50).map((s) => (
            <li key={s.id} className="flex items-center justify-between py-2 text-sm">
              <div>
                <span className="font-medium text-(--text-primary)">{s.name}</span>
                <span className="text-(--text-muted)"> · {s.cruiseLine}</span>
                {s.yearBuilt && <span className="text-(--text-muted)"> · {s.yearBuilt}</span>}
              </div>
              <div className="flex items-center gap-2 text-xs">
                {s.isUserAdded && (
                  <span
                    className="px-2 py-0.5 rounded-full"
                    style={{
                      background: "var(--bg-elevated)",
                      color: "var(--accent)",
                      border: "1px solid var(--accent)",
                    }}
                  >
                    {t("admin:cruiseMasterData.userAdded")}
                  </span>
                )}
                {s.imo && <span className="text-(--text-muted) font-mono">IMO {s.imo}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

