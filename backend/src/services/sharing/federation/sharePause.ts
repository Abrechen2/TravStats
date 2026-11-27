import { theirsOf } from "./connections/switches";

/**
 * "Reisen teilen" switched off (UAT 2026-11-27): the switch was turned off and existing trips kept
 * syncing. Off now PAUSES the link: nothing more is sent — changes wait in the outbox, in order,
 * and leave when the switch is on again — and the trip page says the link is paused. Nothing is
 * detached and nothing is lost.
 *
 * Either side's switch pauses it (coordinator, 2026-11-27): this side's own (`shareTripOffers`)
 * and the person's as they last announced it. Making an invitation code, claiming one and offering
 * a trip each switch the acting side on, so a link starts unpaused. Only an active connection
 * pauses; a pairing to be reconfirmed, pending or ended is judged elsewhere. The end of a
 * membership (`leave`, `revoke`) is still told: it is not a change of the trip.
 */
export interface PausablePairing {
  state: string;
  shareTripOffers: boolean;
  remoteSwitches: unknown;
}

export const isSharePaused = (pairing: PausablePairing): boolean =>
  pairing.state === "active" && !(pairing.shareTripOffers && theirsOf(pairing).tripOffers);

/** Outbox kinds that still leave while paused: the end of a membership. */
export const SENT_WHILE_PAUSED = new Set(["leave", "revoke"]);
