import { useEffect, useRef, type JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { alpha } from "../ui/tokens";
import { ServiceCardShell } from "../ui/settings";
import AccountSide from "./AccountSide";
import ServerSide from "./ServerSide";
import { cardStatus, toneOf, type CardStatus } from "./cardStatus";
import { UNREACHABLE_NOTE } from "./unreachable";
import { useServices } from "./servicesContext";
import type { ServiceCardDef } from "./serviceCards";

const TONE_COLOR = {
  good: "var(--ts-good)",
  muted: "var(--ts-muted)",
  warn: "var(--ts-warn)",
  bad: "var(--ts-bad)",
} as const;

function Pill({ status }: { status: CardStatus }): JSX.Element {
  const { t } = useTranslation(["settingsRows"]);
  const color = TONE_COLOR[toneOf(status)];
  return (
    <span
      data-service-status={status}
      className="t-label-mono"
      style={{
        color,
        border: `1px solid ${alpha(color, 45)}`,
        borderRadius: "var(--ts-radius-pill)",
        padding: "2px 10px",
      }}
    >
      {t(`settingsRows:services.status.${status}`)}
    </span>
  );
}

/** Whether the card has anything for the account itself to do. */
const hasAccountRows = (card: ServiceCardDef): boolean =>
  (["mine", "ownKey", "aiConsent", "allowConn"] as const).some((u) =>
    (card.use as readonly string[]).includes(u)
  );

/**
 * One catalogue entry (B12): name, purpose and one status pill, closed. Open,
 * "Für dein Konto" on top and — for an admin — "Alle Konten" below it. An account
 * that has nothing to set sees the status alone.
 */
export default function ServiceCard({
  card,
  isAdmin,
  linked,
  hidden = false,
  accountGated = false,
}: {
  card: ServiceCardDef;
  isAdmin: boolean;
  /** Filtered out by the group chips; stays mounted. */
  hidden?: boolean;
  /** The account's half sits behind a beta key that is closed (tours); an admin keeps the server's. */
  accountGated?: boolean;
  /** The address named this card: open it and bring it into view. */
  linked: boolean;
}): JSX.Element {
  const { t } = useTranslation(["settingsRows", "settings"]);
  const { account, admin } = useServices();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (linked && typeof ref.current?.scrollIntoView === "function") {
      ref.current.scrollIntoView({ block: "start" });
    }
  }, [linked]);

  const data = account.data;
  const acct = [...(data?.connections ?? []), ...(data?.ownKeys ?? [])].find(
    (s) => s.id === card.id
  );
  const status = cardStatus({
    card,
    isAdmin,
    account: acct,
    consent: data?.aiConsents.find((c) => c.id === card.id),
    provided: data?.instanceProvided.find((s) => s.id === card.id),
    admin: admin?.data?.categories.flatMap((c) => c.services).find((s) => s.id === card.id),
  });
  // Where to get a key: the account's own view carries it for every account, the admin's for the server.
  const keyUrl =
    acct?.getKeyUrl ??
    admin?.data?.categories.flatMap((c) => c.services).find((s) => s.id === card.id)?.getKeyUrl ??
    null;
  const accountRows = hasAccountRows(card) && !accountGated;
  // Dawarich has no admin row in the catalogue, but the server's connection is still the admin's.
  const serverRows = isAdmin && admin !== null;

  return (
    <div ref={ref} id={`service-${card.id}`} data-service-card-id={card.id} hidden={hidden}>
      <ServiceCardShell
        title={
          <span className="flex flex-col">
            <span>{t(`settingsRows:services.cards.${card.id}.n`)}</span>
            <span className="t-caption" style={{ fontWeight: 400 }}>
              {t(`settingsRows:services.cards.${card.id}.p`)}
            </span>
          </span>
        }
        pills={<Pill status={status} />}
        statusOnly={!serverRows && !accountRows}
        defaultOpen={linked}
      >
        <div className="flex flex-col" style={{ gap: "var(--ts-space-xl)" }}>
          {UNREACHABLE_NOTE[card.id] ? (
            <p className="t-caption" data-unreachable-note={card.id} style={{ margin: 0 }}>
              {t(`settings:unreachable.${UNREACHABLE_NOTE[card.id]}`, {
                name: t(`settingsRows:services.cards.${card.id}.n`),
              })}
            </p>
          ) : null}
          {keyUrl ? (
            <p className="t-caption" data-key-link={card.id} style={{ margin: 0 }}>
              <a
                href={keyUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "var(--ts-accent)" }}
              >
                {t("settingsRows:services.ui.getKey", {
                  name: t(`settingsRows:services.cards.${card.id}.n`),
                })}
              </a>
            </p>
          ) : null}
          {accountGated ? null : <AccountSide card={card} service={acct} />}
          {serverRows ? <ServerSide card={card} /> : null}
        </div>
      </ServiceCardShell>
    </div>
  );
}
