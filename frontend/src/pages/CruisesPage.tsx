import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { cruiseApi } from "../lib/api";
import type { Cruise } from "../types";
import { CruiseRow } from "../components/Cruise/CruiseRow";
import { CruiseEditModal } from "../components/Cruise/CruiseEditModal";
import { useTranslation } from "../hooks/useTranslation";

export default function CruisesPage(): JSX.Element {
  const { t } = useTranslation("cruise");
  const navigate = useNavigate();
  const [cruises, setCruises] = useState<Cruise[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [showCreate, setShowCreate] = useState<boolean>(false);

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const data = await cruiseApi.list();
      setCruises(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-neutral-100">{t("list.title")}</h1>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="rounded-md bg-amber-500 px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-amber-400"
        >
          {t("list.new")}
        </button>
      </div>

      {loading ? (
        <div className="text-neutral-400">Loading …</div>
      ) : cruises.length === 0 ? (
        <div className="rounded-md border border-neutral-800 bg-neutral-900 px-4 py-8 text-center text-neutral-400">
          {t("list.empty")}
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-900 text-neutral-400">
              <tr>
                <th className="px-3 py-2 text-left">{t("list.columns.ship")}</th>
                <th className="px-3 py-2 text-left">{t("list.columns.line")}</th>
                <th className="px-3 py-2 text-left">{t("list.columns.dates")}</th>
                <th className="px-3 py-2 text-left">{t("list.columns.ports")}</th>
                <th className="px-3 py-2 text-left">{t("list.columns.status")}</th>
                <th className="px-3 py-2 text-left">{t("list.columns.cabin")}</th>
                <th className="px-3 py-2 text-right">{t("list.columns.price")}</th>
              </tr>
            </thead>
            <tbody>
              {cruises.map((c) => (
                <CruiseRow key={c.id} cruise={c} onOpen={() => navigate(`/cruises/${c.id}`)} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <CruiseEditModal
          mode="create"
          onClose={() => setShowCreate(false)}
          onSaved={async () => {
            setShowCreate(false);
            await reload();
          }}
        />
      )}
    </div>
  );
}
