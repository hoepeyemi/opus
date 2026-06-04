export function getFacilitatorUrl(): string | null {
  return process.env.METAMASK_X402_FACILITATOR_URL?.replace(/\/$/, '') ?? null
}

