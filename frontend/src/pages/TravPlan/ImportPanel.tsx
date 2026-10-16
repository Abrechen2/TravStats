import { useId, useState } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { parserApi } from "../../lib/api/client";
import { documentsApi } from "../../lib/api/documents";
import type { PlanBooking, PlanView } from "../../lib/api/travplan";
import { bookingDrafts } from "./bookingDrafts";
import { Button, Card, Field, Input, TextArea } from "../../components/ui";
import { PlanActions, PlanCardHead, PlanGrow, PlanRow } from "./planLayout";
import { PlanCheck } from "./PlanParts";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_PASTE_CHARS = 200000;
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
  const [useAI, setUseAI] = useState(false);
  const [text, setText] = useState(""),
    [file, setFile] = useState<File | null>(null),
    [retain, setRetain] = useState(false),
    [busy, setBusy] = useState(false),
    [drafts, setDrafts] = useState<PlanBooking[] | null>(null),
    uid = useId();
  async function parse() {
    setBusy(true);
    try {
      const options = {
        headers: { "X-TravPlan-Trip": plan.tripId, "X-TravPlan-AI": String(useAI) },
      };
      let result: unknown;
      if (file) {
        if (file.size > MAX_FILE_BYTES) throw new Error("File too large");
        if (file.name.toLowerCase().endsWith(".txt")) {
          result = (
            await parserApi.post(
              "/parse-email",
              { emailContent: await file.text(), domain: "auto" },
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
          result = (
            await parserApi.post("/parse-pdf", { pdfBase64: base64, domain: "auto" }, options)
          ).data;
        } else {
          const form = new FormData();
          form.append("email", file);
          form.append("domain", "auto");
          result = (await parserApi.post("/parse-email-file", form, options)).data;
        }
      } else
        result = (
          await parserApi.post("/parse-email", { emailContent: text, domain: "auto" }, options)
        ).data;
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
            <p className="t-body">{t("noCandidates")}</p>
          ) : (
            drafts.map((b, i) => (
              <PlanRow key={b.id}>
                <PlanGrow>
                  <h3 className="t-card-title">{b.title}</h3>
                  <p className="t-caption">
                    {b.day || t("review.unknown")} · {b.reference || t("review.unknown")}
                  </p>
                </PlanGrow>
                <Button
                  onClick={() => {
                    onDraft(b);
                    setDrafts((d) => d?.filter((_, j) => i !== j) || null);
                  }}
                >
                  {t("readCandidates")}
                </Button>
              </PlanRow>
            ))
          )}
        </div>
      )}
    </Card>
  );
}
