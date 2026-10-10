import type { JSX } from "react";

import { useTranslation } from "../hooks/useTranslation";
import { reloadNowForStaleBundle } from "../lib/staleBundle";
import Button from "./ui/Button";

interface StaleBundleNoticeProps {
  /** An automatic reload is already under way: say so, offer nothing. */
  reloading: boolean;
}

/**
 * What a reader sees when this tab still runs a build whose chunks are gone
 * (see `lib/staleBundle.ts`): a sentence that names the cause and one button
 * that fixes it — instead of an empty page, or the generic "something went
 * wrong" that makes an update look like a crash.
 */
export default function StaleBundleNotice({ reloading }: StaleBundleNoticeProps): JSX.Element {
  const { t } = useTranslation("common");
  return (
    <div
      role="alert"
      className="flex min-h-screen items-center justify-center"
      style={{ background: "var(--ts-bg)", padding: "var(--ts-space-screen-padding)" }}
    >
      <div
        className="w-full"
        style={{
          maxWidth: "var(--ts-width-reading)",
          background: "var(--ts-surface)",
          border: "1px solid var(--ts-border)",
          borderRadius: "var(--ts-radius-card)",
          padding: "var(--ts-space-xxl)",
        }}
      >
        {reloading ? (
          <p className="t-body">{t("common:staleBundle.reloading")}</p>
        ) : (
          <>
            <h1 className="t-screen-title" style={{ marginBottom: "var(--ts-space-md)" }}>
              {t("common:staleBundle.title")}
            </h1>
            <p className="t-body" style={{ marginBottom: "var(--ts-space-xl)" }}>
              {t("common:staleBundle.message")}
            </p>
            <Button variant="primary" block onClick={() => reloadNowForStaleBundle()}>
              {t("common:staleBundle.reload")}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
