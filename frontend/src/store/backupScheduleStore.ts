import { create } from "zustand";
import type { BackupScheduleSettings } from "../lib/api/backup";

/**
 * The schedule as last SAVED on Sicherungen. The summary at the top of the page and the tuning
 * group below it are two components that each read the schedule once; without this a saved
 * rhythm stayed unchanged in the summary until the page was reloaded.
 */
export const useBackupScheduleStore = create<{
  saved: BackupScheduleSettings | null;
  publish: (next: BackupScheduleSettings) => void;
}>((set) => ({ saved: null, publish: (next) => set({ saved: next }) }));
