import type { ReactNode } from "react";
import { Card } from "../../components/ui";

/** A plain centred frame for the pages a visitor without an account sees (no app navigation). */
export function GuestFrame({
  children,
  wide = false,
}: {
  children: ReactNode;
  wide?: boolean;
}): JSX.Element {
  return (
    <main
      className="mx-auto min-w-0"
      style={{
        maxWidth: wide ? "var(--ts-width-list)" : "var(--ts-width-reading)",
        padding: "var(--ts-space-xl) var(--ts-space-lg)",
      }}
    >
      {wide ? children : <Card>{children}</Card>}
    </main>
  );
}
