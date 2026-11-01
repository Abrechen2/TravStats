import type { JSX } from "react";
import NotificationPreferencesCards from "./NotificationPreferences";

/**
 * The reminders page (design §4 A2): its two sections draw their own headings.
 * The shared demo account is not hidden from the page but locked row by row —
 * the address is a password-reset vector, so the server refuses the write
 * (finding C3), and the preferences are read-only there.
 */
export default function NotificationsSection(): JSX.Element {
  return <NotificationPreferencesCards />;
}
