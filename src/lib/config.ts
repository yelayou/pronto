/**
 * Centralised environment variable validation.
 * Validated vars are exported as typed constants so call-sites never
 * need to handle undefined or fall back to placeholder strings.
 *
 * This module throws at load time if a required var is absent, surfacing
 * misconfiguration immediately on startup rather than silently at runtime.
 */

const etransferLink = process.env.ETRANSFER_LINK

if (!etransferLink) {
  throw new Error(
    'Missing required env var: ETRANSFER_LINK — set this to your Interac autodeposit email or link in .env.local (dev) and Vercel environment variables (staging/prod).'
  )
}

export const ETRANSFER_LINK: string = etransferLink
