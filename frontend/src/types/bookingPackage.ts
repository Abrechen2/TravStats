/**
 * A booking as a package (forgejo#430) — `GET /trips/bookings/:id`, mirrors
 * `BookingPackage` in the backend's OpenAPI module
 * `services/openapi/paths/bookingPackage.ts`.
 */
export type BookingItemKind = "flight" | "stay" | "cruise" | "rail" | "bus" | "ferry" | "rental";

export interface BookingPackageItem {
  kind: BookingItemKind;
  id: string;
  label: string;
  date: string | null;
  status: string;
  tripId: string | null;
  /** This item's share of a valid split; null = not split ("Teil eines Pakets"). */
  share: number | null;
}

export interface BookingPackageSplit {
  method: "equal" | "distance" | "manual";
  price: number;
  currency: string | null;
  shares: Array<{ kind: BookingItemKind; id: string; amount: number; flightId?: string }>;
  staleReason: "price" | "currency" | "segments" | null;
}

export interface BookingPackageAnswer {
  booking: {
    id: string;
    pnr: string | null;
    operator: string | null;
    travellers: number | null;
    /** The one price of every item; 0 = free, null = none recorded. */
    price: number | null;
    currency: string | null;
    tripId: string | null;
    tripName: string | null;
  };
  isPackage: boolean;
  items: BookingPackageItem[];
  split: BookingPackageSplit | null;
}

export type BookingPackageSplitBody =
  | { method: "equal" }
  | { method: "manual"; shares: Array<{ kind: BookingItemKind; id: string; amount: number }> };
