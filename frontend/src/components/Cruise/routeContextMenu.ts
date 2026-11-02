import type { Dispatch, SetStateAction } from "react";
import type { TFn } from "../map/cards/cardChrome";
import type { MapMenuEntry } from "./MapContextMenu";
import { clearSelection, isEndpoint, type RouteEditorState } from "./routeEditorState";

export interface RouteContextMenuModel {
  x: number;
  y: number;
  title: string;
  entries: MapMenuEntry[];
}

export interface RouteContextMenuInputs {
  clientX: number;
  clientY: number;
  t: TFn;
  editing: { fromPortId: number; toPortId: number } | null;
  editorState: RouteEditorState | null;
  setEditorState: Dispatch<SetStateAction<RouteEditorState | null>>;
  handleIndexAt: (clientX: number, clientY: number) => number | null;
  legAt: (clientX: number, clientY: number) => { fromPortId: number; toPortId: number } | null;
  onEditorRemove: (index: number) => void;
  onEditorRemoveSelected: () => void;
  onEditorSimplify: () => void;
  enterLeg: (fromPortId: number, toPortId: number) => Promise<void>;
  closeLegOnly: () => Promise<void>;
}

/**
 * What the right-click menu of the route editor offers at a point: a handle's
 * commands, the leg under the cursor (open or another), or the bare map's.
 */
export function buildRouteContextMenu({
  clientX,
  clientY,
  t,
  editing,
  editorState,
  setEditorState,
  handleIndexAt,
  legAt,
  onEditorRemove,
  onEditorRemoveSelected,
  onEditorSimplify,
  enterLeg,
  closeLegOnly,
}: RouteContextMenuInputs): RouteContextMenuModel {
  const handleIndex = handleIndexAt(clientX, clientY);
  if (handleIndex !== null && editorState) {
    const many = editorState.selected.filter((i) => !isEndpoint(editorState, i));
    return {
      x: clientX,
      y: clientY,
      title: t("cruise:routeEditor.handle", { index: handleIndex + 1 }),
      entries: [
        {
          label: t("cruise:routeEditor.menu.removeHandle"),
          disabled: isEndpoint(editorState, handleIndex),
          onSelect: () => onEditorRemove(handleIndex),
        },
        {
          label: t("cruise:routeEditor.menu.removeSelected", { count: many.length }),
          disabled: many.length < 2,
          onSelect: onEditorRemoveSelected,
        },
        { label: null },
        {
          label: t("cruise:routeEditor.menu.clearSelection"),
          disabled: editorState.selected.length === 0,
          onSelect: () => setEditorState((prev) => (prev ? clearSelection(prev) : prev)),
        },
      ],
    };
  }

  const leg = legAt(clientX, clientY);
  if (leg) {
    const isOpen = editing?.fromPortId === leg.fromPortId && editing?.toPortId === leg.toPortId;
    return {
      x: clientX,
      y: clientY,
      title: isOpen ? t("cruise:routeEditor.menu.openLeg") : t("cruise:routeEditor.menu.otherLeg"),
      entries: isOpen
        ? [
            {
              label: t("cruise:routeEditor.menu.simplify"),
              disabled: !editorState || editorState.waypoints.length <= 3,
              onSelect: onEditorSimplify,
            },
            { label: null },
            { label: t("cruise:routeEditor.menu.closeLeg"), onSelect: closeLegOnly },
          ]
        : [
            {
              label: t("cruise:routeEditor.menu.editThisLeg"),
              onSelect: () => void enterLeg(leg.fromPortId, leg.toPortId),
            },
          ],
    };
  }

  return {
    x: clientX,
    y: clientY,
    title: t("cruise:routeEditor.menu.map"),
    entries: [
      {
        label: t("cruise:routeEditor.menu.clearSelection"),
        disabled: !editorState || editorState.selected.length === 0,
        onSelect: () => setEditorState((prev) => (prev ? clearSelection(prev) : prev)),
      },
      {
        label: t("cruise:routeEditor.menu.closeLeg"),
        disabled: !editing,
        onSelect: closeLegOnly,
      },
    ],
  };
}
