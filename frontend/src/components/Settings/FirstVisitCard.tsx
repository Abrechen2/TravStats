import { useState, type JSX } from "react";
import { useInRouterContext } from "react-router-dom";
import { useTranslation } from "../../hooks/useTranslation";
import { ActionControl, JumpControl, useGuardedNavigate } from "../ui/settings";
import { SectionCard } from "./SettingsShared";

const HIDDEN_KEY = "ts.settings.firstCard.hidden";

function readHidden(): boolean {
  try {
    return window.localStorage.getItem(HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * "Zuerst": the three things a new account usually sets first, as jumps. It can
 * be hidden; that is a per-device convenience, so it lives in the browser only
 * and the card simply stays when storage is unavailable.
 */
export default function FirstVisitCard(): JSX.Element | null {
  const inRouter = useInRouterContext();
  return inRouter ? <FirstVisit /> : null;
}

function FirstVisit(): JSX.Element | null {
  const { t } = useTranslation(["settings"]);
  const navigate = useGuardedNavigate();
  const [hidden, setHidden] = useState(readHidden);
  if (hidden) return null;
  const hide = (): void => {
    try {
      window.localStorage.setItem(HIDDEN_KEY, "1");
    } catch {
      // Storage unavailable: hide for this visit only.
    }
    setHidden(true);
  };
  return (
    <SectionCard>
      <div data-first-visit-card="" className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
        <strong style={{ color: "var(--ts-text-bright)" }}>{t("settings:firstVisit.title")}</strong>
        <div className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-sm)" }}>
          <JumpControl
            label={t("settings:firstVisit.language")}
            onJump={() => navigate("/settings/display")}
          />
          <JumpControl
            label={t("settings:firstVisit.home")}
            onJump={() => navigate("/settings/account#home")}
          />
          <JumpControl
            label={t("settings:firstVisit.location")}
            onJump={() => navigate("/settings/location")}
          />
          <ActionControl label={t("settings:firstVisit.hide")} onClick={hide} />
        </div>
      </div>
    </SectionCard>
  );
}
