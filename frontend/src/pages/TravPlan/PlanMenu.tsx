import { useState, type ReactNode } from "react";
import { Button, Card } from "../../components/ui";
import { useTranslation } from "../../hooks/useTranslation";
import { useIsPhoneViewport } from "../../hooks/useIsPhoneViewport";

/**
 * The page's secondary header actions. Wide: they stand in the row. Narrow (phone): behind one
 * "Mehr" button, so the title keeps its width. Primary actions stay outside.
 */
export function PlanMenu({ children }: { children: ReactNode }) {
  const { t } = useTranslation("travplan"),
    narrow = useIsPhoneViewport(),
    [open, setOpen] = useState(false);
  if (!narrow) return <>{children}</>;
  return (
    <div style={{ position: "relative" }}>
      <Button aria-expanded={open} onClick={() => setOpen(!open)}>
        {t("more")}
      </Button>
      {open && (
        <Card
          style={{ position: "absolute", right: 0, zIndex: 20, marginTop: "var(--ts-space-sm)" }}
        >
          <div
            className="flex flex-col"
            style={{ gap: "var(--ts-space-sm)" }}
            onClick={() => setOpen(false)}
          >
            {children}
          </div>
        </Card>
      )}
    </div>
  );
}
