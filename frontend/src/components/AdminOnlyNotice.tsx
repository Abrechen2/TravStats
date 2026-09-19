import type { JSX } from "react";
import { useTranslation } from "../hooks/useTranslation";
import { RouteNotice } from "./ui/RouteNotice";

/**
 * Shown when a normal account opens `/admin`.
 *
 * The route used to answer with `<Navigate to="/" />`. The API was already
 * right — `GET /api/v1/admin/users` as a non-admin is a 403 (measured
 * 2026-09-19) — but the UI said nothing at all, so a reader who followed an
 * admin link from a forum post or a changelog landed on the dashboard with no
 * way to tell whether the page had moved, the address was wrong, or their
 * account simply lacks the rights (forgejo#88 finding 7).
 *
 * No action button: there is nothing a normal account can do here, and a
 * button leading back to the dashboard would only repeat what the chrome
 * already offers. The copy names who can change it instead.
 */
export function AdminOnlyNotice(): JSX.Element {
  const { t } = useTranslation(["common"]);

  return (
    <RouteNotice glyph="🛡" title={t("common:adminOnly.title")} body={t("common:adminOnly.body")} />
  );
}
