import { useEffect, useState, type JSX, type ReactNode } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { InputControl, SettingItem, type SettingWrite } from "../ui/settings";

/**
 * An immediate row holding a whole number in a range (hours, percent, a daily
 * limit). The text field keeps what is typed; only a value inside the range is
 * chosen, so an out-of-range number is explained under the field instead of
 * being sent, silently clamped or ignored. "Verwerfen" brings the last saved
 * number back into the field.
 */
export function NumberSettingRow({
  title,
  sub,
  expert,
  write,
  min,
  max,
  locked,
}: {
  title: string;
  sub?: ReactNode;
  expert?: boolean;
  write: SettingWrite<number>;
  min: number;
  max: number;
  locked?: { why: "demo" | "adminForbade" | "dependency"; reason: ReactNode };
}): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const [text, setText] = useState(String(write.value));
  const [invalid, setInvalid] = useState(false);

  // The row shows the CHOICE while a write is open, and the saved value after
  // a discard: follow the value whenever it changes from outside the field.
  useEffect(() => {
    setText((current) => (Number(current) === write.value ? current : String(write.value)));
    setInvalid(false);
  }, [write.value]);

  const onChange = (next: string): void => {
    setText(next);
    const value = Number(next);
    if (next.trim() !== "" && Number.isInteger(value) && value >= min && value <= max) {
      setInvalid(false);
      write.choose(value);
    } else {
      setInvalid(true);
    }
  };

  return (
    <SettingItem
      title={title}
      sub={sub}
      expert={expert}
      save={write}
      locked={locked}
      error={invalid ? t("settings:blocks.number.range", { min, max }) : undefined}
      control={<InputControl type="number" inputMode="numeric" value={text} onChange={onChange} />}
    />
  );
}
