import type { JSX } from "react";
import {
  EMPTY_TERMINAL,
  TerminalField,
  type TerminalDomain,
  type TerminalDraft,
} from "../legs/TerminalField";

/** A terminal as the form holds it; `lat`/`lon` null until one is picked. */
export type BusStationDraft = TerminalDraft;
export { EMPTY_TERMINAL };

const BUS: TerminalDomain = { ns: "bus" };

type Props = Omit<Parameters<typeof TerminalField>[0], "domain">;

/** A coach terminal: the shared terminal field, without a terminal-kind search. */
export function BusStationField(props: Props): JSX.Element {
  return <TerminalField domain={BUS} {...props} />;
}
