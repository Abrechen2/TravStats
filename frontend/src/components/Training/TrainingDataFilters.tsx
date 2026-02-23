import { useState, useEffect, useRef } from "react";

interface TrainingDataFiltersProps {
  trainingData: Array<{
    status: string;
    type: string;
    tags?: string[];
  }>;
  onFilterChange: (filters: {
    status?: string;
    type?: string;
    tags?: string[];
    search?: string;
  }) => void;
}

export default function TrainingDataFilters({
  trainingData,
  onFilterChange,
}: TrainingDataFiltersProps): JSX.Element {
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Extract all unique tags from training data
  const allTags = Array.from(
    new Set(trainingData.flatMap((data) => data.tags || []).filter(Boolean))
  ).sort();

  // Extract unique statuses and types
  const allStatuses = Array.from(new Set(trainingData.map((data) => data.status))).sort();
  const allTypes = Array.from(new Set(trainingData.map((data) => data.type))).sort();

  // Track previous filter values to prevent unnecessary updates
  const prevFiltersRef = useRef<string>("");

  useEffect(() => {
    const newFilters = {
      status: statusFilter || undefined,
      type: typeFilter || undefined,
      tags: selectedTags.length > 0 ? selectedTags : undefined,
      search: searchQuery.trim() || undefined,
    };

    // Create a stable string representation for comparison
    const filtersKey = JSON.stringify({
      status: newFilters.status || "",
      type: newFilters.type || "",
      tags: (newFilters.tags || []).sort().join(","),
      search: newFilters.search || "",
    });

    // Only call onFilterChange if filters actually changed
    if (prevFiltersRef.current !== filtersKey) {
      prevFiltersRef.current = filtersKey;
      onFilterChange(newFilters);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, typeFilter, selectedTags, searchQuery]);

  const handleTagToggle = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const clearFilters = () => {
    setStatusFilter("");
    setTypeFilter("");
    setSelectedTags([]);
    setSearchQuery("");
  };

  const hasActiveFilters =
    statusFilter || typeFilter || selectedTags.length > 0 || searchQuery.trim();

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Filter</h3>
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
          >
            Filter zurücksetzen
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Search */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Suche
          </label>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="ID oder Dateiname..."
            className="input w-full"
          />
        </div>

        {/* Status Filter */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Status
          </label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="input w-full"
          >
            <option value="">Alle</option>
            {allStatuses.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </div>

        {/* Type Filter */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Typ
          </label>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="input w-full"
          >
            <option value="">Alle</option>
            {allTypes.map((type) => (
              <option key={type} value={type}>
                {type === "email" ? "Email" : "Boarding Pass"}
              </option>
            ))}
          </select>
        </div>

        {/* Tags Filter */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Tags ({selectedTags.length} ausgewählt)
          </label>
          <div className="max-h-32 overflow-y-auto border border-gray-300 dark:border-gray-600 rounded-md p-2 bg-white dark:bg-gray-700">
            {allTags.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">Keine Tags verfügbar</p>
            ) : (
              <div className="space-y-1">
                {allTags.map((tag) => (
                  <label
                    key={tag}
                    className="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-600 p-1 rounded"
                  >
                    <input
                      type="checkbox"
                      checked={selectedTags.includes(tag)}
                      onChange={() => handleTagToggle(tag)}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-gray-700 dark:text-gray-300">{tag}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
