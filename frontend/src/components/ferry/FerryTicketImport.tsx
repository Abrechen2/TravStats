import { useEffect, useState } from "react";
import Button from "../ui/Button";
import { useTranslation } from "../../hooks/useTranslation";
import { api } from "../../lib/api/client";
import { ferryApi } from "../../lib/api/ferry";

export type FerryTicketProposal = Record<string, { value: string; evidence: string }>;
export interface FerryTicketPreview {
  crossings: FerryTicketProposal[];
  parser: string | null;
  reason: string | null;
  provider: { kind: string; host: string | null; model: string; isCloud: boolean } | null;
}
const fieldLabel = (key: string) =>
  key === "departurePort" ? "departure" : key === "arrivalPort" ? "arrival" : key;
export function FerryTicketImport({
  current,
  onApply,
  onBusyChange,
  onDirtyChange,
}: {
  current: Record<string, string>;
  onApply: (values: Record<string, string>, documentId: string | null) => void;
  onBusyChange: (busy: boolean) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t } = useTranslation(["ferry"]);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [preview, setPreview] = useState<FerryTicketPreview | null>(null);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  useEffect(
    () => onDirtyChange?.(Boolean(text || file || preview)),
    [text, file, preview, onDirtyChange]
  );
  const choose = (row: FerryTicketProposal) =>
    setSelected(
      Object.keys(row).filter((key) => !current[key] || (key === "currency" && !current.price))
    );
  const parse = async () => {
    if (busy) return;
    setBusy(true);
    onBusyChange(true);
    setError(false);
    setPreview(null);
    try {
      let id = documentId;
      if (file && !id) {
        const form = new FormData();
        form.append("file", file);
        const uploaded = await api.post<{ data: { id: string } }>("/documents", form, {
          timeout: 120000,
        });
        id = uploaded.data.data.id;
        setDocumentId(id);
      }
      const result = await ferryApi.ticketPreview(id ? { documentId: id } : { text });
      setPreview(result);
      setIndex(0);
      choose(result.crossings[0] ?? {});
    } catch {
      setError(true);
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  };
  return (
    <details className="rounded-md border border-border p-3">
      <summary className="cursor-pointer text-sm font-semibold">{t("ferry:import.title")}</summary>
      <div className="mt-3 space-y-3">
        <p className="t-caption">{t("ferry:import.hint")}</p>
        <label className="block text-sm">
          {t("ferry:import.file")}
          <input
            className="mt-1 block w-full text-sm"
            type="file"
            accept=".pdf,.eml,application/pdf,message/rfc822"
            disabled={busy}
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setDocumentId(null);
              setPreview(null);
            }}
          />
        </label>
        {!file && (
          <label className="block text-sm">
            {t("ferry:import.text")}
            <textarea
              className="mt-1 w-full rounded-md border border-border bg-(--bg-surface) p-3"
              rows={4}
              maxLength={60000}
              value={text}
              disabled={busy}
              onChange={(e) => {
                setText(e.target.value);
                setPreview(null);
              }}
            />
          </label>
        )}
        <Button disabled={busy || (!file && !text.trim())} onClick={() => void parse()}>
          {t(busy ? "ferry:import.reading" : "ferry:import.read")}
        </Button>
        {documentId && <p className="t-caption">{t("ferry:import.retained")}</p>}
        {error && (
          <p role="alert" className="text-sm text-(--danger)">
            {t("ferry:import.error")}
          </p>
        )}
        {preview && (
          <>
            {preview.provider && (
              <p className="t-caption">
                {t("ferry:import.provider", {
                  name: preview.provider.isCloud ? preview.provider.host : preview.provider.kind,
                })}
              </p>
            )}
            {preview.reason && preview.crossings.length > 0 && (
              <p role="status" className="t-caption">
                {t("ferry:import.partial")}
              </p>
            )}
            {preview.crossings.length === 0 ? (
              <p role="status">
                {t(
                  preview.reason === "noText" ? "ferry:import.noText" : "ferry:import.nothingFound"
                )}
              </p>
            ) : (
              <>
                {preview.crossings.length > 1 && (
                  <label className="block text-sm">
                    {t("ferry:import.crossing")}
                    <select
                      value={index}
                      className="mt-1 w-full rounded-md border border-border bg-(--bg-surface) p-3"
                      onChange={(e) => {
                        const i = Number(e.target.value);
                        setIndex(i);
                        choose(preview.crossings[i]);
                      }}
                    >
                      {preview.crossings.map((row, i) => (
                        <option key={i} value={i}>
                          {row.departurePort?.value ?? "?"} → {row.arrivalPort?.value ?? "?"} ·{" "}
                          {row.departureLocal?.value ?? "?"}
                        </option>
                      ))}
                    </select>
                    <span className="t-caption">{t("ferry:import.oneCrossing")}</span>
                  </label>
                )}
                <p className="t-caption">{t("ferry:import.review")}</p>
                <ul className="space-y-2">
                  {Object.entries(preview.crossings[index]).map(([key, found]) => (
                    <li key={key} className="rounded border border-border p-2">
                      <label className="flex items-start gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={selected.includes(key)}
                          onChange={(e) =>
                            setSelected((old) =>
                              e.target.checked ? [...old, key] : old.filter((k) => k !== key)
                            )
                          }
                        />
                        <span className="min-w-0 break-words">
                          <span className="t-caption">{t(`ferry:${fieldLabel(key)}`)}</span>
                          <br />
                          {found.value}
                          <br />
                          <span className="t-caption">{found.evidence}</span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                <Button
                  disabled={!selected.length || busy}
                  onClick={() =>
                    onApply(
                      Object.fromEntries(
                        selected.map((key) => [key, preview.crossings[index][key].value])
                      ),
                      documentId
                    )
                  }
                >
                  {t("ferry:import.apply")}
                </Button>
              </>
            )}
          </>
        )}
      </div>
    </details>
  );
}
