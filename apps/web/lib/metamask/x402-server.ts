import type { Address, Hex } from 'viem'
import { createPublicClient, erc20Abi, formatUnits, http } from 'viem'
import { baseSepolia } from 'viem/chains'
import { getFacilitatorUrl } from '@/lib/facilitator/url'

export interface MetaMaskX402PaymentRequirements {
  scheme: 'exact'
  network: string
  amount: string
  maxAmountRequired: string
  asset: Address
  payTo: Address
  maxTimeoutSeconds: number
  description?: string
  mimeType?: string
  extra: {
    assetTransferMethod: 'erc7710'
    facilitators: Address[]
    facilitatorAddresses: Address[]
  }
}

export interface MetaMaskX402PaymentHeader {
  x402Version: 2
  accepted: MetaMaskX402PaymentRequirements
  payload: {
    delegationManager: Address
    permissionContext: Hex
    delegator: Address
  }
}

export interface MetaMaskX402PaymentDetails {
  amount: number
  asset: Address
  recipient: Address
  chainId: number
  description?: string
  mimeType?: string
  maxTimeoutSeconds?: number
}

const METAMASK_SMART_ACCOUNT_SUPPORTED_CHAINS = new Set([
  1, 10, 56, 100, 137, 8453, 42161, 42170, 59144, 80094, 130, 747474,
  11155111, 84532, 11155420, 421614, 80002, 59141, 10200,
])

interface FacilitatorCallResult {
  ok: boolean
  status: number
  body: Record<string, unknown>
}

function parseChainId(network: string): number | null {
  const [namespace, reference] = network.split(':')
  if (namespace !== 'eip155' || !reference) {
    return null
  }

  const chainId = Number(reference)
  return Number.isInteger(chainId) ? chainId : null
}

function getRpcUrl(chainId: number): string {
  if (chainId === baseSepolia.id) {
    return process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL
      ?? process.env.BASE_SEPOLIA_RPC_URL
      ?? baseSepolia.rpcUrls.default.http[0]
  }

  return baseSepolia.rpcUrls.default.http[0]
}

async function getTokenDiagnostics(header: MetaMaskX402PaymentHeader) {
  const payer = header.payload.delegator
  const asset = header.accepted.asset
  const requiredAmount = BigInt(header.accepted.amount ?? header.accepted.maxAmountRequired)
  const chainId = parseChainId(header.accepted.network)

  if (!chainId) {
    return {
      payer,
      asset,
      requiredAmount: requiredAmount.toString(),
      network: header.accepted.network,
      error: 'Unable to parse x402 network',
    }
  }

  try {
    const client = createPublicClient({
      chain: chainId === baseSepolia.id ? baseSepolia : undefined,
      transport: http(getRpcUrl(chainId)),
    })
    const [balance, decimalsResult, symbolResult] = await Promise.all([
      client.readContract({
        address: asset,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [payer],
      }),
      client.readContract({
        address: asset,
        abi: erc20Abi,
        functionName: 'decimals',
      }).catch(() => 6),
      client.readContract({
        address: asset,
        abi: erc20Abi,
        functionName: 'symbol',
      }).catch(() => 'USDC'),
    ])
    const decimals = typeof decimalsResult === 'number' ? decimalsResult : 6
    const symbol = typeof symbolResult === 'string' ? symbolResult : 'USDC'

    return {
      payer,
      asset,
      network: header.accepted.network,
      chainId,
      payTo: header.accepted.payTo,
      requiredAmount: requiredAmount.toString(),
      requiredFormatted: `${formatUnits(requiredAmount, decimals)} ${symbol}`,
      payerBalance: balance.toString(),
      payerBalanceFormatted: `${formatUnits(balance, decimals)} ${symbol}`,
      hasEnoughBalance: balance >= requiredAmount,
      facilitatorUrl: getFacilitatorUrl(),
    }
  } catch (error) {
    return {
      payer,
      asset,
      requiredAmount: requiredAmount.toString(),
      network: header.accepted.network,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function normalizeBase64(value: string): string {
  const trimmed = value.trim()
  const withoutScheme = trimmed.includes(' ')
    ? trimmed.slice(trimmed.lastIndexOf(' ') + 1)
    : trimmed

  return withoutScheme
    .replace(/-/g, '+')
    .replace(/_/g, '/')
}

function decodeBase64Json<T>(value: string): T {
  const normalized = normalizeBase64(value)
  const decoded = Buffer.from(normalized, 'base64').toString('utf8')
  return JSON.parse(decoded) as T
}

function parsePaymentHeaderJson<T>(value: string): T {
  const trimmed = value.trim()

  if (trimmed.startsWith('{')) {
    return JSON.parse(trimmed) as T
  }

  return decodeBase64Json<T>(trimmed)
}

export function getMetaMaskX402Facilitators(): Address[] {
  const raw = process.env.METAMASK_X402_FACILITATORS
    ?? process.env.NEXT_PUBLIC_METAMASK_X402_FACILITATORS
    ?? ''

  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value): value is Address => /^0x[a-fA-F0-9]{40}$/.test(value))
}

export function isMetaMaskX402Enabled(): boolean {
  return Boolean(getFacilitatorUrl() && getMetaMaskX402Facilitators().length > 0)
}

export function isMetaMaskX402SupportedChain(chainId: number): boolean {
  return METAMASK_SMART_ACCOUNT_SUPPORTED_CHAINS.has(chainId)
}

export function buildMetaMaskX402Requirements(
  details: MetaMaskX402PaymentDetails
): MetaMaskX402PaymentRequirements {
  return {
    scheme: 'exact',
    network: `eip155:${details.chainId}`,
    amount: details.amount.toString(),
    maxAmountRequired: details.amount.toString(),
    asset: details.asset,
    payTo: details.recipient,
    maxTimeoutSeconds: details.maxTimeoutSeconds ?? 300,
    description: details.description,
    mimeType: details.mimeType,
    extra: {
      assetTransferMethod: 'erc7710',
      facilitators: getMetaMaskX402Facilitators(),
      facilitatorAddresses: getMetaMaskX402Facilitators(),
    },
  }
}

export function encodePaymentRequiredHeader(requirements: MetaMaskX402PaymentRequirements): string {
  return Buffer.from(JSON.stringify({ accepts: [requirements] }), 'utf8').toString('base64')
}

export function parseMetaMaskX402PaymentHeader(value: string): MetaMaskX402PaymentHeader {
  const header = parsePaymentHeaderJson<MetaMaskX402PaymentHeader>(value)

  if (header.x402Version !== 2) {
    throw new Error('Unsupported MetaMask x402 version')
  }

  if (header.accepted.extra?.assetTransferMethod !== 'erc7710') {
    throw new Error('MetaMask x402 payment is not ERC-7710')
  }

  return header
}

function validateMetaMaskPayment(
  header: MetaMaskX402PaymentHeader,
  expectedAmount: number,
  expectedRecipient: Address
): boolean {
  const amount = BigInt(header.accepted.amount ?? header.accepted.maxAmountRequired)

  return amount >= BigInt(expectedAmount)
    && header.accepted.payTo.toLowerCase() === expectedRecipient.toLowerCase()
}

async function callMetaMaskFacilitator(
  action: 'verify' | 'settle',
  header: MetaMaskX402PaymentHeader,
  requirements: MetaMaskX402PaymentRequirements
): Promise<FacilitatorCallResult> {
  const facilitatorUrl = getFacilitatorUrl()

  if (!facilitatorUrl) {
    throw new Error('METAMASK_X402_FACILITATOR_URL is not configured')
  }

  const response = await fetch(`${facilitatorUrl}/${action}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X402-Version': '2',
    },
    body: JSON.stringify({
      x402Version: 2,
      paymentPayload: header,
      paymentRequirements: requirements,
    }),
  })

  const text = await response.text()

  if (!text.trim()) {
    return {
      ok: response.ok,
      status: response.status,
      body: {},
    }
  }

  try {
    return {
      ok: response.ok,
      status: response.status,
      body: JSON.parse(text) as Record<string, unknown>,
    }
  } catch {
    const preview = text.length > 180 ? `${text.slice(0, 180)}...` : text
    throw new Error(
      `METAMASK_X402_FACILITATOR_URL returned non-JSON ${response.status} for /${action}: ${preview}`
    )
  }
}

function findTransactionHash(value: unknown): Hex | null {
  if (typeof value === 'string' && /^0x[a-fA-F0-9]{64}$/.test(value)) {
    return value as Hex
  }

  if (!value || typeof value !== 'object') {
    return null
  }

  for (const candidate of Object.values(value as Record<string, unknown>)) {
    const txHash = findTransactionHash(candidate)
    if (txHash) {
      return txHash
    }
  }

  return null
}

export async function verifyMetaMaskX402Payment(
  paymentHeader: string,
  expectedAmount: number,
  expectedRecipient: Address
): Promise<{ address: Address; paymentHeader: MetaMaskX402PaymentHeader } | null> {
  try {
    const header = parseMetaMaskX402PaymentHeader(paymentHeader)

    if (!validateMetaMaskPayment(header, expectedAmount, expectedRecipient)) {
      return null
    }

    const response = await callMetaMaskFacilitator('verify', header, header.accepted)
    const result = response.body

    if (!response.ok || result.isValid !== true) {
      console.error('[MetaMask x402] Facilitator verification rejected payment:', result)
      console.error('[MetaMask x402] Payment diagnostics:', await getTokenDiagnostics(header))
      return null
    }

    return {
      address: header.payload.delegator,
      paymentHeader: header,
    }
  } catch (error) {
    console.error('[MetaMask x402] Verification failed:', error)
    return null
  }
}

export async function settleMetaMaskX402Payment(
  paymentHeader: string,
  header: MetaMaskX402PaymentHeader
): Promise<{ txHash: Hex } | null> {
  try {
    const response = await callMetaMaskFacilitator('settle', header, header.accepted)
    const result = response.body

    if (!response.ok) {
      console.error('[MetaMask x402] Facilitator settlement failed:', result)
      console.error('[MetaMask x402] Payment diagnostics:', await getTokenDiagnostics(header))
      return null
    }

    if (result.success === false || result.isValid === false) {
      console.error('[MetaMask x402] Facilitator settlement was not successful:', result)
      console.error('[MetaMask x402] Payment diagnostics:', await getTokenDiagnostics(header))
      return null
    }

    const txHash = findTransactionHash(result.txHash)
      ?? findTransactionHash(result.transactionHash)
      ?? findTransactionHash(result.tx)
      ?? findTransactionHash(result)

    if (!txHash) {
      console.error('[MetaMask x402] Facilitator settlement response did not include a transaction hash:', result)
      console.error('[MetaMask x402] Payment diagnostics:', await getTokenDiagnostics(header))
      return null
    }

    return { txHash }
  } catch (error) {
    console.error('[MetaMask x402] Settlement failed:', error)
    return null
  }
}
