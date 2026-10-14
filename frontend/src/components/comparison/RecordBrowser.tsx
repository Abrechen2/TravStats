import { useEffect, useState } from "react";
import { Button } from "../ui";
import { useTranslation } from "../../hooks/useTranslation";
import { comparisonPost } from "../../lib/api/comparison";
export interface RecordPage {
  domain: string;
  nextCursor: string | null;
  rows: Array<{
    key: string;
    fields: Array<{ name: string; value: string | number | boolean | null }>;
  }>;
}
export default function RecordBrowser({
  linkId,
  domains,
  year,
}: {
  linkId: string;
  domains: string[];
  year: number | null;
}) {
  const { t } = useTranslation("comparison");
  const [domain, setDomain] = useState(domains[0] ?? "flight"),
    [page, setPage] = useState<RecordPage | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  useEffect(() => {
    setPage(null);
  }, [linkId, domain, year]);
  const load = async (cursor?: string) => {
    setBusy(true);
    setError(false);
    try {
      setPage(
        await comparisonPost<RecordPage>(`/links/${linkId}/read`, {
          audience: "",
          year,
          recordDomain: domain,
          ...(cursor ? { cursor } : {}),
        })
      );
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="space-y-3">
      <h3 className="font-bold">{t("allEntries")}</h3>
      <div className="flex flex-wrap gap-3">
        <label>
          {t("domains")}
          <select value={domain} onChange={(e) => setDomain(e.target.value)}>
            {domains.map((d) => (
              <option key={d} value={d}>
                {t(`common:domain.${d}`)}
              </option>
            ))}
          </select>
        </label>
        <Button disabled={busy} onClick={() => void load()}>
          {t("loadEntries")}
        </Button>
      </div>
      {error && <p role="alert">{t("error")}</p>}
      {page && (
        <>
          <p>{t("entryCount", { count: page.rows.length })}</p>
          {page.rows.map((row) => (
            <dl key={row.key} className="grid grid-cols-2 md:grid-cols-3 gap-3 border-t py-4">
              {row.fields
                .filter((f) => f.value !== null && f.value !== "")
                .map((field) => (
                  <div key={field.name}>
                    <dt className="text-xs text-[var(--text-muted)]">{t(`field.${field.name}`)}</dt>
                    <dd className="break-words whitespace-pre-wrap">
                      {typeof field.value === "boolean"
                        ? t(field.value ? "yes" : "no")
                        : String(field.value)}
                    </dd>
                  </div>
                ))}
            </dl>
          ))}
          {page.nextCursor && (
            <Button disabled={busy} onClick={() => void load(page.nextCursor!)}>
              {t("nextPage")}
            </Button>
          )}
        </>
      )}
    </section>
  );
}
