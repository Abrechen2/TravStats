import { useTranslation } from '../hooks/useTranslation';
import { Flight } from '../types';

interface DataSourceBadgesProps {
  flight: Flight;
}

export default function DataSourceBadges({ flight }: DataSourceBadgesProps) {
  const { t } = useTranslation(['flights', 'common']);

  const badges: Array<{ icon: string; label: string; color: string; tooltip?: string }> = [];

  // Check if we should show combined "Live + Auto Update" badge
  const hasLiveUpdate = flight.dataSource === 'live_update';
  const hasAutoUpdate = flight.lastModifiedBy === 'auto_update';
  const showCombinedBadge = hasLiveUpdate && hasAutoUpdate;

  // Determine primary data source badge
  if (flight.dataSource) {
    // Skip showing live_update badge if we'll show the combined badge instead
    if (showCombinedBadge) {
      // Don't add the regular live_update badge, we'll add the combined one below
    } else {
      const sourceConfig = getDataSourceConfig(flight.dataSource, t);
      if (sourceConfig) {
        badges.push({
          ...sourceConfig,
          tooltip: getDataSourceTooltip(flight, sourceConfig.label, t),
        });
      }
    }
  }

  // Add combined "Live + Auto Update" badge if both conditions are met
  if (showCombinedBadge) {
    badges.push({
      icon: '🔄',
      label: t('flights:dataSource.live_update_auto'),
      color: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
      tooltip: t('flights:dataSource.live_update_auto_tooltip'),
    });
  }

  // Add enrichment badge if applicable
  if (flight.enrichmentHistory && flight.enrichmentHistory.length > 0) {
    const enrichmentCount = flight.enrichmentHistory.length;
    badges.push({
      icon: '🔍',
      label: enrichmentCount > 1 
        ? t('flights:enrichmentCount', { count: enrichmentCount })
        : t('flights:dataSource.historical_enrichment'),
      color: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
      tooltip: getEnrichmentTooltip(flight.enrichmentHistory, t),
    });
  }

  // Add last modified badge if different from source
  // Only add if it's not already shown as the primary data source or combined badge
  if (flight.lastModifiedBy && flight.lastModifiedBy !== 'user' && flight.dataSource !== 'manual' && !showCombinedBadge) {
    if (flight.lastModifiedBy === 'auto_update') {
      // Only add AUTO UPDATE badge if dataSource is not already 'live_update' (to avoid duplicates)
      if (flight.dataSource !== 'live_update') {
        badges.push({
          icon: '🔄',
          label: t('flights:dataSource.auto_update'),
          color: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
        });
      }
    } else if (flight.lastModifiedBy === 'historical_enrichment') {
      // Already shown in enrichment badge
    }
  }

  if (badges.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {badges.map((badge, index) => (
        <span
          key={index}
          className={`px-2 py-1 rounded-full text-xs font-medium ${badge.color}`}
          title={badge.tooltip}
        >
          {badge.icon} {badge.label}
        </span>
      ))}
    </div>
  );
}

function getDataSourceConfig(
  source: string,
  t: (key: string, options?: any) => string
): { icon: string; label: string; color: string } | null {
  const configs: Record<string, { icon: string; label: string; color: string }> = {
    manual: {
      icon: '✏️',
      label: t('flights:dataSource.manual'),
      color: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
    },
    email_import: {
      icon: '📧',
      label: t('flights:dataSource.email_import'),
      color: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    },
    boarding_pass_scan: {
      icon: '🎫',
      label: t('flights:dataSource.boarding_pass_scan'),
      color: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
    },
    historical_enrichment: {
      icon: '🔍',
      label: t('flights:dataSource.historical_enrichment'),
      color: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
    },
    live_update: {
      icon: '🔄',
      label: t('flights:dataSource.live_update'),
      color: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    },
    api_lookup: {
      icon: '🌐',
      label: t('flights:dataSource.api_lookup'),
      color: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200',
    },
  };

  return configs[source] || null;
}

function getDataSourceTooltip(
  flight: Flight,
  sourceLabel: string,
  t: (key: string, options?: any) => string
): string {
  let tooltip = sourceLabel;
  
  if (flight.dataSource === 'historical_enrichment' && flight.enrichmentHistory) {
    const latest = flight.enrichmentHistory[flight.enrichmentHistory.length - 1];
    if (latest.confidence) {
      tooltip += ` (${t('flights:confidence')}: ${latest.confidence}%)`;
    }
    if (latest.sourceFlightsCount) {
      tooltip += ` - ${t('flights:sourceFlightsCount', { count: latest.sourceFlightsCount })}`;
    }
  }

  return tooltip;
}

function getEnrichmentTooltip(
  history: Array<{type: string; timestamp: string; confidence?: number; source?: string; sourceFlightsCount?: number}>,
  t: (key: string, options?: any) => string
): string {
  const latest = history[history.length - 1];
  let tooltip = t('flights:enrichmentHistory');
  
  if (latest.confidence) {
    tooltip += `: ${latest.confidence}% ${t('flights:confidence')}`;
  }
  if (latest.sourceFlightsCount) {
    tooltip += ` (${t('flights:sourceFlightsCount', { count: latest.sourceFlightsCount })})`;
  }
  
  return tooltip;
}

