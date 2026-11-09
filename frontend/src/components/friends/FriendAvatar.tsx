import type { JSX } from "react";

interface Props {
  name: string;
  /** "you" takes the accent, "them" the text colour — the same pairing as the comparison bars. */
  tone: "you" | "them";
  size?: number;
}

/** Initials in a disc; decorative, the name always stands next to it. */
export default function FriendAvatar({ name, tone, size = 40 }: Props): JSX.Element {
  const initials = name.trim().slice(0, 2).toUpperCase();
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        fontWeight: 700,
        color: "var(--ts-bg, #fff)",
        background: tone === "you" ? "var(--ts-accent)" : "var(--ts-text)",
      }}
    >
      {initials}
    </span>
  );
}
