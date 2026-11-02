import type { TFn } from "../map/cards/cardChrome";
import { isDirty, isEndpoint, type RouteEditorState } from "./routeEditorState";

export const BAR_BUTTON =
  "rounded-md border border-border px-2 py-1 text-xs text-(--text-muted) hover:bg-(--bg-surface) disabled:opacity-50";

interface RouteEditorActionsProps {
  t: TFn;
  editing: { fromPortId: number; toPortId: number } | null;
  editMode: boolean;
  saveError: boolean;
  tool: "pan" | "select";
  setTool: (tool: "pan" | "select") => void;
  editorState: RouteEditorState | null;
  /** The open leg already carries a saved override. */
  legIsEdited: boolean;
  onEditorUndo: () => void;
  onEditorRedo: () => void;
  onReset: () => Promise<void>;
  onEditorSimplify: () => void;
  onEditorRemoveSelected: () => void;
  onSave: () => Promise<void>;
  closeLegOnly: () => Promise<void>;
  onCancel: () => Promise<void>;
}

/** The dialog's action row: what can be done to the leg under the cursor. */
export function RouteEditorActions({
  t,
  editing,
  editMode,
  saveError,
  tool,
  setTool,
  editorState,
  legIsEdited,
  onEditorUndo,
  onEditorRedo,
  onReset,
  onEditorSimplify,
  onEditorRemoveSelected,
  onSave,
  closeLegOnly,
  onCancel,
}: RouteEditorActionsProps): JSX.Element {
  const barButton = BAR_BUTTON;
  return (
    <>
      {!editing && (
        <span className="mr-auto text-sm text-(--text-muted)">
          {t("cruise:routeEditor.pickLeg")}
        </span>
      )}
      {saveError && (
        <span className="mr-auto text-sm text-(--danger)">
          {t("cruise:routeEditor.saveFailed")}
        </span>
      )}
      {editMode && (
        <div className="flex" role="group" aria-label={t("cruise:routeEditor.tool")}>
          <button
            type="button"
            aria-pressed={tool === "pan"}
            className={`${barButton} rounded-r-none ${tool === "pan" ? "border-(--accent) text-(--accent)" : ""}`}
            onClick={(): void => setTool("pan")}
          >
            {t("cruise:routeEditor.toolPan")}
          </button>
          <button
            type="button"
            aria-pressed={tool === "select"}
            disabled={!editing}
            className={`${barButton} -ml-px rounded-l-none ${tool === "select" ? "border-(--accent) text-(--accent)" : ""}`}
            onClick={(): void => setTool("select")}
          >
            {t("cruise:routeEditor.toolSelect")}
          </button>
        </div>
      )}
      {editing && editorState && (
        <>
          <button
            type="button"
            className={barButton}
            disabled={editorState.history.length === 0}
            onClick={onEditorUndo}
          >
            {t("cruise:routeEditor.undo")}
          </button>
          <button
            type="button"
            className={barButton}
            disabled={editorState.future.length === 0}
            onClick={onEditorRedo}
          >
            {t("cruise:routeEditor.redo")}
          </button>
          {legIsEdited && (
            <button type="button" className={barButton} onClick={(): void => void onReset()}>
              {t("cruise:routeEditor.reset")}
            </button>
          )}
          <button
            type="button"
            className={barButton}
            disabled={editorState.waypoints.length <= 3}
            onClick={onEditorSimplify}
          >
            {t("cruise:routeEditor.simplify")}
          </button>
          <button
            type="button"
            className={barButton}
            disabled={editorState.selected.filter((i) => !isEndpoint(editorState, i)).length === 0}
            onClick={onEditorRemoveSelected}
          >
            {t("cruise:routeEditor.removeSelected", {
              count: editorState.selected.filter((i) => !isEndpoint(editorState, i)).length,
            })}
          </button>
          <button
            type="button"
            className={barButton}
            disabled={!isDirty(editorState)}
            onClick={(): void => void onSave()}
          >
            {t("cruise:routeEditor.save")}
          </button>
          <button type="button" className={barButton} onClick={closeLegOnly}>
            {t("cruise:routeEditor.closeLeg")}
          </button>
        </>
      )}
      <button type="button" className={barButton} onClick={onCancel}>
        {t("cruise:routeEditor.cancel")}
      </button>
    </>
  );
}
