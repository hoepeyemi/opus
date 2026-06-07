import type { Address, Hex } from 'viem'
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
      return null
    }

    const txHash = result.txHash ?? result.transactionHash

    if (typeof txHash !== 'string' || !/^0x[a-fA-F0-9]+$/.test(txHash)) {
      return null
    }

    return { txHash: txHash as Hex }
  } catch (error) {
    console.error('[MetaMask x402] Settlement failed:', error)
    return null
  }
}
