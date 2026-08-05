import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "../../hooks/useTranslation";

interface HelpIconProps {
  content: string;
  expandedContent?: string;
  position?: "top" | "bottom" | "left" | "right";
  className?: string;
}

export default function HelpIcon({
  content,
  expandedContent,
  position = "top",
  className = "",
}: HelpIconProps): JSX.Element {
  const [isHovered, setIsHovered] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [calculatedPosition, setCalculatedPosition] = useState<"top" | "bottom" | "left" | "right">(
    position
  );
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties>({});
  const iconRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation("common");

  // Function to calculate and update tooltip position
  const updateTooltipPosition = () => {
    if (!iconRef.current || !tooltipRef.current) return;

    const iconRect = iconRef.current.getBoundingClientRect();
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
          return iconRect.top - tooltipHeight - padding >= 0;
        case "bottom":
          return iconRect.bottom + tooltipHeight + padding <= viewportHeight;
        case "left":
          return iconRect.left - tooltipWidth - padding >= 0;
        case "right":
          return iconRect.right + tooltipWidth + padding <= viewportWidth;
      }
    };

    // Try preferred position first
    if (!checkPosition(position)) {
      // Try alternative positions
      if (position === "top" || position === "bottom") {
        if (iconRect.top < viewportHeight / 2) {
          newPosition = "bottom";
        } else {
          newPosition = "top";
        }
      } else {
        if (iconRect.left < viewportWidth / 2) {
          newPosition = "right";
        } else {
          newPosition = "left";
        }
      }
    }

    // Calculate absolute position for portal
    const iconCenterX = iconRect.left + iconRect.width / 2;
    const iconCenterY = iconRect.top + iconRect.height / 2;

    switch (newPosition) {
      case "top":
        style = {
          left: `${iconCenterX}px`,
          top: `${iconRect.top - tooltipHeight - padding}px`,
          transform: "translateX(-50%)",
        };
        break;
      case "bottom":
        style = {
          left: `${iconCenterX}px`,
          top: `${iconRect.bottom + padding}px`,
          transform: "translateX(-50%)",
        };
        break;
      case "left":
        style = {
          left: `${iconRect.left - tooltipWidth - padding}px`,
          top: `${iconCenterY}px`,
          transform: "translateY(-50%)",
        };
        break;
      case "right":
        style = {
          left: `${iconRect.right + padding}px`,
          top: `${iconCenterY}px`,
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
      // Use requestAnimationFrame to ensure tooltip is rendered
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
        iconRef.current &&
        !tooltipRef.current.contains(event.target as Node) &&
        !iconRef.current.contains(event.target as Node)
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
        <p className="whitespace-normal wrap-break-word">{content}</p>
        {expandedContent && !isExpanded && (
          <p className="mt-2 text-xs italic" style={{ color: "var(--accent)" }}>
            {t("help.clickForMore")}
          </p>
        )}
        {expandedContent && isExpanded && (
          <div className="mt-2 pt-2 border-t" style={{ borderColor: "var(--color-border)" }}>
            <p className="whitespace-normal wrap-break-word" style={{ color: "var(--text-muted)" }}>
              {expandedContent}
            </p>
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
            {t("buttons.close")}
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
      <div className={`relative inline-flex items-center ${className}`}>
        <div
          ref={iconRef}
          className="cursor-help transition-colors touch-manipulation"
          style={{ color: "var(--text-muted)" }}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => {
            if (!isExpanded) {
              setIsHovered(false);
            }
          }}
          onClick={handleClick}
          onTouchStart={handleTouchStart}
          aria-label={t("accessibility.showHelp")}
        >
          <svg
            className="w-4 h-4"
            fill="currentColor"
            viewBox="0 0 20 20"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 8a3.001 3.001 0 01-2 2.83V11a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zm0 8a1 1 0 100-2 1 1 0 000 2z"
              clipRule="evenodd"
            />
          </svg>
        </div>
      </div>
      {tooltipContent && createPortal(tooltipContent, document.body)}
    </>
  );
}
