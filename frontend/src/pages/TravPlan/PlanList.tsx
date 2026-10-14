import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "../../hooks/useTranslation";
import { useAuthStore } from "../../store/authStore";
import { travplanApi, type PlanState, type PlanView } from "../../lib/api/travplan";
import PlanEditor from "./PlanEditor";
import { settingFields } from "./editorModel";
export function PlanList() {
  const { t } = useTranslation("travplan"),
    navigate = useNavigate(),
    isAdmin = useAuthStore((s) => s.user?.isAdmin),
    [plans, setPlans] = useState<PlanView[]>([]),
    [enabled, setEnabled] = useState<boolean | null>(null),
    [error, setError] = useState(""),
    [create, setCreate] = useState(false),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    Promise.all([travplanApi.list(), travplanApi.capabilities()])
      .then(([rows, caps]) => {
        if (live) {
          setPlans(rows);
          setEnabled(caps.enabled);
        }
      })
      .catch(() => {
        if (live) setError(t("errors.unknown"));
      });
    return () => {
      live = false;
    };
  }, [t]);
  return (
    <>
      <div className="tp-head">
        <div>
          <span className="tp-kicker">{t("tagline")}</span>
          <h1>{t("heading")}</h1>
          <p className="tp-muted">{t("intro")}</p>
        </div>
        <button className="tp-primary" disabled={!enabled} onClick={() => setCreate(true)}>
          {t("newTrip")}
        </button>
      </div>
      {error && (
        <div className="tp-error" role="alert">
          {error}
        </div>
      )}
      {enabled === false && (
        <div className="tp-banner">
          {t("disabled")}
          {isAdmin && (
            <div className="tp-actions">
              <Link to="/plan/admin">{t("config")}</Link>
            </div>
          )}
        </div>
      )}
      <div className="tp-grid">
        {plans.map((p) => (
          <div className="tp-card tp-hero" key={p.id}>
            <span className="tp-badge">
              {t(p.state.status === "ready" ? "readyStatus" : "planningStatus")}
            </span>
            <h2>{p.name}</h2>
            <p>
              {p.state.destination} · {p.state.startDay} – {p.state.endDay}
            </p>
            <p className="tp-muted">
              {p.state.ideas.length} {t("sections.workspace")} · {p.state.bookings.length}{" "}
              {t("sections.import")}
            </p>
            <Link className="tp-button" to={"/plan/" + p.tripId + "/overview"}>
              {t("continue")}
            </Link>
          </div>
        ))}
      </div>
      {!plans.length && enabled && <p>{t("empty")}</p>}
      {create && (
        <PlanEditor
          editor={{
            title: t("newTrip"),
            fields: settingFields,
            value: {
              name: "",
              destination: "",
              startDay: null,
              endDay: null,
              timezone: null,
              travelers: 1,
              pace: "balanced",
              budget: null,
              currency: "EUR",
              latitude: null,
              longitude: null,
            },
          }}
          busy={busy}
          onClose={() => setCreate(false)}
          onSave={async (value) => {
            setBusy(true);
            try {
              const { name, ...settings } = value;
              const next = await travplanApi.create(String(name), settings as Partial<PlanState>);
              navigate("/plan/" + next.tripId + "/overview");
              return true;
            } catch {
              setError(t("errors.unknown"));
              return false;
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </>
  );
}
export function PlanAdmin() {
  const { t } = useTranslation("travplan"),
    isAdmin = useAuthStore((s) => s.user?.isAdmin),
    [config, setConfig] = useState({ enabled: false, aiDailyLimit: 10, weatherDailyLimit: 20 }),
    [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    if (isAdmin)
      travplanApi
        .config()
        .then((c) => {
          if (live) {
            setConfig(c);
            setLoaded(true);
          }
        })
        .catch(() => {
          if (live) setError(t("errors.unknown"));
        });
    return () => {
      live = false;
    };
  }, [isAdmin, t]);
  if (!isAdmin) return <div className="tp-error">{t("disabled")}</div>;
  return (
    <>
      <h1>{t("config")}</h1>
      <p>{t("configHelp")}</p>
      {error && (
        <div className="tp-error" role="alert">
          {error}
        </div>
      )}
      <form
        className="tp-card"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          void travplanApi
            .setConfig(config)
            .then(() => {
              window.location.assign("/plan");
            })
            .catch(() => setError(t("errors.unknown")))
            .finally(() => setBusy(false));
        }}
      >
        <label className="tp-check">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
          />
          {t("enabled")}
        </label>
        <div className="tp-form">
          {(["aiDailyLimit", "weatherDailyLimit"] as const).map((key) => (
            <label key={key}>
              {t(key === "aiDailyLimit" ? "aiLimit" : "weatherLimit")}
              <input
                type="number"
                min={0}
                max={key === "aiDailyLimit" ? 100 : 200}
                required
                value={config[key]}
                onChange={(e) => setConfig({ ...config, [key]: Number(e.target.value) })}
              />
            </label>
          ))}
        </div>
        <div className="tp-actions">
          <button className="tp-primary" disabled={!loaded || busy}>
            {t("save")}
          </button>
        </div>
      </form>
    </>
  );
}
