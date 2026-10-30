import type { JSX } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "../../hooks/useTranslation";

/**
 * "Alle externen Dienste verwaltest du unter Externe Dienste." — the link the
 * pages that used to hold one service's switch (parsers, push, federation, usage
 * statistics, WebDAV, SMTP) carry now that the list lives in one place.
 */
export default function ExternalServicesPointer(): JSX.Element {
  const { t } = useTranslation(["externalServices"]);
  return (
    <p
      className="t-caption"
      style={{ marginBottom: "var(--ts-space-lg)" }}
      data-testid="external-services-pointer"
    >
      {t("externalServices:pointer.text")}{" "}
      <Link
        to="/admin/externalServices"
        className="underline"
        style={{ color: "var(--ts-accent)" }}
      >
        {t("externalServices:pointer.link")}
      </Link>
    </p>
  );
}
