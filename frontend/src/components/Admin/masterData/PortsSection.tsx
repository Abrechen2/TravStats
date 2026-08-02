import { useEffect, useState } from "react";
import { portsApi } from "../../../lib/api/cruise";
import type { Port } from "../../../types/cruise";
import { useTranslation } from "../../../hooks/useTranslation";
import { useToastStore } from "../../../store/toastStore";
import { logger } from "../../../lib/logger";

/** Admin master data for ports. See ShipsSection for the shape. */
export default function PortsSection(): JSX.Element {
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
        <h3 className="text-lg font-semibold text-(--text-primary)">
          ⚓ {t("admin:cruiseMasterData.port.title")}
        </h3>
        <p className="text-sm text-(--text-muted) mt-1">
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
          className="rounded-md bg-(--accent) px-3 py-2 text-sm font-medium text-(--bg-base) hover:bg-(--accent-dim) disabled:opacity-50"
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
        <p className="text-sm text-(--text-muted)">{t("common:loading.default")}</p>
      ) : ports.length === 0 ? (
        <p className="text-sm text-(--text-muted)">{t("admin:cruiseMasterData.port.empty")}</p>
      ) : (
        <ul
          className="divide-y max-h-[28rem] overflow-y-auto"
          style={{ borderColor: "var(--color-border)" }}
        >
          {ports.slice(0, 50).map((p) => (
            <li key={p.id} className="flex items-center justify-between py-2 text-sm">
              <div>
                <span className="font-medium text-(--text-primary)">{p.name}</span>
                {p.city && <span className="text-(--text-muted)"> · {p.city}</span>}
                {p.country && <span className="text-(--text-muted)"> · {p.country}</span>}
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
                  <span className="text-(--text-muted) font-mono">{p.unlocode}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
