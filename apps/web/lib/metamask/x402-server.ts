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

function decodeBase64Json<T>(value: string): T {
  const decoded = Buffer.from(value, 'base64').toString('utf8')
  return JSON.parse(decoded) as T
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
  const header = decodeBase64Json<MetaMaskX402PaymentHeader>(value)

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
  paymentHeader: string,
  requirements: MetaMaskX402PaymentRequirements
): Promise<Response> {
  const facilitatorUrl = getFacilitatorUrl()

  if (!facilitatorUrl) {
    throw new Error('METAMASK_X402_FACILITATOR_URL is not configured')
  }

  return fetch(`${facilitatorUrl}/${action}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X402-Version': '2',
    },
    body: JSON.stringify({
      x402Version: 2,
      paymentHeader,
      paymentRequirements: requirements,
    }),
  })
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

    const response = await callMetaMaskFacilitator('verify', paymentHeader, header.accepted)
    const result = await response.json()

    if (!response.ok || result.isValid !== true) {
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
    const response = await callMetaMaskFacilitator('settle', paymentHeader, header.accepted)
    const result = await response.json()

    if (!response.ok) {
      return null
    }

    const txHash = result.txHash ?? result.transactionHash

    if (!txHash) {
      return null
    }

    return { txHash }
  } catch (error) {
    console.error('[MetaMask x402] Settlement failed:', error)
    return null
  }
}
