import { theirsOf } from "./connections/switches";

/**
 * "Reisen teilen" switched off (UAT 2026-11-27): the switch was turned off and existing trips kept
 * syncing. Off now PAUSES the link: nothing more is sent — changes wait in the outbox, in order,
 * and leave when the switch is on again — and the trip page says the link is paused. Nothing is
 * detached and nothing is lost.
 *
 * Which switch: the one that let the trip in (connections model, spec 2026-11-02 — `tripOffers`
 * is the receiver's yes to offers). For a group this server is home of, that is the person's
 * switch as they last announced it; for a group that came from the person's server, it is this
 * side's own. So the person who receives a trip can always pause it, on both servers. Only an
 * active connection pauses; a pairing to be reconfirmed, pending or ended is judged elsewhere.
 * The end of a membership (`leave`, `revoke`) is still told: it is not a change of the trip.
 */
export interface PausablePairing {
  state: string;
  shareTripOffers: boolean;
  remoteSwitches: unknown;
}

export const isSharePaused = (pairing: PausablePairing, home: boolean): boolean =>
  pairing.state === "active" && !(home ? theirsOf(pairing).tripOffers : pairing.shareTripOffers);

/** Outbox kinds that still leave while paused: the end of a membership. */
export const SENT_WHILE_PAUSED = new Set(["leave", "revoke"]);
