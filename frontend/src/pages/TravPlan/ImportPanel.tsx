import { useId, useState } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { parserApi } from "../../lib/api/client";
import { documentsApi } from "../../lib/api/documents";
import {
  travplanApi,
  type PlaceholderMatch,
  type PlanBooking,
  type PlanView,
} from "../../lib/api/travplan";
import { PlaceholderMatchDialog } from "./PlaceholderMatchDialog";
import { bookingDrafts } from "./bookingDrafts";
import { ferryCandidates } from "./ferryDrafts";
import { ferryApi } from "../../lib/api/ferry";
import { useEnabledDomains } from "../../hooks/useEnabledDomains";
import { Button, Card, Field, Input, Select, TextArea } from "../../components/ui";
import { PlanActions, PlanCardHead, PlanGrow, PlanRow } from "./planLayout";
import { PlanCheck } from "./PlanParts";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_PASTE_CHARS = 200000;
export default function ImportPanel({
  plan,
  onDraft,
  onReplace,
  busy: planBusy = false,
  onError,
}: {
  plan: PlanView;
  onDraft: (booking: PlanBooking) => void;
  /** Takes the imported booking's facts into an open placeholder (id kept, spec §5.2). */
  onReplace: (placeholderId: string, booking: PlanBooking) => Promise<boolean>;
  busy?: boolean;
  onError: (error: unknown) => void;
}) {
  const { t } = useTranslation("travplan"),
    { isEnabled } = useEnabledDomains();
  const [useAI, setUseAI] = useState(false),
    // Detection never answers "ferry" (it is read only on request, the ferry-ticket rule), so a ferry
    // booking is chosen here. Only offered where the account has the ferry domain.
    [reading, setReading] = useState<"auto" | "ferry">("auto"),
    [readNote, setReadNote] = useState("");
  const domain = reading === "ferry" && isEnabled("ferry") ? "ferry" : "auto";
  const [text, setText] = useState(""),
    [file, setFile] = useState<File | null>(null),
    [retain, setRetain] = useState(false),
    [busy, setBusy] = useState(false),
    [drafts, setDrafts] = useState<PlanBooking[] | null>(null),
    [review, setReview] = useState<{
      index: number;
      matches: PlaceholderMatch[];
    } | null>(null),
    uid = useId();
  const dropDraft = (index: number) => setDrafts((d) => d?.filter((_, j) => index !== j) || null);
  /** Placeholders are looked up first; a lookup that fails is reported, never skipped silently. */
  async function pick(index: number, booking: PlanBooking) {
    if (!plan.state.bookings.some((b) => b.placeholder)) {
      onDraft(booking);
      dropDraft(index);
      return;
    }
    setBusy(true);
    try {
      const matches = await travplanApi.placeholderMatches(
        plan.tripId,
        booking as unknown as Record<string, unknown>
      );
      if (matches.length) setReview({ index, matches });
      else {
        onDraft(booking);
        dropDraft(index);
      }
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }
  async function parse() {
    setBusy(true);
    try {
      const options = {
        headers: { "X-TravPlan-Trip": plan.tripId, "X-TravPlan-AI": String(useAI) },
      };
      let result: unknown;
      setReadNote("");
      const pastedText = file
        ? file.name.toLowerCase().endsWith(".txt")
          ? await file.text()
          : ""
        : text;
      if (domain === "ferry" && pastedText.trim()) {
        // Templates first, then labelled facts and the verified model: the ticket preview.
        const preview = await ferryApi.ticketPreview({ text: pastedText }, options.headers);
        if (!preview.crossings.length)
          setReadNote(
            t("ferryNone." + (preview.reason ?? "nothing"), {
              defaultValue: t("ferryNone.nothing"),
            })
          );
        result = ferryCandidates(preview);
      } else if (file) {
        if (file.size > MAX_FILE_BYTES) throw new Error("File too large");
        if (file.name.toLowerCase().endsWith(".txt")) {
          result = (
            await parserApi.post(
              "/parse-email",
              { emailContent: await file.text(), domain },
              options
            )
          ).data;
        } else if (file.name.toLowerCase().endsWith(".pdf")) {
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = reject;
            reader.onload = () => resolve(String(reader.result).split(",")[1]);
            reader.readAsDataURL(file);
          });
          result = (await parserApi.post("/parse-pdf", { pdfBase64: base64, domain }, options))
            .data;
        } else {
          const form = new FormData();
          form.append("email", file);
          form.append("domain", domain);
          result = (await parserApi.post("/parse-email-file", form, options)).data;
        }
      } else
        result = (await parserApi.post("/parse-email", { emailContent: text, domain }, options))
          .data;
      if (domain === "ferry" && !(result as { candidates?: unknown[] }).candidates) {
        const body = result as { tickets?: unknown[]; fallbackCode?: string };
        if (!body.tickets?.length)
          setReadNote(
            t("ferryNone." + (body.fallbackCode ?? "nothing"), {
              defaultValue: t("ferryNone.nothing"),
            })
          );
        result = ferryCandidates(body);
      }
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
    <Card>
      <PlanCardHead title={t("parse")} />
      {isEnabled("ferry") && (
        <Field label={t("readAs")} htmlFor={uid + "-reading"}>
          <Select
            id={uid + "-reading"}
            value={reading}
            onChange={(e) => {
              setReading(e.target.value === "ferry" ? "ferry" : "auto");
              setDrafts(null);
            }}
          >
            <option value="auto">{t("readAuto")}</option>
            <option value="ferry">{t("readFerry")}</option>
          </Select>
        </Field>
      )}
      <Field label={t("paste")} htmlFor={uid + "-paste"}>
        <TextArea
          id={uid + "-paste"}
          rows={6}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={MAX_PASTE_CHARS}
        />
      </Field>
      <Field label={t("parseFile")} htmlFor={uid + "-file"}>
        <Input
          id={uid + "-file"}
          type="file"
          accept=".pdf,.eml,.msg,.txt"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setDrafts(null);
          }}
        />
      </Field>
      <PlanCheck checked={retain} disabled={!file} onChange={setRetain}>
        {t("retain")}
      </PlanCheck>
      <PlanCheck checked={useAI} onChange={setUseAI}>
        {t("parseAI")}
      </PlanCheck>
      <p className="t-caption">
        {plan.state.ai.policy === "cloud_allowed" ? t("parseCloud") : t("parseLocal")}
      </p>
      <PlanActions>
        <Button
          variant="primary"
          disabled={busy || (!file && !text.trim())}
          onClick={() => void parse()}
        >
          {busy ? t("parsing") : t("parse")}
        </Button>
      </PlanActions>
      {drafts && (
        <div>
          {!drafts.length ? (
            <p className="t-body">{readNote || t("noCandidates")}</p>
          ) : (
            drafts.map((b, i) => (
              <PlanRow key={b.id}>
                <PlanGrow>
                  <h3 className="t-card-title">{b.title}</h3>
                  <p className="t-caption">
                    {b.day || t("review.unknown")} · {b.reference || t("review.unknown")}
                  </p>
                </PlanGrow>
                <Button disabled={busy} onClick={() => void pick(i, b)}>
                  {t("readCandidates")}
                </Button>
              </PlanRow>
            ))
          )}
        </div>
      )}
      {review && drafts?.[review.index] && (
        <PlaceholderMatchDialog
          booking={drafts[review.index]}
          matches={review.matches}
          placeholders={plan.state.bookings}
          busy={planBusy}
          onClose={() => setReview(null)}
          onAdd={() => {
            onDraft(drafts[review.index]);
            dropDraft(review.index);
            setReview(null);
          }}
          onReplace={(placeholderId) => {
            const booking = drafts[review.index];
            void onReplace(placeholderId, booking).then((ok) => {
              if (!ok) return;
              dropDraft(review.index);
              setReview(null);
            });
          }}
        />
      )}
    </Card>
  );
}
