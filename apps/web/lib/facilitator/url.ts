export function getFacilitatorUrl(): string | null {
  const raw = process.env.METAMASK_X402_FACILITATOR_URL?.trim()

  if (!raw) {
    return null
  }

  const url = raw
    .replace(/\/$/, '')
    .replace(/\/(verify|settle)$/i, '')
    .replace(/\/supported$/i, '')

  return url
}
