import {
  createPublicClient,
  http,
  hashTypedData,
  verifyTypedData,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem'
import type {
  PaymentHeader,
  PaymentPayload,
  PaymentRequirements,
  VerifyResult,
} from './types'
import { detectSignatureType } from './detect'
import { unwrapEIP6492 } from './unwrap'
import { getChainConfig, parseChainId } from './chains'
import { EIP3009_TYPES, buildUsdcDomain } from '@/lib/x402/client'
import { paymentNonceRepository } from '@/lib/repositories'

/**
 * EIP-1271 ABI for isValidSignature
 */
const IERC1271_ABI = [
  {
    name: 'isValidSignature',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'hash', type: 'bytes32' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [{ name: '', type: 'bytes4' }],
  },
] as const

/**
 * EIP-1271 magic value returned for valid signatures
 */
const EIP1271_MAGIC_VALUE = '0x1626ba7e'

/**
 * Parse and decode the X-PAYMENT header
 */
export function parsePaymentHeader(headerValue: string): PaymentHeader {
  try {
    const decoded = atob(headerValue)
    const parsed = JSON.parse(decoded) as PaymentHeader
    return parsed
  } catch {
    throw new Error('Invalid payment header format')
  }
}

/**
 * Build EIP-712 typed data hash for EIP-3009 TransferWithAuthorization
 */
function buildEIP3009Hash(payload: PaymentPayload, chainId: number): Hex {
  const domain = buildUsdcDomain(payload.asset, chainId)

  return hashTypedData({
    domain,
    types: EIP3009_TYPES,
    primaryType: 'TransferWithAuthorization',
    message: {
      from: payload.from,
      to: payload.to,
      value: BigInt(payload.value),
      validAfter: BigInt(payload.validAfter),
      validBefore: BigInt(payload.validBefore),
      nonce: payload.nonce,
    },
  })
}

/**
 * Verify a smart account signature using EIP-1271 isValidSignature
 */
async function verifySmartAccountSignature(
  publicClient: PublicClient,
  from: Address,
  hash: Hex,
  signature: Hex
): Promise<{ isValid: boolean; reason?: string }> {
  // Unwrap EIP-6492 to get inner signature
  const innerSignature = unwrapEIP6492(signature)

  try {
    const result = await publicClient.readContract({
      address: from,
      abi: IERC1271_ABI,
      functionName: 'isValidSignature',
      args: [hash, innerSignature],
    })

    const isValid = result === EIP1271_MAGIC_VALUE

    if (!isValid) {
      return {
        isValid: false,
        reason: `isValidSignature returned ${result}, expected ${EIP1271_MAGIC_VALUE}`,
      }
    }

    return { isValid: true }
  } catch (error) {
    return {
      isValid: false,
      reason: `isValidSignature call failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    }
  }
}

/**
 * Verify an EOA EIP-3009 TransferWithAuthorization signature locally.
 */
async function verifyEoaSignature(
  payload: PaymentPayload,
  chainId: number
): Promise<{ isValid: boolean; reason?: string }> {
  try {
    const isValid = await verifyTypedData({
      address: payload.from as Address,
      domain: buildUsdcDomain(payload.asset, chainId),
      types: EIP3009_TYPES,
      primaryType: 'TransferWithAuthorization',
      message: {
        from: payload.from,
        to: payload.to,
        value: BigInt(payload.value),
        validAfter: BigInt(payload.validAfter),
        validBefore: BigInt(payload.validBefore),
        nonce: payload.nonce,
      },
      signature: payload.signature as Hex,
    })

    return isValid
      ? { isValid: true }
      : { isValid: false, reason: 'EIP-3009 typed data signature did not match signer' }
  } catch (error) {
    return {
      isValid: false,
      reason: `EOA signature verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    }
  }
}

/**
 * Forward verification to the configured x402 facilitator.
 */
async function verifyWithOfficialFacilitator(
  facilitatorUrl: string,
  paymentHeaderBase64: string,
  paymentRequirements: PaymentRequirements
): Promise<VerifyResult> {
  const verifyRequest = {
    x402Version: 1,
    paymentHeader: paymentHeaderBase64,
    paymentRequirements,
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
      signatureType: 'eoa',
    }
  } catch {
    return {
      isValid: false,
      invalidReason: 'Facilitator request failed',
    }
  }
}

/**
 * Verify a payment signature
 *
 * - For EOA signatures: Forward to the configured x402 facilitator
 * - For smart account signatures: Verify locally via EIP-1271
 */
export async function verifyPayment(
  paymentHeaderBase64: string,
  expectedAmount: number,
  expectedRecipient: Address,
  paymentRequirementsOverride?: Partial<PaymentRequirements>
): Promise<{
  address: Address
  paymentNonce: Hex
  paymentHeader: PaymentHeader
  signatureType: 'eoa' | 'smart_account'
} | null> {
  try {
    // Parse the payment header
    const header = parsePaymentHeader(paymentHeaderBase64)

    // Check x402 version
    if (header.x402Version !== 1) {
      console.warn('[Facilitator] Payment verification failed: unsupported x402 version', header.x402Version)
      return null
    }

    // Check scheme
    if (header.scheme !== 'exact') {
      console.warn('[Facilitator] Payment verification failed: unsupported scheme', header.scheme)
      return null
    }

    // Verify amount matches
    const paymentAmount = parseInt(header.payload.value, 10)
    if (paymentAmount < expectedAmount) {
      console.warn('[Facilitator] Payment verification failed: amount too small', {
        paymentAmount,
        expectedAmount,
      })
      return null
    }

    // Verify recipient matches
    if (header.payload.to.toLowerCase() !== expectedRecipient.toLowerCase()) {
      console.warn('[Facilitator] Payment verification failed: recipient mismatch', {
        received: header.payload.to,
        expected: expectedRecipient,
      })
      return null
    }

    // Check for replay attack
    const paymentNonce = header.payload.nonce
    if (!paymentNonce) {
      console.warn('[Facilitator] Payment verification failed: missing nonce')
      return null
    }

    if (await paymentNonceRepository.isUsed(paymentNonce)) {
      console.warn('[Facilitator] Payment verification failed: nonce already used', paymentNonce)
      return null
    }

    // Detect signature type
    const signatureType = detectSignatureType(header.payload.signature as Hex)
    const chainId = parseChainId(header.network)
    const chainConfig = getChainConfig(chainId)

    if (!chainConfig) {
      console.warn('[Facilitator] Payment verification failed: unsupported chain', {
        network: header.network,
        chainId,
      })
      return null
    }

    const now = Math.floor(Date.now() / 1000)
    if (header.payload.validAfter > now) {
      console.warn('[Facilitator] Payment verification failed: authorization not valid yet', {
        validAfter: header.payload.validAfter,
        now,
      })
      return null
    }

    if (header.payload.validBefore <= now) {
      console.warn('[Facilitator] Payment verification failed: authorization expired', {
        validBefore: header.payload.validBefore,
        now,
      })
      return null
    }

    let verifyResult: VerifyResult

    if (signatureType === 'eoa') {
      const localResult = await verifyEoaSignature(header.payload, chainId)
      verifyResult = {
        isValid: localResult.isValid,
        invalidReason: localResult.reason,
        signatureType: 'eoa',
      }

      // If local verification fails, try the configured official facilitator as
      // a fallback. This keeps compatibility with facilitator-specific header
      // behavior while letting standard EIP-3009 signatures pass locally.
      if (!verifyResult.isValid && chainConfig.officialFacilitatorUrl) {
        console.warn('[Facilitator] Local EOA verification failed, trying official facilitator:', verifyResult.invalidReason)

        const paymentRequirements: PaymentRequirements = {
          scheme: 'exact',
          network: chainConfig.name,
          payTo: expectedRecipient,
          asset: header.payload.asset as Address,
          maxAmountRequired: expectedAmount.toString(),
          maxTimeoutSeconds: 300,
          description: 'API access payment',
          mimeType: 'application/json',
          ...paymentRequirementsOverride,
        }

        verifyResult = await verifyWithOfficialFacilitator(
          chainConfig.officialFacilitatorUrl,
          paymentHeaderBase64,
          paymentRequirements
        )
      }
    } else {
      // Verify smart account signature locally via EIP-1271
      const publicClient = createPublicClient({
        transport: http(chainConfig.rpcUrl),
      })

      const hash = buildEIP3009Hash(header.payload, chainId)
      const result = await verifySmartAccountSignature(
        publicClient,
        header.payload.from as Address,
        hash,
        header.payload.signature as Hex
      )

      verifyResult = {
        isValid: result.isValid,
        invalidReason: result.reason,
        signatureType: 'smart_account',
      }
    }

    if (!verifyResult.isValid) {
      console.warn('[Facilitator] Payment verification failed:', verifyResult.invalidReason ?? 'Unknown reason')
      return null
    }

    return {
      address: header.payload.from as Address,
      paymentNonce,
      paymentHeader: header,
      signatureType,
    }
  } catch (error) {
    console.error('[Facilitator] Payment verification error:', error)
    return null
  }
}
