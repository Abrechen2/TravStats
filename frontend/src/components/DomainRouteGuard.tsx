import type { JSX, ReactNode } from "react";
import { useEnabledDomains } from "../hooks/useEnabledDomains";
import { useTranslation } from "../hooks/useTranslation";
import { useSettingsStore } from "../store/settingsStore";
import type { DomainKey } from "../shared/domains";
import NavigationBar from "./NavigationBar";
import { DomainDisabledNotice } from "./Dashboard/tabs/DomainDisabledNotice";

/**
 * Route guard for a domain page — three states, not two.
 *
 * `/flights`, `/cruises` and `/lodging` used to guard with a plain
 * `isAuthenticated && isEnabled("…")`. That reads `enabledDomains` before the
 * settings fetch has answered, and the store's own initial value is
 * `["flight"]`, so a cold load of a domain the user really has redirected
 * straight to `/`. Measured on 2026-08-25: with only `["flight"]` in the
 * persisted store, a direct load of `/cruises` bounced while the server said
 * cruises were enabled. Bookmarks, shared links and F5 all hit exactly that.
 *
 * `/places` had already learned this and grew `PlacesRouteGuard`; the comment
 * beside it names the same bug. This is that guard generalised, so the four
 * domains stop answering the question differently.
 *
 * POI keeps its own guard because its answer is reached differently, but it
 * refuses the same way — see `places/PlacesRouteGuard`.
 */
export function DomainRouteGuard({
  domain,
  children,
}: {
  domain: DomainKey;
  children: ReactNode;
}): JSX.Element {
  const { isEnabled } = useEnabledDomains();
  const loaded = useSettingsStore((s) => s.enabledDomainsLoaded);
  const { t } = useTranslation(["common"]);

  if (!loaded) {
    return (
      <>
        <NavigationBar />
        <div className="mx-auto max-w-3xl px-4 py-16 text-center text-[var(--text-muted)]">
          {t("common:loading.default")}
        </div>
      </>
    );
  }

  // Not a redirect. The reader followed a link here; bouncing them to the
  // dashboard left them unable to tell a wrong address from a switched-off
  // area (forgejo#88 finding 6). This is the same card the dashboard tab for
  // a disabled domain already showed, and it carries the way to turn it on.
  if (!isEnabled(domain)) {
    return (
      <>
        <NavigationBar />
        <DomainDisabledNotice domain={domain} />
      </>
    );
  }

  return <>{children}</>;
}
