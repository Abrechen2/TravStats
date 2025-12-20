import { useState, useRef, useEffect, ReactNode } from 'react';
import { useTranslation } from '../../hooks/useTranslation';

interface TooltipProps {
  content: string | ReactNode;
  expandedContent?: string | ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
  children: ReactNode;
  className?: string;
}

export default function Tooltip({
  content,
  expandedContent,
  position = 'top',
  children,
  className = '',
}: TooltipProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation('common');

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        tooltipRef.current &&
        triggerRef.current &&
        !tooltipRef.current.contains(event.target as Node) &&
        !triggerRef.current.contains(event.target as Node)
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
    <div className={`relative inline-block ${className}`}>
      <div
        ref={triggerRef}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => !isExpanded && setIsHovered(false)}
        onClick={handleClick}
        className="cursor-help"
      >
        {children}
      </div>

      {(isHovered || isExpanded) && (
        <div
          ref={tooltipRef}
          className={`absolute z-50 ${positionClasses[position]} ${
            isExpanded ? 'block' : 'hidden md:block'
          }`}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => {
            if (!isExpanded) {
              setIsHovered(false);
            }
          }}
        >
          <div className="bg-gray-900 dark:bg-gray-700 text-white text-xs rounded-lg shadow-lg p-3 max-w-xs">
            <div className="whitespace-normal">{content}</div>
            {expandedContent && isExpanded && (
              <div className="mt-2 pt-2 border-t border-gray-600 dark:border-gray-500">
                <div className="whitespace-normal text-gray-300 dark:text-gray-300">
                  {expandedContent}
                </div>
              </div>
            )}
            {expandedContent && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setIsExpanded(false);
                  setIsHovered(false);
                }}
                className="mt-2 text-xs text-blue-400 hover:text-blue-300 underline"
              >
                {isExpanded ? t('help.less') : t('help.more')}
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










