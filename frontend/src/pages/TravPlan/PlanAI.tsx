import { useEffect, useId, useState } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import {
  travplanApi,
  type PlanView,
  type PlanOperation,
  type PlanProposal,
} from "../../lib/api/travplan";
import { Button, Card, Field, Switch, TextArea } from "../../components/ui";
import {
  PlanActions,
  PlanCardHead,
  PlanGrid,
  PlanGrow,
  PlanNotice,
  PlanRow,
  PlanStack,
} from "./planLayout";

const MAX_REQUEST_CHARS = 1000;

export default function PlanAI({
  plan,
  mutate,
  onError,
}: {
  plan: PlanView;
  mutate: (op: PlanOperation) => Promise<boolean>;
  onError: (e: unknown) => void;
}) {
  const { t } = useTranslation("travplan"),
    [request, setRequest] = useState(t("requestExample")),
    [busy, setBusy] = useState(false),
    [proposals, setProposals] = useState<PlanProposal[]>([]),
    requestId = useId();
  useEffect(() => {
    let active = true;
    travplanApi
      .proposals(plan.tripId)
      .then((r) => {
        if (active) setProposals(r);
      })
      .catch(onError);
    return () => {
      active = false;
    };
  }, [plan.tripId, onError]);
  async function generate() {
    setBusy(true);
    try {
      const next = await travplanApi.propose(plan.tripId, request);
      setProposals((p) => [next, ...p]);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <PlanStack>
      <Card>
        <PlanCardHead title={t("aiIntro")} />
        <Switch
          checked={plan.state.ai.enabled}
          label={t("aiEnable")}
          onChange={(enabled) =>
            void mutate({
              type: "settings",
              values: { ai: { ...plan.state.ai, enabled } },
            })
          }
        />
        <Switch
          checked={plan.state.ai.policy === "cloud_allowed"}
          label={t("cloudEnable")}
          onChange={(allowed) =>
            void mutate({
              type: "settings",
              values: {
                ai: { ...plan.state.ai, policy: allowed ? "cloud_allowed" : "local_only" },
              },
            })
          }
        />
        <p className="t-caption">{t("aiConsent")}</p>
        <Field label={t("request")} htmlFor={requestId}>
          <TextArea
            id={requestId}
            rows={3}
            maxLength={MAX_REQUEST_CHARS}
            value={request}
            onChange={(e) => setRequest(e.target.value)}
          />
        </Field>
        <PlanActions>
          <Button
            variant="primary"
            disabled={busy || !plan.state.ai.enabled || !request.trim()}
            onClick={() => void generate()}
          >
            {busy ? t("generating") : t("generate")}
          </Button>
        </PlanActions>
      </Card>
      {proposals
        .filter((p) => p.status === "pending")
        .map((p) => {
          const stale = p.baseRevision !== plan.revision || Date.parse(p.expiresAt) < Date.now();
          return (
            <Card key={p.id}>
              <PlanCardHead title={p.content.summary} />
              <p className="t-caption">
                {p.provider} · {p.model}
              </p>
              {p.content.assumptions.map((a, i) => (
                <p key={i} className="t-body">
                  {a}
                </p>
              ))}
              {stale && <PlanNotice>{t("stale")}</PlanNotice>}
              {(p.content.ideas || []).map((idea, i) => (
                <PlanRow key={i}>
                  <strong className="t-body">{idea.title}</strong>
                  <p className="t-body">{idea.note}</p>
                </PlanRow>
              ))}
              <PlanGrid>
                {[false, true].map((after) => (
                  <div key={String(after)}>
                    <h3 className="t-card-title">{after ? t("after") : t("before")}</h3>
                    {p.content.changes.map((c) => {
                      const item = plan.state.items.find((i) => i.id === c.id);
                      return (
                        <PlanRow key={c.id}>
                          <PlanGrow>
                            <strong className="t-body">{item?.title || c.id}</strong>
                            <p className="t-body">
                              {after ? c.day : item?.day} · {after ? c.time : item?.time}
                            </p>
                            {after && <p className="t-caption">{c.reason}</p>}
                          </PlanGrow>
                        </PlanRow>
                      );
                    })}
                  </div>
                ))}
              </PlanGrid>
              <PlanActions>
                <Button
                  variant="primary"
                  disabled={stale || busy}
                  onClick={() =>
                    void mutate({ type: "proposal", proposalId: p.id }).then((ok) => {
                      if (ok) setProposals((rows) => rows.filter((x) => x.id !== p.id));
                    })
                  }
                >
                  {t("apply")}
                </Button>
                <Button
                  onClick={() =>
                    void travplanApi
                      .reject(plan.tripId, p.id)
                      .then(() => setProposals((rows) => rows.filter((x) => x.id !== p.id)))
                      .catch(onError)
                  }
                >
                  {t("reject")}
                </Button>
              </PlanActions>
            </Card>
          );
        })}
    </PlanStack>
  );
}
