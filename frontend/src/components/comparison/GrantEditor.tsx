import { sourceData, type SourceData } from "../../lib/comparison/transport";
import { downloadBlob } from "./DevicePanel";
import { comparisonFieldLabel } from "./fieldLabel";
import { useState } from "react";
import { Button } from "../ui";
import { useTranslation } from "../../hooks/useTranslation";
import {
  comparisonPost,
  type Link,
  type RecordPage,
  type Scope,
  type Snapshot,
} from "../../lib/api/comparison";

export function initialScope(domains: string[]): Scope {
  return {
    statistics: false,
    details: false,
    costs: false,
    personal: false,
    photos: false,
    documents: false,
    domains,
    tripIds: [],
    futureTrips: false,
    year: null,
    precision: "exact",
    expiresAt: null,
  };
}
export default function GrantEditor({
  link,
  domains,
  trips,
  onSaved,
  onClose,
  onAuthorize,
}: {
  link: Link;
  domains: string[];
  trips: Array<{ id: string; name: string }>;
  onSaved: () => void;
  onClose: () => void;
  onAuthorize?: (scope: Scope, data: SourceData) => Promise<void>;
}) {
  const { t } = useTranslation("comparison");
  const [scope, setScope] = useState<Scope>(() => {
    const previous = link.grants.find((g) => g.active && g.audience === "")?.scope;
    if (!previous) return initialScope(domains);
    const restored: Scope = {
      ...initialScope(domains),
      ...Object.fromEntries(
        Object.keys(initialScope(domains)).map((k) => [k, previous[k as keyof Scope]])
      ),
    };
    // The server stores "all existing trips" with the ids it resolved. Sending those ids back
    // froze the grant to that list and dropped the trip-less records it also covered.
    return previous.allExisting ? { ...restored, tripIds: [], futureTrips: false } : restored;
  });
  const [fullPreview, setFullPreview] = useState<SourceData | null>(null);
  const [recordPreview, setRecordPreview] = useState<RecordPage | null>(null);
  const [preview, setPreview] = useState<Snapshot | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(false),
    [accepted, setAccepted] = useState(false);
  const change = (next: Scope) => {
    setScope(next);
    setPreview(null);
    setFullPreview(null);
    setRecordPreview(null);
    setAccepted(false);
  };
  const run = async (save: boolean) => {
    setBusy(true);
    setError(false);
    try {
      if (save) {
        if (onAuthorize) {
          if (!fullPreview) throw Error("preview");
          await onAuthorize(scope, fullPreview);
        } else await comparisonPost(`/links/${link.id}/grant`, { audience: "", scope });
        onSaved();
      } else if (onAuthorize) {
        const data = await sourceData(scope);
        setFullPreview(data);
        setPreview(data.snapshot);
      } else setPreview(await comparisonPost<Snapshot>("/preview", scope));
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  const categories = ["statistics", "details", "costs", "personal", "photos", "documents"] as const;
  return (
    <section
      className="rounded-2xl border border-[var(--ts-border)] p-5 space-y-4"
      aria-label={t("grantTitle")}
    >
      <h2 className="text-xl font-bold">{t("grantFor", { name: link.label })}</h2>
      <p>{link.origin === "local" ? t("local") : link.origin}</p>
      <p className="text-sm text-[var(--text-muted)]">{t("supported")}</p>
      <Button
        disabled={busy}
        onClick={() =>
          change({
            ...scope,
            statistics: true,
            details: true,
            costs: true,
            personal: true,
            photos: true,
            documents: true,
          })
        }
      >
        {t("allSupported")}
      </Button>
      <div className="flex flex-wrap gap-4">
        {categories.map((category) => (
          <label key={category} className="flex gap-2">
            <input
              type="checkbox"
              checked={scope[category]}
              onChange={(e) =>
                change({
                  ...scope,
                  [category]: e.target.checked,
                  ...(category === "details" && !e.target.checked
                    ? { personal: false, documents: false, photos: false }
                    : {}),
                })
              }
              disabled={
                busy || (["personal", "documents", "photos"].includes(category) && !scope.details)
              }
            />
            {t(`category.${category}`)}
          </label>
        ))}
      </div>
      <fieldset>
        <legend>{t("domains")}</legend>
        <div className="flex flex-wrap gap-3">
          {domains.map((domain) => (
            <label key={domain}>
              <input
                type="checkbox"
                checked={scope.domains.includes(domain)}
                onChange={(e) =>
                  change({
                    ...scope,
                    domains: e.target.checked
                      ? [...scope.domains, domain]
                      : scope.domains.filter((d) => d !== domain),
                  })
                }
              />
              {t(`common:domain.${domain}`)}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="block">
        {t("year")}{" "}
        <input
          aria-label={t("year")}
          type="number"
          min={1900}
          max={2200}
          value={scope.year ?? ""}
          placeholder={t("lifetime")}
          onChange={(e) =>
            change({ ...scope, year: e.target.value ? Number(e.target.value) : null })
          }
        />
      </label>
      <label className="block">
        <input
          type="checkbox"
          checked={scope.futureTrips}
          onChange={(e) => change({ ...scope, futureTrips: e.target.checked })}
        />{" "}
        {t("future")}
      </label>
      <label className="block">
        {t("precision")}{" "}
        <select
          value={scope.precision}
          onChange={(e) => change({ ...scope, precision: e.target.value as Scope["precision"] })}
        >
          <option value="exact">{t("exact")}</option>
          <option value="rounded">{t("rounded")}</option>
        </select>
      </label>
      <fieldset>
        <legend>{t("tripSelection")}</legend>
        <p className="text-sm">{t("tripSelectionHelp")}</p>
        <div className="max-h-40 overflow-y-auto">
          {trips.map((trip) => (
            <label className="block" key={trip.id}>
              <input
                type="checkbox"
                checked={scope.tripIds.includes(trip.id)}
                onChange={(e) =>
                  change({
                    ...scope,
                    tripIds: e.target.checked
                      ? [...scope.tripIds, trip.id]
                      : scope.tripIds.filter((id) => id !== trip.id),
                  })
                }
              />
              {trip.name}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="block">
        {t("expiry")}{" "}
        <input
          type="date"
          onChange={(e) =>
            change({
              ...scope,
              expiresAt: e.target.value ? `${e.target.value}T23:59:59.000Z` : null,
            })
          }
        />
      </label>
      {error && <p role="alert">{t("error")}</p>}
      {scope.details && (
        <div className="space-y-2">
          <p>{t("recordPreview")}</p>
          <div className="flex flex-wrap gap-2">
            {scope.domains.map((domain) => (
              <Button
                key={domain}
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void comparisonPost<RecordPage>("/preview/records", { scope, domain })
                    .then(setRecordPreview)
                    .catch(() => setError(true))
                    .finally(() => setBusy(false));
                }}
              >
                {t(`common:domain.${domain}`)}
              </Button>
            ))}
          </div>
          {recordPreview && (
            <div className="max-h-64 overflow-y-auto">
              {recordPreview.rows.slice(0, 5).map((row) => (
                <dl className="grid grid-cols-2 gap-2 border-t py-3" key={row.key}>
                  {row.fields
                    .filter((f) => f.value !== null && f.value !== "")
                    .map((f) => (
                      <div key={f.name}>
                        <dt>{comparisonFieldLabel(t, recordPreview.domain, f.name)}</dt>
                        <dd>{String(f.value)}</dd>
                      </div>
                    ))}
                </dl>
              ))}
            </div>
          )}
        </div>
      )}
      {preview && (
        <div className="rounded-xl bg-[var(--ts-surface)] p-4">
          <h3>{t("preview")}</h3>
          <dl className="grid grid-cols-2 gap-2">
            {Object.entries(preview.metrics).map(([key, value]) => (
              <div key={key}>
                <dt>{t(`metric.${key}`)}</dt>
                <dd>{value ?? "—"}</dd>
              </div>
            ))}
          </dl>
          <p>{t("tripCount", { count: preview.trips.length })}</p>
          {fullPreview && (
            <div className="space-y-2">
              <h4>{t("e2e.previewContents")}</h4>
              <ul>
                {Object.entries(fullPreview.sections).map(([name, rows]) => (
                  <li key={name}>
                    {t(`e2e.section.${name}`, { defaultValue: name })}: {rows.length}
                  </li>
                ))}
              </ul>
              <p>{t("e2e.files", { count: fullPreview.assets.length })}</p>
              <details>
                <summary>{t("e2e.fileList")}</summary>
                <ul>
                  {fullPreview.assets.map((f) => (
                    <li key={f.key}>
                      {f.name} · {f.size ?? "?"} B
                    </li>
                  ))}
                </ul>
              </details>
              {fullPreview.omitted.length > 0 && (
                <p role="status">
                  {t("e2e.filtered")}: {fullPreview.omitted.join(", ")}
                </p>
              )}
              <Button
                onClick={() =>
                  downloadBlob(
                    new Blob([JSON.stringify(fullPreview, null, 2)], { type: "application/json" }),
                    "comparison-preview.json"
                  )
                }
              >
                {t("e2e.previewDownload")}
              </Button>
            </div>
          )}

          <p className="my-3">{t("disclosure")}</p>
          <label>
            <input
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
            />{" "}
            {t("consent")}
          </label>
        </div>
      )}
      <div className="flex gap-3">
        <Button disabled={busy || !scope.domains.length} onClick={() => void run(false)}>
          {t("preview")}
        </Button>
        <Button
          variant="primary"
          disabled={busy || !preview || !accepted}
          onClick={() => void run(true)}
        >
          {t(onAuthorize ? "e2e.encryptPublish" : "saveGrant")}
        </Button>
        <Button onClick={onClose}>{t("close")}</Button>
      </div>
    </section>
  );
}
