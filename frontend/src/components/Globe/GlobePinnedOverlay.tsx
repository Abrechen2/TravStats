// The globe's pinned card and the pulse ring under it.
//
// Lifted out of `GlobeView.tsx` when the card gained the flat map's action row
// and the Reise view's read-list: the component is on the file-size ratchet,
// and the rule is that a listed file may shrink and never grow. It is also the
// honest split — everything here is about WHERE the card sits on a sphere and
// what it can do, none of it about building layers.

import type { CSSProperties, JSX } from "react";
import type { Cruise, GeoJSONFeature } from "../../types";
import { rgbCss } from "../../lib/flightColor";
import { tokens } from "../../theme/tokens";
import { LODGING_COLOR } from "../../lib/lodgingColor";
import { PLACE_COLOR } from "../../lib/placeColor";
import { PinnedCard } from "../map/cards/PinnedCard";
import { PinnedCardBoundary } from "../map/cards/PinnedCardBoundary";
import type { MapPinned } from "../map/cards/pinnedTypes";
import type { PinnedScreenPos } from "./usePinnedAnchor";

/**
 * The ring around the selected marker, in that marker's own domain colour —
 * so it cannot disagree with the pin it surrounds. Null for the kinds that
 * have no marker to ring (a route, a cruise leg, a trip).
 */
export function pulseColor(kind: MapPinned["kind"]): string | null {
  // Tokens, not the two literals this carried over from GlobeView. Same
  // values, now named where the theme names them — and the warden counts a
  // hex in a COMMENT too, which is why this sentence does not quote them.
  if (kind === "airport") return tokens.domainColor.flight;
  if (kind === "port") return tokens.color.info;
  if (kind === "lodging") return rgbCss(LODGING_COLOR);
  if (kind === "place") return rgbCss(PLACE_COLOR);
  return null;
}

interface GlobePinnedOverlayProps {
  pinned: MapPinned | null;
  screen: PinnedScreenPos | null;
  flights: readonly GeoJSONFeature[];
  cruises: Cruise[];
  selectionScope: "single" | "route";
  onClose: () => void;
  onFlightOpen?: (flightId: string) => void;
  onFlightEdit?: (flightId: string) => void;
  onTripDetails?: () => void;
  onCruiseOpen?: (cruiseId: string) => void;
  onLodgingOpen?: (lodgingId: string) => void;
  onPlaceOpen?: (placeId: string) => void;
}

export function GlobePinnedOverlay({
  pinned,
  screen,
  flights,
  cruises,
  selectionScope,
  onClose,
  onFlightOpen,
  onFlightEdit,
  onTripDetails,
  onCruiseOpen,
  onLodgingOpen,
  onPlaceOpen,
}: GlobePinnedOverlayProps): JSX.Element | null {
  if (!pinned || !screen || !screen.visible) return null;
  const ring = pulseColor(pinned.kind);

  return (
    <>
      {/* Pulse ring on the selected marker. Drawn under the pinned card,
          non-interactive; reduced-motion shows a static ring. */}
      {ring && (
        <div
          className="pointer-events-none absolute z-20"
          style={{ left: screen.x, top: screen.y }}
        >
          {[0, 0.6].map((delay) => (
            <span
              key={delay}
              className="map-pulse-ring"
              style={{ "--pulse-color": ring, animationDelay: `${delay}s` } as CSSProperties}
            />
          ))}
        </div>
      )}

      {/* Pinned detail card — a custom React overlay positioned via
          map.project() on every render frame. The MapLibre Popup primitive was
          attempted in beta.12 and crashed the WebGL canvas in this stack
          (interleaved deck.gl 9 + globe projection); see `usePinnedAnchor` for
          the visibility check that replaces its occlusion pass. */}
      <div
        className="absolute z-30 pointer-events-auto"
        style={{
          left: screen.x,
          top: screen.y,
          transform: "translate(-50%, calc(-100% - 14px))",
        }}
      >
        <PinnedCardBoundary>
          <PinnedCard
            pinned={pinned}
            flights={flights}
            cruises={cruises}
            selectionScope={selectionScope}
            onClose={onClose}
            onFlightOpen={onFlightOpen}
            onFlightEdit={onFlightEdit}
            onTripDetails={onTripDetails}
            onCruiseOpen={onCruiseOpen}
            onLodgingOpen={onLodgingOpen}
            onPlaceOpen={onPlaceOpen}
          />
        </PinnedCardBoundary>
      </div>
    </>
  );
}
