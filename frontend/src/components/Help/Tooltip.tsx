import { useState, useRef, useEffect, ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "../../hooks/useTranslation";

interface TooltipProps {
  content: string | ReactNode;
  expandedContent?: string | ReactNode;
  position?: "top" | "bottom" | "left" | "right";
  children: ReactNode;
  className?: string;
}

export default function Tooltip({
  content,
  expandedContent,
  position = "top",
  children,
  className = "",
}: TooltipProps): JSX.Element {
  const [isHovered, setIsHovered] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [calculatedPosition, setCalculatedPosition] = useState<"top" | "bottom" | "left" | "right">(
    position
  );
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties>({});
  const tooltipRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation("common");

  // Function to calculate and update tooltip position
  const updateTooltipPosition = () => {
    if (!triggerRef.current || !tooltipRef.current) return;

    const triggerRect = triggerRef.current.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const padding = 8;
    const tooltipWidth = tooltipRect.width || 300;
    const tooltipHeight = tooltipRect.height || 100;

    let newPosition = position;
    let style: React.CSSProperties = {};

    // Check if tooltip fits in preferred position
    const checkPosition = (pos: "top" | "bottom" | "left" | "right") => {
      switch (pos) {
        case "top":
          return triggerRect.top - tooltipHeight - padding >= 0;
        case "bottom":
          return triggerRect.bottom + tooltipHeight + padding <= viewportHeight;
        case "left":
          return triggerRect.left - tooltipWidth - padding >= 0;
        case "right":
          return triggerRect.right + tooltipWidth + padding <= viewportWidth;
      }
    };

    // Try preferred position first
    if (!checkPosition(position)) {
      // Try alternative positions
      if (position === "top" || position === "bottom") {
        if (triggerRect.top < viewportHeight / 2) {
          newPosition = "bottom";
        } else {
          newPosition = "top";
        }
      } else {
        if (triggerRect.left < viewportWidth / 2) {
          newPosition = "right";
        } else {
          newPosition = "left";
        }
      }
    }

    // Calculate absolute position for portal
    const triggerCenterX = triggerRect.left + triggerRect.width / 2;
    const triggerCenterY = triggerRect.top + triggerRect.height / 2;

    switch (newPosition) {
      case "top":
        style = {
          left: `${triggerCenterX}px`,
          top: `${triggerRect.top - tooltipHeight - padding}px`,
          transform: "translateX(-50%)",
        };
        break;
      case "bottom":
        style = {
          left: `${triggerCenterX}px`,
          top: `${triggerRect.bottom + padding}px`,
          transform: "translateX(-50%)",
        };
        break;
      case "left":
        style = {
          left: `${triggerRect.left - tooltipWidth - padding}px`,
          top: `${triggerCenterY}px`,
          transform: "translateY(-50%)",
        };
        break;
      case "right":
        style = {
          left: `${triggerRect.right + padding}px`,
          top: `${triggerCenterY}px`,
          transform: "translateY(-50%)",
        };
        break;
    }

    // Ensure tooltip stays within viewport
    const finalLeft = Math.max(
      padding,
      Math.min(parseFloat(style.left as string), viewportWidth - tooltipWidth - padding)
    );
    const finalTop = Math.max(
      padding,
      Math.min(parseFloat(style.top as string), viewportHeight - tooltipHeight - padding)
    );

    style.left = `${finalLeft}px`;
    style.top = `${finalTop}px`;

    setCalculatedPosition(newPosition);
    setTooltipStyle(style);
  };

  // Calculate optimal position based on viewport
  useEffect(() => {
    if (isHovered || isExpanded) {
      // Use setTimeout to ensure tooltip is rendered
      const timeoutId = setTimeout(() => {
        updateTooltipPosition();
      }, 0);

      return () => clearTimeout(timeoutId);
    }
  }, [isHovered, isExpanded, position]);

  // Update position on scroll and resize
  useEffect(() => {
    if (isHovered || isExpanded) {
      const handleUpdate = () => {
        requestAnimationFrame(() => {
          updateTooltipPosition();
        });
      };

      window.addEventListener("scroll", handleUpdate, true);
      window.addEventListener("resize", handleUpdate);

      return () => {
        window.removeEventListener("scroll", handleUpdate, true);
        window.removeEventListener("resize", handleUpdate);
      };
    }
  }, [isHovered, isExpanded, position]);

  // Click outside detection (mouse and touch)
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (
        tooltipRef.current &&
        triggerRef.current &&
        !tooltipRef.current.contains(event.target as Node) &&
        !triggerRef.current.contains(event.target as Node)
      ) {
        setIsExpanded(false);
        setIsHovered(false);
      }
    };

    if (isExpanded) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("touchstart", handleClickOutside);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
        document.removeEventListener("touchstart", handleClickOutside);
      };
    }
  }, [isExpanded]);

  // ESC key handler
  useEffect(() => {
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape" && isExpanded) {
        setIsExpanded(false);
        setIsHovered(false);
      }
    };

    if (isExpanded) {
      document.addEventListener("keydown", handleEsc);
      return () => document.removeEventListener("keydown", handleEsc);
    }
  }, [isExpanded]);

  const handleClick = () => {
    if (expandedContent) {
      setIsExpanded(!isExpanded);
    } else {
      // On mobile, show tooltip on click even without expandedContent
      setIsExpanded(!isExpanded);
    }
  };

  const handleTouchStart = () => {
    setIsExpanded(true);
  };

  const arrowClasses = {
    top: "top-full left-1/2 transform -translate-x-1/2",
    bottom: "bottom-full left-1/2 transform -translate-x-1/2",
    left: "left-full top-1/2 transform -translate-y-1/2",
    right: "right-full top-1/2 transform -translate-y-1/2",
  };

  const tooltipContent = (isHovered || isExpanded) && (
    <div
      ref={tooltipRef}
      className="fixed z-9999 pointer-events-auto"
      style={tooltipStyle}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => {
        if (!isExpanded) {
          setIsHovered(false);
        }
      }}
    >
      <div
        className="text-xs rounded-lg shadow-xl p-3 max-w-sm sm:max-w-md wrap-break-word"
        style={{
          background: "var(--bg-elevated)",
          color: "var(--text-primary)",
          border: "1px solid var(--color-border)",
        }}
      >
        <div className="whitespace-normal wrap-break-word">{content}</div>
        {expandedContent && !isExpanded && (
          <p className="mt-2 text-xs italic" style={{ color: "var(--accent)" }}>
            {t("help.clickForMore")}
          </p>
        )}
        {expandedContent && isExpanded && (
          <div className="mt-2 pt-2 border-t" style={{ borderColor: "var(--color-border)" }}>
            <div className="whitespace-normal wrap-break-word" style={{ color: "var(--text-muted)" }}>
              {expandedContent}
            </div>
          </div>
        )}
        {(expandedContent || isExpanded) && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(false);
              setIsHovered(false);
            }}
            onTouchEnd={(e) => {
              e.stopPropagation();
              setIsExpanded(false);
              setIsHovered(false);
            }}
            className="mt-2 text-xs text-blue-400 hover:text-blue-300 active:text-blue-200 underline touch-manipulation"
          >
            {isExpanded ? t("help.less") : t("help.more")}
          </button>
        )}
      </div>
      {/* Arrow - only show when using relative positioning (fallback) */}
      {!tooltipStyle.left && (
        <div
          className={`absolute ${arrowClasses[calculatedPosition]} border-4 border-transparent`}
        ></div>
      )}
    </div>
  );

  return (
    <>
      <div className={`relative inline-block ${className}`}>
        <div
          ref={triggerRef}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => {
            if (!isExpanded) {
              setIsHovered(false);
            }
          }}
          onClick={handleClick}
          onTouchStart={handleTouchStart}
          className="cursor-help touch-manipulation"
        >
          {children}
        </div>
      </div>
      {tooltipContent && createPortal(tooltipContent, document.body)}
    </>
  );
}
