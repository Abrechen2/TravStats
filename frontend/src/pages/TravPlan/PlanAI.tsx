import { useEffect, useState } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import {
  travplanApi,
  type PlanView,
  type PlanOperation,
  type PlanProposal,
} from "../../lib/api/travplan";
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
    [proposals, setProposals] = useState<PlanProposal[]>([]);
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
    <div className="tp-stack">
      <div className="tp-card">
        <h2>{t("aiIntro")}</h2>
        <label className="tp-check">
          <input
            type="checkbox"
            checked={plan.state.ai.enabled}
            onChange={(e) =>
              void mutate({
                type: "settings",
                values: { ai: { ...plan.state.ai, enabled: e.target.checked } },
              })
            }
          />
          {t("aiEnable")}
        </label>
        <label className="tp-check">
          <input
            type="checkbox"
            checked={plan.state.ai.policy === "cloud_allowed"}
            onChange={(e) =>
              void mutate({
                type: "settings",
                values: {
                  ai: {
                    ...plan.state.ai,
                    policy: e.target.checked ? "cloud_allowed" : "local_only",
                  },
                },
              })
            }
          />
          {t("cloudEnable")}
        </label>
        <p className="tp-muted">{t("aiConsent")}</p>
        <label className="tp-form">
          <span className="tp-wide">
            {t("request")}
            <textarea
              className="tp-search"
              rows={3}
              maxLength={1000}
              value={request}
              onChange={(e) => setRequest(e.target.value)}
            />
          </span>
        </label>
        <div className="tp-actions">
          <button
            className="tp-primary"
            disabled={busy || !plan.state.ai.enabled || !request.trim()}
            onClick={() => void generate()}
          >
            {busy ? t("generating") : t("generate")}
          </button>
        </div>
      </div>
      {proposals
        .filter((p) => p.status === "pending")
        .map((p) => {
          const stale = p.baseRevision !== plan.revision || Date.parse(p.expiresAt) < Date.now();
          return (
            <div key={p.id} className="tp-card">
              <h2>{p.content.summary}</h2>
              <p className="tp-muted">
                {p.provider} · {p.model}
              </p>
              {p.content.assumptions.map((a, i) => (
                <p key={i}>{a}</p>
              ))}
              {stale && <div className="tp-banner">{t("stale")}</div>}
              <div className="tp-grid">
                {[false, true].map((after) => (
                  <div key={String(after)}>
                    <h3>{after ? t("after") : t("before")}</h3>
                    {p.content.changes.map((c) => {
                      const item = plan.state.items.find((i) => i.id === c.id);
                      return (
                        <div key={c.id} className="tp-row">
                          <div className="tp-grow">
                            <strong>{item?.title || c.id}</strong>
                            <p>
                              {after ? c.day : item?.day} · {after ? c.time : item?.time}
                            </p>
                            {after && <p className="tp-muted">{c.reason}</p>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
              <div className="tp-actions">
                <button
                  disabled={stale || busy}
                  className="tp-primary"
                  onClick={() =>
                    void mutate({ type: "proposal", proposalId: p.id }).then((ok) => {
                      if (ok) setProposals((rows) => rows.filter((x) => x.id !== p.id));
                    })
                  }
                >
                  {t("apply")}
                </button>
                <button
                  onClick={() =>
                    void travplanApi
                      .reject(plan.tripId, p.id)
                      .then(() => setProposals((rows) => rows.filter((x) => x.id !== p.id)))
                      .catch(onError)
                  }
                >
                  {t("reject")}
                </button>
              </div>
            </div>
          );
        })}
    </div>
  );
}
