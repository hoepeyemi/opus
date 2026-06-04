import { createPublicClient, http, namehash, type Address } from 'viem'
import { cronos } from '@reown/appkit/networks'

/**
 * CronosID Registry Contract Address (Mainnet)
 * From https://docs.cronosid.xyz/developers-resources/domain-integration
 *
 * IMPORTANT: Domain resolution ALWAYS happens on mainnet regardless of
 * which network is used for payments. Domains are registered on mainnet only.
 */
const CRONOS_ID_REGISTRY_MAINNET = '0x7F4C61116729d5b27E5f180062Fdfbf32E9283E5' as Address

/**
 * CronosID Registry ABI (minimal for resolution)
 */
const REGISTRY_ABI = [
  {
    name: 'resolver',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ name: '', type: 'address' }],
  },
] as const

/**
 * Resolver ABI for address lookup and reverse lookup
 */
const RESOLVER_ABI = [
  {
    name: 'addr',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'name',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ name: '', type: 'string' }],
  },
] as const

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address

/**
 * Check if a string is a valid .cro domain format
 * Valid: schwiz.cro, my-domain.cro, test123.cro
 * Invalid: .cro, -domain.cro, domain-.cro
 */
export function isCroDomain(value: string): boolean {
  const normalized = value.toLowerCase().trim()
  // Must end with .cro, start with alphanumeric, can contain hyphens but not at start/end of name
  return /^[a-z0-9][a-z0-9-]*[a-z0-9]\.cro$|^[a-z0-9]\.cro$/.test(normalized)
}

/**
 * Check if a string is a valid EVM address
 */
export function isValidAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value)
}

/**
 * Resolve a .cro domain to an EVM address using CronosID registry
 *
 * NOTE: Resolution always happens on Cronos mainnet since domains
 * are only registered there. The payment network can still be testnet.
 *
 * @param domain - The .cro domain to resolve (e.g., "schwiz.cro")
 * @returns The resolved address or null if not found
 */
export async function resolveCroDomain(domain: string): Promise<Address | null> {
  const normalizedDomain = domain.toLowerCase().trim()

  if (!isCroDomain(normalizedDomain)) {
    console.error('[CronosID] Invalid domain format:', normalizedDomain)
    return null
  }

  // Always use mainnet for domain resolution - domains are only registered there
  const client = createPublicClient({
    chain: cronos,
    transport: http(),
  })

  try {
    // Compute ENS-compatible namehash for the domain
    const node = namehash(normalizedDomain)
    console.log('[CronosID] Resolving domain:', normalizedDomain, '-> node:', node)

    // Get resolver address from registry
    const resolverAddress = await client.readContract({
      address: CRONOS_ID_REGISTRY_MAINNET,
      abi: REGISTRY_ABI,
      functionName: 'resolver',
      args: [node],
    })

    console.log('[CronosID] Resolver address:', resolverAddress)

    if (!resolverAddress || resolverAddress === ZERO_ADDRESS) {
      console.log('[CronosID] No resolver found for domain:', normalizedDomain)
      return null
    }

    // Get address from resolver
    const address = await client.readContract({
      address: resolverAddress,
      abi: RESOLVER_ABI,
      functionName: 'addr',
      args: [node],
    })

    console.log('[CronosID] Resolved address:', address)

    if (!address || address === ZERO_ADDRESS) {
      console.log('[CronosID] No address set for domain:', normalizedDomain)
      return null
    }

    return address
  } catch (error) {
    console.error('[CronosID] Resolution failed:', error)
    return null
  }
}

/**
 * Reverse lookup: Get the .cro domain name for an EVM address
 *
 * NOTE: Resolution always happens on Cronos mainnet since domains
 * are only registered there.
 *
 * @param address - The EVM address to reverse lookup
 * @returns The .cro domain name or null if not found
 */
export async function reverseLookupCroDomain(address: Address): Promise<string | null> {
  // Always use mainnet for domain resolution
  const client = createPublicClient({
    chain: cronos,
    transport: http(),
  })

  try {
    // For reverse lookup, we need to compute namehash('address.addr.reverse')
    // where address is lowercase without 0x prefix
    const addressWithoutPrefix = address.toLowerCase().slice(2)
    const reverseNode = namehash(`${addressWithoutPrefix}.addr.reverse`)

    console.log('[CronosID] Reverse lookup for:', address, '-> node:', reverseNode)

    // Get resolver address from registry
    const resolverAddress = await client.readContract({
      address: CRONOS_ID_REGISTRY_MAINNET,
      abi: REGISTRY_ABI,
      functionName: 'resolver',
      args: [reverseNode],
    })

    console.log('[CronosID] Reverse resolver address:', resolverAddress)

    if (!resolverAddress || resolverAddress === ZERO_ADDRESS) {
      console.log('[CronosID] No reverse resolver found for address:', address)
      return null
    }

    // Get name from resolver
    const name = await client.readContract({
      address: resolverAddress,
      abi: RESOLVER_ABI,
      functionName: 'name',
      args: [reverseNode],
    })

    console.log('[CronosID] Reverse resolved name:', name)

    if (!name) {
      console.log('[CronosID] No name set for address:', address)
      return null
    }

    return name
  } catch (error) {
    console.error('[CronosID] Reverse lookup failed:', error)
    return null
  }
}
