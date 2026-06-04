import type { Address } from 'viem'
import { resolveCroDomain, isCroDomain, isValidAddress } from '@/lib/cronosid'

/**
 * Result of recipient resolution
 */
export interface ResolvedRecipient {
  address: Address
  isDomain: boolean
  domainName?: string
  displayName: string
}

/**
 * Error types for recipient resolution
 */
export type RecipientResolutionError = 'domain_not_found' | 'invalid_address'

/**
 * Resolve recipient to an address, handling .cro domains
 *
 * @param recipientOrDomain - Either an EVM address or a .cro domain
 * @returns Resolved recipient info or throws with error type
 */
export async function resolveRecipient(
  recipientOrDomain: string
): Promise<ResolvedRecipient> {
  const normalized = recipientOrDomain.toLowerCase().trim()

  if (isCroDomain(normalized)) {
    // Resolve .cro domain to address (always uses mainnet)
    const address = await resolveCroDomain(normalized)

    if (!address) {
      console.log('[Pay] Failed to resolve .cro domain:', normalized)
      const error = new Error('Domain not found') as Error & {
        type: RecipientResolutionError
      }
      error.type = 'domain_not_found'
      throw error
    }

    return {
      address,
      isDomain: true,
      domainName: normalized,
      displayName: normalized,
    }
  }

  if (isValidAddress(normalized)) {
    return {
      address: normalized as Address,
      isDomain: false,
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
