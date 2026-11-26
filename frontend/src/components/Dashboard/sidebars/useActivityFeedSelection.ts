import { useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "../../../hooks/useTranslation";
import { useDomainColors } from "../../../hooks/useDomainColors";
import { logger } from "../../../lib/logger";
import type { ActivityFeedItem } from "../../../lib/api/activityFeed";
import type { DashboardDomainFilterResult } from "../../../hooks/useDashboardDomainFilter";
import { useCruiseSelectionStore } from "../../../store/cruiseSelectionStore";
import { useFlightSelectionStore } from "../../../store/flightSelectionStore";
import { useLodgingSelectionStore } from "../../../store/lodgingSelectionStore";
import { useMapCardSelectionStore } from "../../../store/mapCardSelectionStore";
import { useMapFocusStore } from "../../../store/mapFocusStore";
import { usePlaceSelectionStore } from "../../../store/placeSelectionStore";
import { useToastStore } from "../../../store/toastStore";
import type { FilterDomainKey } from "../../../shared/dashboardDomainFilter";
import type { Flight } from "../../../types";
import type { Cruise } from "../../../types/cruise";
import type { Lodging } from "../../../types/lodging";
import type { Place } from "../../../types/place";
import { selectFeedItem, type FeedSelectOutcome } from "./activityFeedSelect";
import { reportPageError } from "../../../store/pageErrorStore";

/** The list is 320px wide beside the map from 640px up, and covers the map below that. */
export const ACTIVITY_PANEL_WIDTH = 320;
const PANEL_BESIDE_MAP_MIN_WIDTH = 640;

/** A single-domain tab has no domain filter: its one layer is always on the map. */
export const ALWAYS_ON = { isVisible: () => true, toggle: () => undefined };

const NO_FLIGHT = (): undefined => undefined;
const NONE: readonly never[] = [];

interface Options {
  findFlight?: (id: string) => Flight | undefined;
  cruises?: readonly Cruise[];
  lodgings?: readonly Lodging[];
  places?: readonly Place[];
  domainFilter: Pick<DashboardDomainFilterResult, "isVisible" | "toggle">;
}

/**
 * The activity list's two doors on the "Alle" map. A row click selects (the
 * entry's card, its layer, the camera); the arrow opens the entry's own page.
 *
 * When the entry's domain is unticked in the map's domain filter the list
 * switches it ON for the selection and says so in a toast. The alternative —
 * a hint and nothing opened — leaves the reader with a click that did
 * nothing, in a list they opened precisely to jump somewhere.
 */
export function useActivityFeedSelection(options: Options): {
  onSelect: (item: ActivityFeedItem) => void;
  onDetails: (item: ActivityFeedItem) => void;
} {
  const { domainFilter } = options;
  const findFlight = options.findFlight ?? NO_FLIGHT;
  const cruises = options.cruises ?? NONE;
  const lodgings = options.lodgings ?? NONE;
  const places = options.places ?? NONE;
  const { t } = useTranslation(["dashboard", "common"]);
  const { colorOf } = useDomainColors();
  const navigate = useNavigate();
  const setFlights = useFlightSelectionStore((s) => s.setSelection);
  const setCruise = useCruiseSelectionStore((s) => s.setSelection);
  const setLodging = useLodgingSelectionStore((s) => s.setSelection);
  const setPlace = usePlaceSelectionStore((s) => s.setSelection);
  const selectLayerCard = useMapCardSelectionStore((s) => s.select);
  const focus = useMapFocusStore((s) => s.focus);
  const addToast = useToastStore((s) => s.addToast);

  const latestClick = useRef(0);

  const say = useCallback(
    (outcome: FeedSelectOutcome, item: ActivityFeedItem): void => {
      if (outcome === "switchedOn") {
        addToast(
          "info",
          t("dashboard:sidebar.focusSwitchedOn", { domain: t(`common:domain.${item.domain}`) })
        );
      } else if (outcome === "notLoaded") {
        reportPageError(t("dashboard:sidebar.focusNotLoaded"), "warning");
      } else if (outcome === "unplaced") {
        addToast("info", t("dashboard:sidebar.focusUnplaced"));
      }
    },
    [addToast, t]
  );

  const onSelect = useCallback(
    (item: ActivityFeedItem): void => {
      const leftInset =
        typeof window !== "undefined" && window.innerWidth >= PANEL_BESIDE_MAP_MIN_WIDTH
          ? ACTIVITY_PANEL_WIDTH
          : 0;
      const click = ++latestClick.current;
      selectFeedItem(item, {
        findFlight,
        cruises,
        lodgings,
        places,
        selectFlight: setFlights,
        selectCruise: setCruise,
        selectLodging: setLodging,
        selectPlace: setPlace,
        selectLayerCard,
        isDomainOnMap: (d: FilterDomainKey) => domainFilter.isVisible(d),
        showDomain: (d: FilterDomainKey) => domainFilter.toggle(d),
        focus,
        colorOf,
        leftInset,
        isCurrent: () => click === latestClick.current,
      }).then(
        (outcome) => say(outcome, item),
        (err: unknown) => {
          if (click !== latestClick.current) return;
          logger.warn("activity feed row could not be opened", err);
          reportPageError(t("dashboard:sidebar.focusFailed"));
        }
      );
    },
    [
      findFlight,
      cruises,
      lodgings,
      places,
      setFlights,
      setCruise,
      setLodging,
      setPlace,
      selectLayerCard,
      domainFilter,
      focus,
      colorOf,
      say,
      t,
    ]
  );

  const onDetails = useCallback(
    (item: ActivityFeedItem): void => {
      void navigate(item.path);
    },
    [navigate]
  );

  return { onSelect, onDetails };
}
