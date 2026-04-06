import { useEffect, useState } from "react";

interface TooltipContainerProps {
  screenX: number;
  screenY: number;
  borderColor?: string;
  minWidth?: string;
  maxWidth?: string;
  children: React.ReactNode;
}

export function TooltipContainer({
  screenX,
  screenY,
  borderColor = "var(--accent)",
  minWidth = "220px",
  maxWidth = "340px",
  children,
}: TooltipContainerProps): JSX.Element {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 50);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      style={{
        position: "absolute",
        left: screenX,
        top: screenY,
        transform: "translate(-50%, -100%) translateY(-12px)",
        opacity: visible ? 1 : 0,
        transition: "opacity 0.2s ease",
        zIndex: 100,
        pointerEvents: "auto",
        background: "rgba(15,23,42,0.95)",
        border: `1px solid ${borderColor}`,
        borderRadius: "8px",
        padding: "0.75rem 1rem",
        minWidth,
        maxWidth,
        backdropFilter: "blur(12px)",
        boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
      }}
    >
      {children}
    </div>
  );
}
