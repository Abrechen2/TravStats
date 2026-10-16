import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import Dialog from "./ui/Dialog";
import { LogoMark, LogoWordmark } from "./Brand/Logo";
import { useAuthStore } from "../store/authStore";
import { useTranslation } from "../hooks/useTranslation";
import { travplanApi } from "../lib/api/travplan";
import "../pages/TravPlan/travplan.css";
export default function TravPlanModeSwitcher() {
  const location = useLocation(),
    { t } = useTranslation("travplan"),
    user = useAuthStore((s) => s.user),
    [enabled, setEnabled] = useState(false),
    [known, setKnown] = useState(false),
    [open, setOpen] = useState(false);
  const userId = user?.id;
  const isPlan = location.pathname.startsWith("/plan"),
    id = /^\/(?:plan|trips)\/([\da-f-]{36})/.exec(location.pathname)?.[1];
  useEffect(() => {
    let active = true;
    setEnabled(false);
    setKnown(false);
    if (userId)
      travplanApi
        .capabilities()
        .then((c) => {
          if (active) {
            setEnabled(c.enabled);
            setKnown(true);
          }
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [userId]);
  useEffect(() => {
    if (isPlan) document.documentElement.dataset.travplanMode = "plan";
    else delete document.documentElement.dataset.travplanMode;
    return () => {
      delete document.documentElement.dataset.travplanMode;
    };
  }, [isPlan]);
  const brand = (
    <span className="flex min-w-0 items-center gap-2.5">
      <LogoMark
        size={26}
        color={isPlan ? "var(--ts-accent)" : "var(--accent)"}
        title={isPlan ? t("title") : "TravStats"}
      />
      <span className="hidden min-[400px]:flex">
        {isPlan ? (
          <strong style={{ fontSize: 19, color: "var(--ts-accent)" }}>{t("title")}</strong>
        ) : (
          <LogoWordmark size={16} />
        )}
      </span>
    </span>
  );
  if (!enabled && !(user?.isAdmin && known))
    return (
      <Link to={isPlan ? "/plan" : "/dashboard"} aria-label={t("statsMode")}>
        {brand}
      </Link>
    );
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("mode")}
        aria-haspopup="dialog"
        className="flex min-w-0 items-center gap-2"
        style={{
          background: "transparent",
          border: 0,
          color: "var(--ts-muted)",
          cursor: "pointer",
        }}
      >
        {brand}
        <span aria-hidden>⌄</span>
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t("mode")}>
        <div className="tp-main" style={{ padding: 0 }}>
          {enabled && (
            <Link
              className="tp-button"
              to={id ? "/plan/" + id + "/overview" : "/plan"}
              onClick={() => setOpen(false)}
            >
              {t("planMode")}
            </Link>
          )}
          <div className="tp-actions">
            <Link
              className="tp-button"
              to={id ? "/trips/" + id : "/dashboard"}
              onClick={() => setOpen(false)}
            >
              {t("statsMode")}
            </Link>
            {user?.isAdmin && (
              <Link className="tp-button" to="/plan/admin" onClick={() => setOpen(false)}>
                {t("config")}
              </Link>
            )}
          </div>
        </div>
      </Dialog>
    </>
  );
}
