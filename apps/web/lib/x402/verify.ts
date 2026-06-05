import { paymentNonceRepository } from '@/lib/repositories'
import { getUsdcConfig, defaultChainId } from '@/config/tokens'
import { type Address } from 'viem'
import { getFacilitatorUrl } from '@/lib/facilitator/url'

/**
 * x402 Payment Verification Service
 *
 * Handles verification of x402 payments by delegating to the configured x402 facilitator.
 * Manages payment nonces to prevent replay attacks.
 */

/**
 * Payment payload structure per x402 spec.
 */
export interface PaymentPayload {
  from: string
  to: string
  value: string
  validAfter: number
  validBefore: number
  nonce: string
  signature: string
  asset: string
}

/**
 * Full payment header structure (base64-decoded)
 * Per x402 spec.
 */
export interface PaymentHeader {
  x402Version: number
  scheme: string
  network: string
  payload: PaymentPayload
}

export interface PaymentDetails {
  amount: number
  asset: string
  recipient: string
  chainId: number
  description?: string
  mimeType?: string
  maxTimeoutSeconds?: number
}

/**
 * Parse chain ID from network string
 * Supports both "base-sepolia" and CAIP-2 format such as "eip155:84532".
 */
function parseChainId(network: string): number {
  if (network === 'base-sepolia') return 84532

  // Handle CAIP-2 format (eip155:chainId)
  const parts = network.split(':')
  if (parts.length === 2 && parts[0] === 'eip155') {
    return parseInt(parts[1], 10)
  }

  throw new Error(`Invalid network format: ${network}`)
}

/**
 * Generate a unique nonce for a payment request.
 */
export async function generatePaymentNonce(): Promise<string> {
  return paymentNonceRepository.generate()
}

/**
 * Check if a payment nonce has been used (for replay attack detection).
 */
export async function isPaymentNonceUsed(nonce: string): Promise<boolean> {
  return paymentNonceRepository.isUsed(nonce)
}

/**
 * Parse and decode the X-PAYMENT header
 */
export function parsePaymentHeader(headerValue: string): PaymentHeader {
  try {
    const decoded = atob(headerValue)
    const parsed = JSON.parse(decoded) as PaymentHeader
    return parsed
  } catch (error) {
    throw new Error('Invalid payment header format')
  }
}

/**
 * Verify payment with the configured x402 facilitator.
 * This validates the signature without executing on-chain.
 */
export async function verifyPaymentWithFacilitator(
  paymentHeaderBase64: string,
  header: PaymentHeader,
  expectedAmount: number,
  expectedRecipient: string
): Promise<{ isValid: boolean; invalidReason?: string }> {
  const facilitatorUrl = getFacilitatorUrl()

  if (!facilitatorUrl) {
    return { isValid: false, invalidReason: 'METAMASK_X402_FACILITATOR_URL is not configured' }
  }

  const chainId = parseChainId(header.network)
  const network = chainId === 84532 ? 'base-sepolia' : `eip155:${chainId}`

  const verifyRequest = {
    x402Version: 1,
    paymentHeader: paymentHeaderBase64,
    paymentRequirements: {
      scheme: 'exact',
      network: network,
      payTo: expectedRecipient,
      asset: header.payload.asset,
      description: 'API access payment',
      mimeType: 'application/json',
      maxAmountRequired: expectedAmount.toString(),
      maxTimeoutSeconds: 300,
    },
  }

  try {
    const response = await fetch(`${facilitatorUrl}/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X402-Version': '1',
      },
      body: JSON.stringify(verifyRequest),
    })

    const result = await response.json()

    return {
      isValid: result.isValid === true,
      invalidReason: result.invalidReason,
    }
  } catch {
    return { isValid: false, invalidReason: 'Facilitator request failed' }
  }
}

/**
 * Settle payment with the configured x402 facilitator.
 * This actually executes the token transfer on-chain.
 * Should only be called AFTER the target API returns a successful response.
 */
export async function settlePayment(
  paymentHeaderBase64: string,
  header: PaymentHeader,
  expectedAmount: number,
  expectedRecipient: string
): Promise<{ txHash: string } | null> {
  const facilitatorUrl = getFacilitatorUrl()

  if (!facilitatorUrl) {
    return null
  }

  const chainId = parseChainId(header.network)
  const network = chainId === 84532 ? 'base-sepolia' : `eip155:${chainId}`

  const settlementRequest = {
    x402Version: 1,
    paymentHeader: paymentHeaderBase64,
    paymentRequirements: {
      scheme: 'exact',
      network: network,
      payTo: expectedRecipient,
      asset: header.payload.asset,
      description: 'API access payment',
      mimeType: 'application/json',
      maxAmountRequired: expectedAmount.toString(),
      maxTimeoutSeconds: 300,
    },
  }

  // First verify with facilitator to get detailed error if any
  const verifyResult = await verifyPaymentWithFacilitator(
    paymentHeaderBase64,
    header,
    expectedAmount,
    expectedRecipient
  )

  if (!verifyResult.isValid) {
    return null
  }

  try {
    const response = await fetch(`${facilitatorUrl}/settle`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X402-Version': '1',
      },
      body: JSON.stringify(settlementRequest),
    })

    const responseText = await response.text()

    if (!response.ok) {
      return null
    }

    const result = JSON.parse(responseText)

    if (result.event === 'payment.settled' && result.txHash) {
      return { txHash: result.txHash }
    }

    return null
  } catch {
    return null
  }
}

/**
 * Verify a payment from the X-PAYMENT header.
 *
 * @param headerValue - The base64-encoded X-PAYMENT header value
 * @param expectedAmount - The expected payment amount
 * @param expectedRecipient - The expected payment recipient
 * @returns Object with verified address and payment nonce if valid
 */
export async function verifyPayment(
  headerValue: string,
  expectedAmount: number,
  expectedRecipient: string
): Promise<{ address: Address; paymentNonce: string; paymentHeader: PaymentHeader } | null> {
  try {
    // Parse the payment header
    const header = parsePaymentHeader(headerValue)

    // Check x402 version
    if (header.x402Version !== 1) {
      return null
    }

    // Check scheme
    if (header.scheme !== 'exact') {
      return null
    }

    // Verify amount matches
    const paymentAmount = parseInt(header.payload.value, 10)
    if (paymentAmount < expectedAmount) {
      return null
    }

    // Verify recipient matches
    if (header.payload.to.toLowerCase() !== expectedRecipient.toLowerCase()) {
      return null
    }

    // Use EIP-3009 nonce for replay protection (unique per payment authorization)
    const paymentNonce = header.payload.nonce
    if (!paymentNonce) {
      return null
    }

    // Check for replay attack using the EIP-3009 nonce
    if (await paymentNonceRepository.isUsed(paymentNonce)) {
      return null
    }

    // Verify payment with the facilitator (not locally - let facilitator handle signature verification)
    const verifyResult = await verifyPaymentWithFacilitator(
      headerValue,
      header,
      expectedAmount,
      expectedRecipient
    )

    if (!verifyResult.isValid) {
      return null
    }

    // Return verification result with parsed header for later settlement
    return {
      address: header.payload.from as Address,
      paymentNonce,
      paymentHeader: header,
    }
  } catch {
    return null
  }
}

/**
 * Payment requirements structure per x402 spec
 * Returned in 402 response body
 */
export interface PaymentRequirements {
  scheme: string
  network: string
  payTo: string
  asset: string
  maxAmountRequired: string
  maxTimeoutSeconds: number
  description?: string
  mimeType?: string
}

/**
 * Build the x402 payment requirements for 402 response body.
 * Per x402 spec, these go in the response body, not headers.
 */
export function buildPaymentRequirements(details: PaymentDetails): PaymentRequirements {
  const network = details.chainId === 84532 ? 'base-sepolia' : `eip155:${details.chainId}`

  return {
    scheme: 'exact',
    network,
    payTo: details.recipient,
    asset: details.asset,
    maxAmountRequired: details.amount.toString(),
    maxTimeoutSeconds: details.maxTimeoutSeconds ?? 300,
    description: details.description,
    mimeType: details.mimeType,
  }
}

/**
 * Get the USDC token address for the chain.
 */
export function getUsdcAddress(chainId: number = defaultChainId): string {
  return getUsdcConfig(chainId).address
}

/**
 * Get the platform payment recipient address.
 */
export function getPaymentRecipient(): string {
  const recipient = process.env.PAYMENT_RECIPIENT_ADDRESS

  if (!recipient) {
    throw new Error('PAYMENT_RECIPIENT_ADDRESS is not configured')
  }

  return recipient
}
