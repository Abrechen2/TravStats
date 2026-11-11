import type { JSX } from "react";
import { ShareLinksSwitch } from "../Admin/ShareLinksSettings";
import FederationRows from "../Services/FederationRows";

/**
 * Funktionen › Teilen (settings v3 S5): what the server allows its accounts to
 * share — public links and the connection to other servers. The connections
 * themselves (requests, servers, key) are the page "Server-Verbindungen", which
 * exists while this switch is on.
 */
export default function ServerSharing(): JSX.Element {
  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
      <ShareLinksSwitch />
      <FederationRows part="switch" />
    </div>
  );
}
