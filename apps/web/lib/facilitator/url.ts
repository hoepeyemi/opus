const DEFAULT_X402_FACILITATOR_URL = 'https://x402.org/facilitator'

function normalizeFacilitatorUrl(raw: string): string {
  return raw
    .trim()
    .replace(/\/$/, '')
    .replace(/\/(verify|settle)$/i, '')
    .replace(/\/supported$/i, '')
}

export function getFacilitatorUrl(): string | null {
  const raw = process.env.METAMASK_X402_FACILITATOR_URL?.trim()

  if (!raw) {
    return null
  }

  return normalizeFacilitatorUrl(raw)
}

export function getSessionKeyFacilitatorUrl(): string {
  const raw = process.env.X402_FACILITATOR_URL?.trim()

  return normalizeFacilitatorUrl(raw || DEFAULT_X402_FACILITATOR_URL)
}
