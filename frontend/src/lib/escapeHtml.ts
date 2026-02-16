/**
 * Escapes HTML special characters to prevent XSS attacks
 * Used for content injected into HTML strings (e.g., tooltip labels)
 */
export function escapeHtml(unsafe: string | undefined | null): string {
  if (!unsafe) return '';
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
