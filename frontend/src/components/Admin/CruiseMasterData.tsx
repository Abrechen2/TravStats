import { useEffect, useState } from "react";
import { shipsApi, portsApi } from "../../lib/api/cruise";
import type { Ship, Port } from "../../types/cruise";
import { useTranslation } from "../../hooks/useTranslation";
import { useToastStore } from "../../store/toastStore";
import { logger } from "../../lib/logger";

/**
 * Admin-side CRUD (well — read + add) UI for cruise master data:
 * ships and ports. Read-only list with a search box on each side plus
 * an "add custom" form. User-added entries are flagged so they're
 * visible among the seeded catalog without getting overwritten by
 * future re-seed runs (backend-side idempotency logic already exists).
 *
 * Deliberately minimal for a first cut — delete / edit arrive when
 * users actually ask for them. Ship + port seed CSVs already cover
 * the common cases and the user-added rows let admins plug gaps.
 */
export default function CruiseMasterData(): JSX.Element {
  return (
    <div className="space-y-8">
      <ShipsSection />
      <PortsSection />
    </div>
  );
}

function ShipsSection(): JSX.Element {
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
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">
          🚢 {t("admin:cruiseMasterData.ship.title")}
        </h3>
        <p className="text-sm text-[var(--text-muted)] mt-1">
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
          className="rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--accent-dim)] disabled:opacity-50"
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
        <p className="text-sm text-[var(--text-muted)]">{t("common:loading")} …</p>
      ) : ships.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">{t("admin:cruiseMasterData.ship.empty")}</p>
      ) : (
        <ul className="divide-y" style={{ borderColor: "var(--color-border)" }}>
          {ships.slice(0, 50).map((s) => (
            <li key={s.id} className="flex items-center justify-between py-2 text-sm">
              <div>
                <span className="font-medium text-[var(--text-primary)]">{s.name}</span>
                <span className="text-[var(--text-muted)]"> · {s.cruiseLine}</span>
                {s.yearBuilt && <span className="text-[var(--text-muted)]"> · {s.yearBuilt}</span>}
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
                {s.imo && <span className="text-[var(--text-muted)] font-mono">IMO {s.imo}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PortsSection(): JSX.Element {
  const { t } = useTranslation(["admin", "cruise", "common"]);
  const addToast = useToastStore((s) => s.addToast);
  const [ports, setPorts] = useState<Port[]>([]);
  const [query, setQuery] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const [newName, setNewName] = useState("");
  const [newCity, setNewCity] = useState("");
  const [newCountry, setNewCountry] = useState("");
  const [newLat, setNewLat] = useState("");
  const [newLon, setNewLon] = useState("");
  const [newUnlocode, setNewUnlocode] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const list = await portsApi.search(query);
        if (!cancelled) setPorts(list);
      } catch (err) {
        logger.warn("Failed to load ports", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [query]);

  const createPort = async (): Promise<void> => {
    const lat = Number.parseFloat(newLat);
    const lon = Number.parseFloat(newLon);
    if (!newName.trim() || Number.isNaN(lat) || Number.isNaN(lon)) {
      addToast("error", t("admin:cruiseMasterData.port.missingFields"));
      return;
    }
    setCreating(true);
    try {
      const created = await portsApi.create({
        name: newName.trim(),
        city: newCity.trim() || undefined,
        country: newCountry.trim() || undefined,
        lat,
        lon,
        unlocode: newUnlocode.trim() || undefined,
      });
      addToast("success", t("admin:cruiseMasterData.port.created"));
      setPorts((prev) => [created, ...prev]);
      setNewName("");
      setNewCity("");
      setNewCountry("");
      setNewLat("");
      setNewLon("");
      setNewUnlocode("");
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        t("admin:cruiseMasterData.port.createFailed");
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
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">
          ⚓ {t("admin:cruiseMasterData.port.title")}
        </h3>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          {t("admin:cruiseMasterData.port.description")}
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-2">
        <input
          type="text"
          className="input"
          placeholder={t("admin:cruiseMasterData.port.name")}
          value={newName}
          onChange={(e): void => setNewName(e.target.value)}
        />
        <input
          type="text"
          className="input"
          placeholder={t("admin:cruiseMasterData.port.city")}
          value={newCity}
          onChange={(e): void => setNewCity(e.target.value)}
        />
        <input
          type="text"
          className="input"
          placeholder={t("admin:cruiseMasterData.port.country")}
          value={newCountry}
          onChange={(e): void => setNewCountry(e.target.value)}
        />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-4">
        <input
          type="number"
          step="any"
          className="input"
          style={{ colorScheme: "dark" }}
          placeholder={t("admin:cruiseMasterData.port.lat")}
          value={newLat}
          onChange={(e): void => setNewLat(e.target.value)}
        />
        <input
          type="number"
          step="any"
          className="input"
          style={{ colorScheme: "dark" }}
          placeholder={t("admin:cruiseMasterData.port.lon")}
          value={newLon}
          onChange={(e): void => setNewLon(e.target.value)}
        />
        <input
          type="text"
          className="input"
          placeholder="UN/LOCODE"
          value={newUnlocode}
          onChange={(e): void => setNewUnlocode(e.target.value)}
        />
        <button
          type="button"
          onClick={(): void => {
            void createPort();
          }}
          disabled={creating}
          className="rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--accent-dim)] disabled:opacity-50"
        >
          {creating ? t("common:buttons.saving") : t("admin:cruiseMasterData.port.add")}
        </button>
      </div>

      <input
        type="search"
        className="input mb-3"
        placeholder={t("admin:cruiseMasterData.port.searchPlaceholder")}
        value={query}
        onChange={(e): void => setQuery(e.target.value)}
      />

      {loading ? (
        <p className="text-sm text-[var(--text-muted)]">{t("common:loading")} …</p>
      ) : ports.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">{t("admin:cruiseMasterData.port.empty")}</p>
      ) : (
        <ul className="divide-y" style={{ borderColor: "var(--color-border)" }}>
          {ports.slice(0, 50).map((p) => (
            <li key={p.id} className="flex items-center justify-between py-2 text-sm">
              <div>
                <span className="font-medium text-[var(--text-primary)]">{p.name}</span>
                {p.city && <span className="text-[var(--text-muted)]"> · {p.city}</span>}
                {p.country && <span className="text-[var(--text-muted)]"> · {p.country}</span>}
              </div>
              <div className="flex items-center gap-2 text-xs">
                {p.isUserAdded && (
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
                {p.unlocode && (
                  <span className="text-[var(--text-muted)] font-mono">{p.unlocode}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
