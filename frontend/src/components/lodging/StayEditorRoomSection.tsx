import type { JSX } from "react";

import SuggestionChips from "../common/SuggestionChips";
import { Field } from "../ui/Field";
import { StayEditorSection } from "./StayEditorSection";
import type { BoardType } from "../../types/lodging";

const BOARD_TYPES: BoardType[] = ["none", "breakfast", "half", "full", "all_inclusive"];

type T = (key: string, options?: Record<string, unknown>) => string;

interface StayEditorRoomFieldsProps {
  roomNumber: string;
  onRoomNumberChange: (value: string) => void;
  roomCategory: string;
  onRoomCategoryChange: (value: string) => void;
  /** Rooms the user had in this house before. */
  roomNumberSuggestions: readonly string[];
  /** This house's categories first, then its chain's, then any. */
  roomCategorySuggestions: readonly string[];
  fieldIdPrefix: string;
  inputClassName: string;
  t: T;
}

/**
 * Room and room category, each with the values the user had before offered
 * as one-click chips under a field that stays free text. Moved out of
 * `StayEditor`, which sits at the 800-line limit, when the chips arrived.
 */
export function StayEditorRoomFields({
  roomNumber,
  onRoomNumberChange,
  roomCategory,
  onRoomCategoryChange,
  roomNumberSuggestions,
  roomCategorySuggestions,
  fieldIdPrefix: fid,
  inputClassName,
  t,
}: StayEditorRoomFieldsProps): JSX.Element {
  return (
    <div className="mt-3 grid grid-cols-2 gap-3">
      <Field label={t("lodging:field.room")} htmlFor={`${fid}-room`}>
        <input
          id={`${fid}-room`}
          className={inputClassName}
          value={roomNumber}
          onChange={(e): void => onRoomNumberChange(e.target.value)}
        />
        <SuggestionChips
          value={roomNumber}
          suggestions={roomNumberSuggestions}
          onPick={onRoomNumberChange}
          fieldLabel={t("lodging:field.room")}
        />
      </Field>
      <Field label={t("lodging:field.roomCategory")} htmlFor={`${fid}-roomCategory`}>
        <input
          id={`${fid}-roomCategory`}
          className={inputClassName}
          value={roomCategory}
          onChange={(e): void => onRoomCategoryChange(e.target.value)}
        />
        <SuggestionChips
          value={roomCategory}
          suggestions={roomCategorySuggestions}
          onPick={onRoomCategoryChange}
          fieldLabel={t("lodging:field.roomCategory")}
        />
      </Field>
    </div>
  );
}

interface StayEditorBoardSectionProps {
  board: BoardType;
  onBoardChange: (board: BoardType) => void;
  /**
   * The board the user usually had — here, at the chain, or anywhere. Offered
   * only while a NEW stay still holds the default "none"; on an existing stay
   * "none" is what was recorded.
   */
  suggestedBoard: BoardType | null;
  t: T;
}

export function StayEditorBoardSection({
  board,
  onBoardChange,
  suggestedBoard,
  t,
}: StayEditorBoardSectionProps): JSX.Element {
  return (
    <StayEditorSection title={t("lodging:field.board")}>
      <div
        className="inline-flex flex-wrap rounded-lg p-0.5"
        style={{ background: "var(--bg-muted)", border: "1px solid var(--color-border)" }}
        role="group"
        aria-label={t("lodging:field.board")}
      >
        {BOARD_TYPES.map((b) => {
          const active = b === board;
          return (
            <button
              key={b}
              type="button"
              aria-pressed={active}
              onClick={(): void => onBoardChange(b)}
              className="px-3 py-1.5 text-sm font-medium rounded-md transition-colors"
              style={{
                background: active ? "var(--accent)" : "transparent",
                color: active ? "var(--ts-accent-text)" : "var(--text-secondary)",
              }}
            >
              {t(`lodging:board.${b}`)}
            </button>
          );
        })}
      </div>
      {suggestedBoard !== null && board === "none" && (
        <button
          type="button"
          onClick={(): void => onBoardChange(suggestedBoard)}
          className="mt-2 block rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-(--text-muted) hover:border-(--accent) hover:text-(--accent)"
        >
          {t("lodging:stayEditor.boardSuggestion", {
            board: t(`lodging:board.${suggestedBoard}`),
          })}
        </button>
      )}
    </StayEditorSection>
  );
}
