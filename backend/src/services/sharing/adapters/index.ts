import { cruiseAdapter } from "./cruise";
import { flightAdapter, railAdapter, rentalAdapter } from "./flat";
import { lodgingStayAdapter } from "./lodgingStay";
import { stopAdapter } from "./stop";
import type { EntityAdapter, ShareEntity } from "./types";

export { SHARE_ENTITIES, type EntityAdapter, type ShareEntity, type SharedRow } from "./types";

export const ADAPTERS: Readonly<Record<ShareEntity, EntityAdapter>> = {
  flight: flightAdapter,
  lodgingStay: lodgingStayAdapter,
  cruise: cruiseAdapter,
  rail: railAdapter,
  rental: rentalAdapter,
  stop: stopAdapter,
};
