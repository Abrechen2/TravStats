/**
 * Export utility functions
 * Helpers for CSV, PDF, and KML export
 */

/**
 * Escape a value for use in CSV
 * Handles commas, quotes, and newlines correctly
 * @param value Value to escape
 * @returns Escaped CSV value
 */
export function escapeCsv(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }

  const stringValue = String(value);

  // If the value contains comma, quote, or newline, escape it
  if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
    // Escape quotes by doubling them, then wrap in quotes
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

/**
 * Convert array of rows to CSV string
 * @param rows Array of row arrays
 * @returns CSV string
 */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows
    .map(row => row.map(cell => escapeCsv(cell)).join(','))
    .join('\n');
}

/**
 * Escape HTML special characters
 * @param text Text to escape
 * @returns HTML-escaped text
 */
export function escapeHtml(text: string | number | null | undefined): string {
  if (text === null || text === undefined) {
    return '';
  }

  const stringValue = String(text);
  return stringValue
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Escape XML special characters
 * @param text Text to escape
 * @returns XML-escaped text
 */
export function escapeXml(text: string | number | null | undefined): string {
  if (text === null || text === undefined) {
    return '';
  }

  const stringValue = String(text);
  return stringValue
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Download a blob as a file
 * @param blob Blob to download
 * @param filename Filename for the download
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
