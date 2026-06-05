import type { Address } from 'viem'
import { isAddress } from 'viem'

/**
 * Result of recipient resolution
 */
export interface ResolvedRecipient {
  address: Address
  displayName: string
}

/**
 * Error types for recipient resolution
 */
export type RecipientResolutionError = 'invalid_address'

/**
 * Resolve recipient to an address.
 *
 * @param recipientOrDomain - EVM address
 * @returns Resolved recipient info or throws with error type
 */
export async function resolveRecipient(
  recipientOrDomain: string
): Promise<ResolvedRecipient> {
  const normalized = recipientOrDomain.toLowerCase().trim()

  if (isAddress(normalized)) {
    return {
      address: normalized as Address,
      displayName: `${normalized.slice(0, 6)}...${normalized.slice(-4)}`,
    }
  }

  // Invalid address format
  console.log('[Pay] Invalid address format:', normalized)
  const error = new Error('Invalid address') as Error & {
    type: RecipientResolutionError
  }
  error.type = 'invalid_address'
  throw error
}
