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

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * B9 copy: the designer's confirmation (`settingsRows:dialogs.<id>`), with its
 * numbers filled in. `count` selects the plural form of "Wie viel" and of the
 * button, which names the amount. A dialog without a `word` asks for none:
 * whether it has one is asked of i18next, because a missing key comes back as
 * its own name without the namespace, and that name was drawn as the word to type.
 */
export function dialogCopyOf(
  t: Translate,
  exists: Exists,
  id: string,
  vars: Record<string, unknown> & { count?: number } = {}
): DialogCopy {
  const k = (part: string): string => t(`settingsRows:dialogs.${id}.${part}`, vars);
  const wordKey = `settingsRows:dialogs.${id}.word`;
  const word = exists(wordKey) ? t(wordKey, vars) : "";
  return {
    title: k("title"),
    affects: k("affects"),
    amount: k("amount"),
    after: k("after"),
    confirmLabel: k("confirm"),
    ...(word ? { word } : {}),
  };
}

export function useDialogCopy(): (
  id: string,
  vars?: Record<string, unknown> & { count?: number }
) => DialogCopy {
  const { t, i18n } = useTranslation(["settingsRows"]);
  // Without `exists` (the suite's key-echo mock) no dialog asks for a word.
  const exists: Exists =
    typeof i18n?.exists === "function" ? (key) => i18n.exists(key) : () => false;
  return (id, vars = {}) => dialogCopyOf(t, exists, id, vars);
}
