import { useEffect, useState } from "react";
import { airportsApi } from "../../../lib/api/airports";
import type { Airport } from "../../../lib/api";
import { useTranslation } from "../../../hooks/useTranslation";
import { useToastStore } from "../../../store/toastStore";
import { logger } from "../../../lib/logger";

/**
 * Admin master data for airports (#191). Codes are optional on purpose — a
 * private airfield legitimately has neither IATA nor ICAO; name plus
 * coordinates carry the autocomplete and the distance math, and the timezone
 * is derived server-side from the coordinates.
 */
export default function AirportsSection(): JSX.Element {
  const { t } = useTranslation(["admin", "common"]);
  const addToast = useToastStore((s) => s.addToast);
  const [airports, setAirports] = useState<Airport[]>([]);
  const [query, setQuery] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const [newName, setNewName] = useState("");
  const [newIata, setNewIata] = useState("");
  const [newIcao, setNewIcao] = useState("");
  const [newCity, setNewCity] = useState("");
  const [newCountry, setNewCountry] = useState("");
  const [newLat, setNewLat] = useState("");
  const [newLon, setNewLon] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    // The airport search endpoint needs at least two characters — unlike the
    // airline/aircraft catalogues there is no browse-all mode over ~18k rows.
    if (query.trim().length < 2) {
      setAirports([]);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      void (async () => {
        setLoading(true);
        try {
          const list = await airportsApi.search(query);
          if (!cancelled) setAirports(list);
        } catch (err) {
          logger.warn("Failed to load airports", err);
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

  const createAirport = async (): Promise<void> => {
    if (!newName.trim() || !newLat.trim() || !newLon.trim()) {
      addToast("error", t("admin:airlineAircraftMasterData.airport.missingFields"));
      return;
    }
    const lat = Number(newLat.replace(",", "."));
    const lon = Number(newLon.replace(",", "."));
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      addToast("error", t("admin:airlineAircraftMasterData.airport.invalidCoords"));
      return;
    }
    setCreating(true);
    try {
      const created = await airportsApi.create({
        name: newName.trim(),
        iata: newIata.trim() || undefined,
        icao: newIcao.trim() || undefined,
        city: newCity.trim() || undefined,
        country: newCountry.trim() || undefined,
        lat,
        lon,
      });
      addToast("success", t("admin:airlineAircraftMasterData.airport.created"));
      setAirports((prev) => [created, ...prev]);
      setNewName("");
      setNewIata("");
      setNewIcao("");
      setNewCity("");
      setNewCountry("");
      setNewLat("");
      setNewLon("");
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        t("admin:airlineAircraftMasterData.airport.createFailed");
      addToast("error", msg);
    } finally {
      setCreating(false);
    }
  };

  return (
    <section
      data-testid="admin-airports-section"
      className="rounded-lg p-5"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
    >
      <header className="mb-4">
        <h3 className="text-lg font-semibold text-(--text-primary)">
          🛬 {t("admin:airlineAircraftMasterData.airport.title")}
        </h3>
        <p className="text-sm text-(--text-muted) mt-1">
          {t("admin:airlineAircraftMasterData.airport.description")}
        </p>
      </header>

      {/* Add form */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-4">
        <input
          type="text"
          className="input"
          placeholder={t("admin:airlineAircraftMasterData.airport.name")}
          value={newName}
          onChange={(e): void => setNewName(e.target.value)}
        />
        <input
          type="text"
          className="input"
          placeholder="IATA"
          maxLength={3}
          value={newIata}
          onChange={(e): void => setNewIata(e.target.value.toUpperCase())}
        />
        <input
          type="text"
          className="input"
          placeholder="ICAO"
          maxLength={4}
          value={newIcao}
          onChange={(e): void => setNewIcao(e.target.value.toUpperCase())}
        />
        <input
          type="text"
          className="input"
          placeholder={t("admin:airlineAircraftMasterData.airport.city")}
          value={newCity}
          onChange={(e): void => setNewCity(e.target.value)}
        />
        <input
          type="text"
          className="input"
          placeholder={t("admin:airlineAircraftMasterData.airport.country")}
          maxLength={2}
          value={newCountry}
          onChange={(e): void => setNewCountry(e.target.value.toUpperCase())}
        />
        <input
          type="text"
          inputMode="decimal"
          className="input"
          placeholder={t("admin:airlineAircraftMasterData.airport.lat")}
          value={newLat}
          onChange={(e): void => setNewLat(e.target.value)}
        />
        <input
          type="text"
          inputMode="decimal"
          className="input"
          placeholder={t("admin:airlineAircraftMasterData.airport.lon")}
          value={newLon}
          onChange={(e): void => setNewLon(e.target.value)}
        />
        <button
          type="button"
          onClick={(): void => {
            void createAirport();
          }}
          disabled={creating}
          className="rounded-md bg-(--accent) px-3 py-2 text-sm font-medium text-(--bg-base) hover:bg-(--accent-dim) disabled:opacity-50"
        >
          {creating ? t("common:buttons.saving") : t("admin:airlineAircraftMasterData.airport.add")}
        </button>
      </div>

      {/* Search + list */}
      <input
        type="search"
        className="input mb-3"
        placeholder={t("admin:airlineAircraftMasterData.airport.searchPlaceholder")}
        value={query}
        onChange={(e): void => setQuery(e.target.value)}
      />

      {loading ? (
        <p className="text-sm text-(--text-muted)">{t("common:loading.default")}</p>
      ) : airports.length === 0 ? (
        <p className="text-sm text-(--text-muted)">
          {t("admin:airlineAircraftMasterData.airport.empty")}
        </p>
      ) : (
        <ul
          className="divide-y max-h-[28rem] overflow-y-auto"
          style={{ borderColor: "var(--color-border)" }}
        >
          {airports.slice(0, 50).map((a) => (
            <li key={a.id ?? `${a.name}-${a.lat}`} className="flex items-center justify-between py-2 text-sm">
              <div>
                <span className="font-medium text-(--text-primary)">{a.name}</span>
                {a.city && <span className="text-(--text-muted)"> · {a.city}</span>}
                {a.country && <span className="text-(--text-muted)"> ({a.country})</span>}
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
