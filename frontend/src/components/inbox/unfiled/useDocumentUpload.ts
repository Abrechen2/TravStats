import { useCallback, useEffect, useRef, useState } from "react";

import { useTranslation } from "../../../hooks/useTranslation";
import { documentsApi, isDemoForbidden, type DocumentLimits } from "../../../lib/api/documents";
import { logger } from "../../../lib/logger";
import { formatBytes } from "../../../lib/fileSize";
import { exceededDocumentLimit } from "../../documents/documentDisplay";

/**
 * Uploads into the unassigned list, one file after the other. Every refused or
 * failed file is named with its own reason — one bad file among five must not
 * turn the whole batch into "failed", nor hide that the other four arrived.
 */
export function useDocumentUpload(onUploaded: () => void | Promise<void>): {
  upload: (files: File[]) => Promise<void>;
  busy: boolean;
  errors: string[];
} {
  const { t } = useTranslation(["dataQuality", "documents"]);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const limits = useRef<DocumentLimits | null>(null);

  useEffect(() => {
    documentsApi.limits().then(
      (value) => {
        limits.current = value;
      },
      // An older server has no limits route: the server decides at upload time.
      (err: unknown) => logger.warn({ err }, "useDocumentUpload: limits unavailable")
    );
  }, []);

  const upload = useCallback(
    async (files: File[]): Promise<void> => {
      if (files.length === 0) return;
      setBusy(true);
      setErrors([]);
      const problems: string[] = [];
      let stored = 0;
      for (const file of files) {
        const broken = exceededDocumentLimit(file, limits.current);
        if (broken !== null) {
          problems.push(`${file.name}: ${t("documents:tooLarge", { limit: formatBytes(broken) })}`);
          continue;
        }
        try {
          await documentsApi.upload({ file });
          stored += 1;
        } catch (err: unknown) {
          logger.error({ err, name: file.name }, "useDocumentUpload: upload failed");
          problems.push(
            `${file.name}: ${
              isDemoForbidden(err)
                ? t("dataQuality:unfiledDocuments.errors.demo")
                : t("documents:uploadFailed")
            }`
          );
        }
      }
      setErrors(problems);
      setBusy(false);
      if (stored > 0) await onUploaded();
    },
    [onUploaded, t]
  );

  return { upload, busy, errors };
}
