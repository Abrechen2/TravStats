import { createContext, useContext } from "react";

/** What a row tells the control inside it. */
export interface SettingItemContext {
  /** The control's id: the title's `htmlFor` points at it. */
  id: string;
  /** Locked: demo, the admin forbade it, a dependency is missing. */
  locked: boolean;
  /** The row shows a form error or a missing required value. */
  invalid: boolean;
  /** Ids of the lines under the row that describe the control. */
  describedBy: string | undefined;
  /** In a group with an explicit save: this value differs from the saved one. */
  changed: boolean;
}

const FALLBACK: SettingItemContext = {
  id: "",
  locked: false,
  invalid: false,
  describedBy: undefined,
  changed: false,
};

export const SettingItemCtx = createContext<SettingItemContext>(FALLBACK);

export function useSettingItem(): SettingItemContext {
  return useContext(SettingItemCtx);
}
