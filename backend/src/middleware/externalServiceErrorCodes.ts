/**
 * Why an external-services request was refused (forgejo#392). Part of
 * `ApiErrorCode` (`errorHandler.ts`), kept here because that file sits at its
 * size limit; the settings pages map each to DE/EN copy.
 */
export type ExternalServiceApiErrorCode =
  /** Unknown service id (404). */
  | "SERVICE_NOT_FOUND"
  /** The admin switched the service off; nothing was called (409). */
  | "SERVICE_DISABLED"
  /** Enabling a cloud AI provider needs `confirmDataSharing: true` (400). */
  | "CONSENT_REQUIRED"
  /** The admin forbade accounts to bring their own key for this service (403). */
  | "ACCOUNT_KEYS_NOT_ALLOWED"
  /** The admin forbade accounts to connect this service (403). */
  | "CONNECTION_NOT_ALLOWED";
