import { useState } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { parserApi } from "../../lib/api/client";
import { documentsApi } from "../../lib/api/documents";
import { newEntry } from "./editorModel";
import type { PlanBooking, PlanView } from "../../lib/api/travplan";
const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const string = (v: unknown) => (typeof v === "string" ? v : "");
const date = (v: unknown) =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
export function bookingDrafts(body: unknown, plan: PlanView): PlanBooking[] {
  const result = record(body),
    kind = string(result.domain) === "lodging" ? "hotel" : string(result.domain) || "flight";
  const rows = Array.isArray(result.flights)
    ? result.flights
    : Array.isArray(result.candidates)
      ? result.candidates
      : Array.isArray(result.bookings)
        ? result.bookings
        : [];
  return rows.slice(0, 100).map((raw) => {
    const b = record(raw),
      lodging = record(b.lodging),
      entry = newEntry(
        "bookings",
        plan.state.timezone,
        plan.state.currency,
        null
      ) as unknown as PlanBooking;
    const amount = b.totalPrice ?? b.price ?? b.amount;
    return {
      ...entry,
      kind: ["flight", "hotel", "rail", "bus", "ferry", "cruise", "rental"].includes(kind)
        ? (kind as PlanBooking["kind"])
        : "flight",
      title:
        string(b.hotelName) ||
        string(lodging.name) ||
        string(b.name) ||
        string(b.title) ||
        [string(b.depIata), string(b.arrIata)].filter(Boolean).join(" → ") ||
        plan.state.destination ||
        "Booking",
      reference: string(b.bookingReference) || string(b.pnr) || null,
      provider: string(b.airline) || string(b.operator),
      day: date(b.departureDate ?? b.departureLocal ?? b.checkIn ?? b.startDate ?? b.date),
      endDay: date(b.checkOut ?? b.endDate),
      time: /^\d{2}:\d{2}$/.test(string(b.departureTime)) ? string(b.departureTime) : null,
      amount: typeof amount === "number" && Number.isFinite(amount) ? amount : null,
      currency: /^[A-Z]{3}$/.test(string(b.currency)) ? string(b.currency) : plan.state.currency,
      place: string(b.city) || string(lodging.city) || string(b.arrIata),
      arrivalDay: date(b.arrivalDate ?? b.arrivalLocal),
      arrivalTime: /^\d{2}:\d{2}$/.test(string(b.arrivalTime)) ? string(b.arrivalTime) : null,
      arrivalTimezone: string(b.arrTimezone) || null,
      originPlace: string(b.depIata),
      source: "document",
      details: b,
    };
  });
}
export default function ImportPanel({
  plan,
  onDraft,
  onError,
}: {
  plan: PlanView;
  onDraft: (booking: PlanBooking) => void;
  onError: (error: unknown) => void;
}) {
  const { t } = useTranslation("travplan");
  const [useAI,setUseAI]=useState(false);
  const [text, setText] = useState(""),
    [file, setFile] = useState<File | null>(null),
    [retain, setRetain] = useState(false),
    [busy, setBusy] = useState(false),
    [drafts, setDrafts] = useState<PlanBooking[] | null>(null);
  async function parse() {
    setBusy(true);
    try {
      const options={headers:{"X-TravPlan-Trip":plan.tripId,"X-TravPlan-AI":String(useAI)}};
      let result: unknown;
      if (file) {
        if (file.size > 20 * 1024 * 1024) throw new Error("File too large");
        if (file.name.toLowerCase().endsWith(".pdf")) {
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = reject;
            reader.onload = () => resolve(String(reader.result).split(",")[1]);
            reader.readAsDataURL(file);
          });
          result = (await parserApi.post("/parse-pdf", { pdfBase64: base64, domain: "auto" },options)).data;
        } else {
          const form = new FormData();
          form.append("email", file);
          form.append("domain", "auto");
          result = (await parserApi.post("/parse-email-file", form,options)).data;
        }
      } else
        result = (await parserApi.post("/parse-email", { emailContent: text, domain: "auto" },options))
          .data;
      const candidates = bookingDrafts(result, plan);
      if (retain && file && candidates.length) {
        const doc = await documentsApi.upload({
          file,
          entry: { type: "trip", id: plan.tripId },
          kind: "booking",
        });
        for (const candidate of candidates) candidate.documentIds = [doc.id];
      }
      setDrafts(candidates);
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="tp-card">
      <h2>{t("parse")}</h2>
      <label className="tp-form">
        <span className="tp-wide">
          {t("paste")}
          <textarea
            className="tp-search"
            rows={6}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={200000}
          />
        </span>
      </label>
      <label className="tp-check">
        {t("parseFile")}
        <input
          type="file"
          accept=".pdf,.eml,.msg,.txt"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setDrafts(null);
          }}
        />
      </label>
      <label className="tp-check">
        <input
          type="checkbox"
          checked={retain}
          disabled={!file}
          onChange={(e) => setRetain(e.target.checked)}
        />
        {t("retain")}
      </label>
      <label className="tp-check"><input type="checkbox" checked={useAI} onChange={e=>setUseAI(e.target.checked)}/>{t("parseAI")}</label>
      <p className="tp-muted">{plan.state.ai.policy==="cloud_allowed"?t("parseCloud"):t("parseLocal")}</p>
      <button
        disabled={busy || (!file && !text.trim())}
        onClick={() => void parse()}
        className="tp-primary"
      >
        {busy ? t("parsing") : t("parse")}
      </button>
      {drafts && (
        <div>
          {!drafts.length ? (
            <p>{t("noCandidates")}</p>
          ) : (
            drafts.map((b, i) => (
              <div className="tp-row" key={b.id}>
                <div className="tp-grow">
                  <h3>{b.title}</h3>
                  <p className="tp-muted">
                    {b.day || t("review.unknown")} · {b.reference || t("review.unknown")}
                  </p>
                </div>
                <button
                  onClick={() => {
                    onDraft(b);
                    setDrafts((d) => d?.filter((_, j) => i !== j) || null);
                  }}
                >
                  {t("readCandidates")}
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
