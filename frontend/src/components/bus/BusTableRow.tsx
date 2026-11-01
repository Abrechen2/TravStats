import type { JSX, ReactNode } from "react";
import { distanceSourceKey } from "../../lib/bus/busRoutingWords";
import type { BusJourney } from "../../types/bus";
import type { TableColumn } from "../ui/Table";
import {
  LegTableRow,
  legColumnLayout,
  type LegColumnLayout,
  type LegTableDomain,
} from "../legs/LegTableRow";

export type BusColumnId =
  "operator" | "route" | "time" | "line" | "duration" | "distance" | "status" | "trip" | "actions";

/** The bus table's columns: the shared leg arrangement with the line column. */
export const BUS_COLUMN_LAYOUT: LegColumnLayout<BusColumnId> = legColumnLayout("line");

const BUS: LegTableDomain = {
  ns: "bus",
  serviceColumn: "line",
  service: (journey) => (journey as BusJourney).lineName,
  distanceSourceKey: (journey) => distanceSourceKey((journey as BusJourney).distanceSource),
};

interface Props {
  journey: BusJourney;
  columns: readonly TableColumn[];
  onOpen: () => void;
  actions?: ReactNode;
}

/** One bus ride as a table row. */
export function BusTableRow(props: Props): JSX.Element {
  return <LegTableRow domain={BUS} {...props} />;
}
