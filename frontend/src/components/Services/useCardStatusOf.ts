import { cardStatus, type CardStatus } from "./cardStatus";
import { useServices } from "./servicesContext";
import type { ServiceCardDef } from "./serviceCards";

/** Statuses that mean the service is set up or running, whoever supplied it; built-ins ("always") are not something anyone set up. */
const CONFIGURED: ReadonlySet<CardStatus> = new Set([
  "on",
  "ready",
  "connected",
  "viaServer",
  "keyRejected",
  // Switched off or waiting for consent is still something the person (or admin) set up; hiding it would also make a card vanish under the cursor when its switch is turned off.
  "off",
  "needsConsent",
]);

export const isConfiguredStatus = (status: CardStatus): boolean => CONFIGURED.has(status);

/** The card's one status word, from what the account and (for an admin) the server report. */
export function useCardStatusOf(isAdmin: boolean): (card: ServiceCardDef) => CardStatus {
  const { account, admin } = useServices();
  const data = account.data;
  return (card) =>
    cardStatus({
      card,
      isAdmin,
      account: [...(data?.connections ?? []), ...(data?.ownKeys ?? [])].find(
        (s) => s.id === card.id
      ),
      consent: data?.aiConsents.find((c) => c.id === card.id),
      provided: data?.instanceProvided.find((s) => s.id === card.id),
      admin: admin?.data?.categories.flatMap((c) => c.services).find((s) => s.id === card.id),
    });
}
