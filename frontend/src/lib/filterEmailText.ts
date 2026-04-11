/**
 * Filter email text to remove links, greetings, footers, etc.
 * Used both in EmailAnnotation (annotation view) and FlightReviewModal (source text preview).
 */
export function filterEmailText(text: string): string {
  let filtered = text;

  // Remove HTML tags but keep text content (do this first)
  filtered = filtered.replace(/<[^>]+>/g, "");
  filtered = filtered.replace(/&nbsp;/g, " ");
  filtered = filtered.replace(/&amp;/g, "&");
  filtered = filtered.replace(/&lt;/g, "<");
  filtered = filtered.replace(/&gt;/g, ">");

  // Remove only full URLs (http/https/www), not domain names in text
  filtered = filtered.replace(/https?:\/\/[^\s<>]+/gi, "");
  filtered = filtered.replace(/www\.[^\s<>]+/gi, "");

  // Remove email addresses (only if they look like actual email addresses)
  filtered = filtered.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "");

  // Remove common greetings (German and English) - only at the start
  const greetingPatterns = [
    /^(Sehr\s+geehrte?[rs]?[,\s]+[^\n]+\n?)/gim,
    /^(Liebe?[rs]?[,\s]+[^\n]+\n?)/gim,
    /^(Hallo[,\s]+[^\n]+\n?)/gim,
    /^(Dear\s+[^\n]+\n?)/gim,
    /^(Hello[,\s]+[^\n]+\n?)/gim,
    /^(Hi[,\s]+[^\n]+\n?)/gim,
  ];
  greetingPatterns.forEach((pattern) => {
    filtered = filtered.replace(pattern, "");
  });

  // Process line by line
  const lines = filtered.split("\n");
  const footerKeywords = [
    "unsubscribe",
    "abmelden",
    "impressum",
    "datenschutz",
    "privacy policy",
    "terms and conditions",
    "agb",
    "allgemeine geschäftsbedingungen",
  ];

  const processedLines = lines
    .map((line) => line.trim())
    .filter((line) => {
      if (line.length === 0) {
        return true;
      }

      const lowerLine = line.toLowerCase();
      if (footerKeywords.some((keyword) => lowerLine.includes(keyword))) {
        return false;
      }

      if (line.length <= 3) {
        const meaningfulChars = line.replace(/[\s\W]/g, "").length;
        if (meaningfulChars === 0) {
          return false;
        }
      }

      return true;
    });

  filtered = processedLines.join("\n");
  filtered = filtered.replace(/\n{2,}/g, "\n");
  filtered = filtered.replace(/[ \t]{2,}/g, " ");

  const closingPatterns = [
    /(Mit\s+freundlichen\s+Grüßen?[^\n]*\n?[^\n]*)$/gim,
    /(Viele\s+Grüße?[^\n]*\n?[^\n]*)$/gim,
    /(Best\s+regards?[^\n]*\n?[^\n]*)$/gim,
    /(Kind\s+regards?[^\n]*\n?[^\n]*)$/gim,
    /(Sincerely[^\n]*\n?[^\n]*)$/gim,
  ];
  closingPatterns.forEach((pattern) => {
    filtered = filtered.replace(pattern, "");
  });

  return filtered.trim();
}
