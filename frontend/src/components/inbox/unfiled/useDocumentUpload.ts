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
  /** Files whose bytes were already in the list: their names, and the documents they matched. */
  repeats: { names: string[]; ids: string[] };
} {
  const { t } = useTranslation(["dataQuality", "documents"]);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [repeats, setRepeats] = useState<{ names: string[]; ids: string[] }>({
    names: [],
    ids: [],
  });
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
      setRepeats({ names: [], ids: [] });
      const problems: string[] = [];
      const repeated = { names: [] as string[], ids: [] as string[] };
      let stored = 0;
      for (const file of files) {
        const broken = exceededDocumentLimit(file, limits.current);
        if (broken !== null) {
          problems.push(`${file.name}: ${t("documents:tooLarge", { limit: formatBytes(broken) })}`);
          continue;
        }
        try {
          const { document, alreadyThere } = await documentsApi.uploadUnfiled(file);
          if (alreadyThere) {
            repeated.names.push(file.name);
            repeated.ids.push(document.id);
          } else stored += 1;
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
      setRepeats(repeated);
      setBusy(false);
      if (stored > 0) await onUploaded();
    },
    [onUploaded, t]
  );

  return { upload, busy, errors, repeats };
}
