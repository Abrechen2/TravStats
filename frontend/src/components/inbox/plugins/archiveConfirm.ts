import type { ConfirmRequest } from "../../../hooks/useConfirmDialog";

/**
 * The ONE confirmation every write to a plugin's project archive passes (owner 2026-11-26), in the
 * inbox and in the settings dialog alike: it names exactly the values that will be written, and an
 * undo is confirmed the same way, since it writes too.
 */
type T = (key: string, options?: Record<string, unknown>) => string;
const NS = "dataQuality:pluginInbox";

/** Up to six decimals, as the plugin writes them: the confirmation shows exactly that. */
export const coord = (x: number) => x.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");

export function archiveWriteRequest(
  t: T,
  input: {
    plugin: string;
    name: string;
    lat: number;
    lon: number;
    /** What is written; an absent field keeps its archive value (`before`). */
    values: { street?: string; postcode?: string; town?: string };
    before: { street?: string | null; postcode?: string | null; town?: string | null };
  }
): ConfirmRequest {
  const field = (label: string, next: string | undefined, before: string | null | undefined) =>
    next
      ? t(`${NS}.confirm.field`, { label, value: next })
      : t(`${NS}.confirm.kept`, { label, value: before || "—" });
  return {
    title: t(`${NS}.confirm.title`),
    message: [
      t(`${NS}.confirm.writes`, { plugin: input.plugin, name: input.name }),
      t(`${NS}.confirm.coords`, { lat: coord(input.lat), lon: coord(input.lon) }),
      field(t(`${NS}.street`), input.values.street, input.before.street),
      field(t(`${NS}.postcode`), input.values.postcode, input.before.postcode),
      field(t(`${NS}.town`), input.values.town, input.before.town),
      t(`${NS}.confirm.undo`),
    ].join("\n"),
    confirmText: t(`${NS}.confirm.button`),
  };
}

export function archiveUndoRequest(t: T, plugin: string, name: string): ConfirmRequest {
  return {
    title: t(`${NS}.undoConfirm.title`),
    message: t(`${NS}.undoConfirm.message`, { plugin, name }),
    confirmText: t(`${NS}.undo`),
  };
}
