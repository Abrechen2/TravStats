import { useEffect, useState } from "react";
import type { JSX } from "react";
import Button from "../ui/Button";
import { useTranslation } from "../../hooks/useTranslation";
import { api } from "../../lib/api/client";
import { busApi, type BusTicketPreview, type BusTicketProposal } from "../../lib/api/bus";

/** The proposal fields the bus form takes, in the order the review lists them. */
export const BUS_TICKET_FIELDS = [
  "departureStop",
  "arrivalStop",
  "departureLocal",
  "arrivalLocal",
  "operator",
  "lineName",
  "bookingReference",
  "price",
  "currency",
] as const;

/** Why nothing was read, as the copy key that says it. */
function emptyKey(reason: BusTicketPreview["reason"]): string {
  if (reason === "noText") return "bus:import.noText";
  if (reason === "nothingRead") return "bus:import.nothingRead";
  return "bus:import.noTemplate";
}

/**
 * Read a coach ticket into the bus form (forgejo#309). The bus twin of
 * `FerryTicketImport`, with one difference that matters: there is no model
 * path. A ticket is read by a bus template — one the user derived in the
 * template workshop, or one from the template repository — or not at all,
 * and "not at all" says why and where a template is made.
 */
export function BusTicketImport({
  current,
  onApply,
  onBusyChange,
}: {
  /** The form's current values: a field already filled is not preselected. */
  current: Record<string, string>;
  onApply: (values: Record<string, string>) => void;
  onBusyChange: (busy: boolean) => void;
}): JSX.Element {
  const { t } = useTranslation(["bus"]);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [preview, setPreview] = useState<BusTicketPreview | null>(null);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => onBusyChange(busy), [busy, onBusyChange]);

  const choose = (row: BusTicketProposal): void =>
    setSelected(
      Object.keys(row).filter((key) => !current[key] || (key === "currency" && !current.price))
    );

  const read = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
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
      const result = await busApi.ticketPreview(id ? { documentId: id } : { text });
      setPreview(result);
      setIndex(0);
      choose(result.rides[0] ?? {});
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  const row = preview?.rides[index];
  return (
    <details className="mb-4 rounded-md border border-border p-3" data-testid="bus-ticket-import">
      <summary className="cursor-pointer text-sm font-semibold">{t("bus:import.title")}</summary>
      <div className="mt-3 space-y-3">
        <p className="t-caption">{t("bus:import.hint")}</p>
        <label className="block text-sm">
          {t("bus:import.file")}
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
            {t("bus:import.text")}
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
        <Button disabled={busy || (!file && !text.trim())} onClick={() => void read()}>
          {t(busy ? "bus:import.reading" : "bus:import.read")}
        </Button>
        {documentId && <p className="t-caption">{t("bus:import.retained")}</p>}
        {error && (
          <p role="alert" className="text-sm text-(--danger)">
            {t("bus:import.error")}
          </p>
        )}
        {preview && !row && <p role="status">{t(emptyKey(preview.reason))}</p>}
        {preview && row && (
          <>
            <p className="t-caption">
              {t(
                preview.template?.source === "workshop"
                  ? "bus:import.readByWorkshop"
                  : "bus:import.readByRepository"
              )}
            </p>
            {preview.rides.length > 1 && (
              <label className="block text-sm">
                {t("bus:import.ride")}
                <select
                  value={index}
                  className="mt-1 w-full rounded-md border border-border bg-(--bg-surface) p-3"
                  onChange={(e) => {
                    const i = Number(e.target.value);
                    setIndex(i);
                    choose(preview.rides[i]);
                  }}
                >
                  {preview.rides.map((ride, i) => (
                    <option key={i} value={i}>
                      {ride.departureStop?.value ?? "?"} → {ride.arrivalStop?.value ?? "?"} ·{" "}
                      {ride.departureLocal?.value ?? "?"}
                    </option>
                  ))}
                </select>
                <span className="t-caption">{t("bus:import.oneRide")}</span>
              </label>
            )}
            <ul className="space-y-2">
              {BUS_TICKET_FIELDS.filter((key) => row[key]).map((key) => (
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
                      <span className="t-caption">{t(`bus:import.field.${key}`)}</span>
                      <br />
                      {row[key].value}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <Button
              disabled={!selected.length || busy}
              onClick={() =>
                onApply(Object.fromEntries(selected.map((key) => [key, row[key].value])))
              }
            >
              {t("bus:import.apply")}
            </Button>
          </>
        )}
      </div>
    </details>
  );
}
