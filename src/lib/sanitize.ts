/**
 * Input sanitization for inbound WhatsApp message content.
 *
 * Applied at the processor layer (webhook/processor.ts) so every handler
 * receives clean text. Also exported for use on address inputs before
 * Google Maps API calls and on user-supplied fields before DB inserts.
 */

const MAX_LENGTH = 1000

/**
 * Sanitize a single string from an untrusted source.
 *
 * Operations applied in order:
 *   1. Strip null bytes and ASCII control characters (except \t, \n, \r)
 *   2. Strip HTML / XML tags
 *   3. Normalise internal whitespace (collapse runs, trim edges)
 *   4. Truncate to MAX_LENGTH characters
 *
 * Returns an empty string for null / undefined / whitespace-only input.
 */
export function sanitizeInput(text: string | undefined | null): string {
  if (!text) return ''

  return text
    // 1. Replace null bytes and control characters with a space (keep tab, LF, CR)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ')
    // 2. Replace HTML / XML tags with a space so adjacent words don't merge
    .replace(/<[^>]*>/g, ' ')
    // 3. Normalise whitespace — collapse runs to single space, trim edges
    .replace(/\s+/g, ' ')
    .trim()
    // 4. Truncate
    .slice(0, MAX_LENGTH)
}
