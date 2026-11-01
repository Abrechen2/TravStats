import type { JSX, ReactNode } from "react";
import type { FerryJourney } from "../../types/ferry";
import type { TableColumn } from "../ui/Table";
import {
  LegTableRow,
  legColumnLayout,
  type LegColumnLayout,
  type LegTableDomain,
} from "../legs/LegTableRow";

export type FerryColumnId =
  | "operator"
  | "route"
  | "time"
  | "vessel"
  | "duration"
  | "distance"
  | "status"
  | "trip"
  | "actions";

/** The ferry table's columns: the shared leg arrangement with the vessel column. */
export const FERRY_COLUMN_LAYOUT: LegColumnLayout<FerryColumnId> = legColumnLayout("vessel");

const FERRY: LegTableDomain = {
  ns: "ferry",
  serviceColumn: "vessel",
  service: (journey) => (journey as FerryJourney).vesselName,
  // "laut Ticket" for the typed distance.
  distanceSourceKey: (journey) => {
    const source = (journey as FerryJourney).distanceSource;
    return source ? `ferry:distanceSource.${source}` : null;
  },
};

interface Props {
  journey: FerryJourney;
  columns: readonly TableColumn[];
  onOpen: () => void;
  actions?: ReactNode;
}

/** One ferry crossing as a table row. */
export function FerryTableRow(props: Props): JSX.Element {
  return <LegTableRow domain={FERRY} {...props} />;
}
