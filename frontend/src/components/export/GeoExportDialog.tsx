import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import Modal from "../Modal";
import GeoExportButtons from "./GeoExportButtons";

/**
 * The "Exportieren" entry of a ⋯ menu (owner, 2026-11-22): GPX and KML used to be two buttons
 * and a label on six pages. The menu holds one entry; the choice of format is made here, with
 * the same buttons and the same words for a refusal ("nothing to export").
 */
export default function GeoExportDialog({
  open,
  onClose,
  path,
  params,
  testId,
}: {
  open: boolean;
  onClose: () => void;
  path: string;
  params?: Record<string, string>;
  testId?: string;
}): JSX.Element {
  const { t } = useTranslation("common");
  return (
    <Modal open={open} onClose={onClose} title={t("common:buttons.export")} maxWidth={360}>
      <GeoExportButtons path={path} params={params} testId={testId} />
    </Modal>
  );
}
