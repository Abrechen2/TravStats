import type { JSX } from "react";
import Modal from "../Modal";
import { useTranslation } from "../../hooks/useTranslation";
import type { ParseDomain } from "../../lib/api/parse";

interface Props {
  /** What the server says the document really is. */
  detected: ParseDomain;
  onDismiss: () => void;
  /** Opens the right import with the same document; absent where no jump exists. */
  onOpen?: () => void;
}

/**
 * The answer to a document dropped into the wrong dialog (acceptance D1,
 * 2026-09-26): a flight mail in the rail import used to come back as two
 * "train rides" between "Mücka" and "Frant". Now the dialog says what the
 * document is and offers the import it belongs to — nothing is guessed.
 */
export function WrongDialogNotice({ detected, onDismiss, onOpen }: Props): JSX.Element {
  const { t } = useTranslation(["import", "common"]);
  return (
    <Modal
      open
      onClose={onDismiss}
      title={t("import:wrongDialog.title")}
      maxWidth={480}
      closeLabel={t("common:buttons.close")}
      footer={
        <>
          <button type="button" onClick={onDismiss} className="btn-secondary">
            {t("import:wrongDialog.dismiss")}
          </button>
          {onOpen && (
            <button type="button" onClick={onOpen} className="btn-primary">
              {t(`import:wrongDialog.open.${detected}`)}
            </button>
          )}
        </>
      }
    >
      <p role="alert" className="font-medium" data-testid="wrong-dialog-notice">
        {t(`import:wrongDialog.${detected}`)}
      </p>
      <p className="mt-2 text-sm text-(--text-muted)">{t("import:wrongDialog.body")}</p>
    </Modal>
  );
}
