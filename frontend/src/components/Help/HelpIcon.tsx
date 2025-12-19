import { useState, useRef, useEffect } from 'react';

interface HelpIconProps {
  content: string;
  expandedContent?: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}

export default function HelpIcon({
  content,
  expandedContent,
  position = 'top',
  className = '',
}: HelpIconProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const iconRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        tooltipRef.current &&
        iconRef.current &&
        !tooltipRef.current.contains(event.target as Node) &&
        !iconRef.current.contains(event.target as Node)
      ) {
        setIsExpanded(false);
      }
    };

    if (isExpanded) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isExpanded]);

  const handleClick = () => {
    if (expandedContent) {
      setIsExpanded(!isExpanded);
    }
  };

  const positionClasses = {
    top: 'bottom-full left-1/2 transform -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 transform -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 transform -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 transform -translate-y-1/2 ml-2',
  };

  return (
    <div className={`relative inline-flex items-center ${className}`}>
      <div
        ref={iconRef}
        className="cursor-help text-gray-400 hover:text-blue-500 dark:text-gray-500 dark:hover:text-blue-400 transition-colors"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onClick={handleClick}
        aria-label="Hilfe anzeigen"
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

      {(isHovered || isExpanded) && (
        <div
          ref={tooltipRef}
          className={`absolute z-50 ${positionClasses[position]} ${
            isExpanded ? 'block' : 'hidden md:block'
          }`}
        >
          <div className="bg-gray-900 dark:bg-gray-700 text-white text-xs rounded-lg shadow-lg p-3 max-w-xs">
            <p className="whitespace-normal">{content}</p>
            {expandedContent && (
              <div className="mt-2 pt-2 border-t border-gray-600 dark:border-gray-500">
                <p className="whitespace-normal text-gray-300 dark:text-gray-300">
                  {expandedContent}
                </p>
              </div>
            )}
            {expandedContent && (
              <button
                onClick={() => setIsExpanded(false)}
                className="mt-2 text-xs text-blue-400 hover:text-blue-300 underline"
              >
                Schließen
              </button>
            )}
          </div>
          {/* Arrow */}
          <div
            className={`absolute ${
              position === 'top'
                ? 'top-full left-1/2 transform -translate-x-1/2 border-t-gray-900 dark:border-t-gray-700'
                : position === 'bottom'
                  ? 'bottom-full left-1/2 transform -translate-x-1/2 border-b-gray-900 dark:border-b-gray-700'
                  : position === 'left'
                    ? 'left-full top-1/2 transform -translate-y-1/2 border-l-gray-900 dark:border-l-gray-700'
                    : 'right-full top-1/2 transform -translate-y-1/2 border-r-gray-900 dark:border-r-gray-700'
            } border-4 border-transparent`}
          ></div>
        </div>
      )}
    </div>
  );
}






