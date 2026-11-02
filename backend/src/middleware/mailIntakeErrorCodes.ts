/** Why a mail-intake request was refused (forgejo#313). Part of `ApiErrorCode`. */
export type MailIntakeApiErrorCode =
  /** No mailbox is set up for this account (or the instance) (404). */
  | "MAIL_SOURCE_NOT_FOUND"
  /** No such mail, or it belongs to someone else (404). */
  | "MAIL_MESSAGE_NOT_FOUND"
  /** The mail's original is gone, so it cannot be read again (409). */
  | "MAIL_DOCUMENT_GONE"
  /** The admin switched mail intake off or forbade it for accounts (409). */
  | "MAIL_INTAKE_OFF"
  /** A personal mailbox host resolves to a private or loopback address (400). */
  | "MAIL_HOST_BLOCKED";
