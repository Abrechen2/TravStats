/** Ferry crossings (dennis/TravStats forgejo#293). */
import type { JSX } from "react";
import {
  EMPTY_TERMINAL,
  TerminalField,
  type TerminalDomain,
  type TerminalDraft,
} from "../legs/TerminalField";

export type FerryStationDraft = TerminalDraft;
export { EMPTY_TERMINAL };

const FERRY: TerminalDomain = { ns: "ferry", portSearch: true };

type Props = Omit<Parameters<typeof TerminalField>[0], "domain">;

/** A ferry port: the shared terminal field, searching ferry terminals first. */
export function FerryStationField(props: Props): JSX.Element {
  return <TerminalField domain={FERRY} {...props} />;
}
