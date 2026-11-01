import { useTranslation } from "../../hooks/useTranslation";

type Exists = (key: string) => boolean;

/** `i18n.exists`, tolerant of the suite's key-echo mock, which has no such method. */
const existsOf = (i18n: { exists?: Exists } | undefined): Exists =>
  typeof i18n?.exists === "function" ? (key) => i18n.exists!(key) : () => true;

export interface RowCopy {
  title: string;
  /** The short line under the title; absent when the design has none. */
  sub?: string;
  /** The "?" help, for the one question the row reliably raises. */
  help?: string;
  /** The row's action button, when the design names one. */
  btn?: string;
  /** The "done" line the design draws after an action. */
  res?: string;
}

/**
 * The designer's copy for one page of the rebuilt settings area
 * (`settingsRows:<page>.<row>`): title, short line, help, button and result
 * line, DE and EN together. A line the design leaves out is `undefined`, so
 * no empty caption is drawn.
 */
export function useRowCopy(page: string): (row: string) => RowCopy {
  const { t, i18n } = useTranslation(["settingsRows"]);
  return (row) => {
    const get = (part: string): string | undefined => {
      const key = `settingsRows:${page}.${row}.${part}`;
      return existsOf(i18n)(key) ? t(key) : undefined;
    };
    return {
      title: get("t") ?? row,
      sub: get("s"),
      help: get("h"),
      btn: get("btn"),
      res: get("res"),
    };
  };
}

/**
 * B10 for a row: the design's reason (`settings:blocks.dep.<id>`) and, where it
 * has one, the jump that lifts it. `onJump` is what the button does — switch
 * the missing thing on, or go to the page that fixes it; without it only the
 * reason is drawn (a reason only an admin can lift has no button).
 */
export function useDependency(): (
  id: string,
  onJump?: () => void
) => { reason: string; jump?: { label: string; onJump: () => void } } {
  const { t, i18n } = useTranslation(["settings"]);
  return (id, onJump) => {
    const jumpKey = `settings:blocks.dep.${id}.jump`;
    return {
      reason: t(`settings:blocks.dep.${id}.reason`),
      ...(onJump && existsOf(i18n)(jumpKey) ? { jump: { label: t(jumpKey), onJump } } : {}),
    };
  };
}

export interface DialogCopy {
  title: string;
  affects: string;
  amount: string;
  after: string;
  confirmLabel: string;
  word?: string;
}

/**
 * B9 copy: the designer's confirmation (`settingsRows:dialogs.<id>`), with its
 * numbers filled in. `count` selects the plural form of "Wie viel" and of the
 * button, which names the amount.
 */
export function useDialogCopy(): (
  id: string,
  vars?: Record<string, unknown> & { count?: number }
) => DialogCopy {
  const { t } = useTranslation(["settingsRows"]);
  return (id, vars = {}) => {
    const k = (part: string): string => t(`settingsRows:dialogs.${id}.${part}`, vars);
    const word = t(`settingsRows:dialogs.${id}.word`, { ...vars, defaultValue: "" });
    return {
      title: k("title"),
      affects: k("affects"),
      amount: k("amount"),
      after: k("after"),
      confirmLabel: k("confirm"),
      ...(word && !word.startsWith("settingsRows:") ? { word } : {}),
    };
  };
}
