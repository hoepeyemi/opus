import type { Address, PublicClient } from 'viem'

/**
 * ERC-7702 Delegation Prefix
 *
 * When an EOA is delegated via ERC-7702, its code becomes:
 * 0xef0100 + 20-byte contract address = 23 bytes total
 *
 * This prefix indicates the EOA's execution is delegated to the specified contract.
 */
const ERC7702_DELEGATION_PREFIX = '0xef0100'

/**
 * Check if an EOA has delegated to a specific contract via ERC-7702
 *
 * @param client - Viem public client
 * @param eoaAddress - The EOA address to check
 * @param delegationTarget - The expected delegation target contract address
 * @returns true if the EOA is delegated to the target contract
 */
export async function checkDelegation(
  client: PublicClient,
  eoaAddress: Address,
  delegationTarget: Address
): Promise<boolean> {
  try {
    const code = await client.getCode({ address: eoaAddress })

    if (!code || code === '0x') {
      return false
    }

    // ERC-7702 delegation code: 0xef0100 + 20-byte address = 23 bytes (46 hex chars + 0x prefix)
    const expectedCode = `${ERC7702_DELEGATION_PREFIX}${delegationTarget.slice(2).toLowerCase()}`

    return code.toLowerCase() === expectedCode.toLowerCase()
  } catch (error) {
    console.error('[checkDelegation] Error checking delegation status:', error)
    return false
  }
}

/**
 * Get the delegation target if the EOA is delegated via ERC-7702
 *
 * @param client - Viem public client
 * @param eoaAddress - The EOA address to check
 * @returns The delegation target address, or null if not delegated
 */
export async function getDelegationTarget(
  client: PublicClient,
  eoaAddress: Address
): Promise<Address | null> {
  try {
    const code = await client.getCode({ address: eoaAddress })

    if (!code || code === '0x') {
      return null
    }

    // Check for ERC-7702 delegation prefix
    if (!code.toLowerCase().startsWith(ERC7702_DELEGATION_PREFIX)) {
      return null
    }

    // Extract the 20-byte address (40 hex chars after the prefix)
    const addressHex = code.slice(ERC7702_DELEGATION_PREFIX.length)
    if (addressHex.length !== 40) {
      return null
    }

    return `0x${addressHex}` as Address
  } catch (error) {
    console.error('[getDelegationTarget] Error getting delegation target:', error)
    return null
  }
}
