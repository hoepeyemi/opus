import {
  createPublicClient,
  http,
  hashTypedData,
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
import { EIP3009_TYPES, buildUsdceDomain } from '@/lib/x402/client'
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
  const domain = buildUsdceDomain(payload.asset, chainId)

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
 * Forward verification to the official Cronos facilitator
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
 * - For EOA signatures: Forward to official Cronos facilitator
 * - For smart account signatures: Verify locally via EIP-1271
 */
export async function verifyPayment(
  paymentHeaderBase64: string,
  expectedAmount: number,
  expectedRecipient: Address
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

    // Check for replay attack
    const paymentNonce = header.payload.nonce
    if (!paymentNonce) {
      return null
    }

    if (await paymentNonceRepository.isUsed(paymentNonce)) {
      return null
    }

    // Detect signature type
    const signatureType = detectSignatureType(header.payload.signature as Hex)
    const chainId = parseChainId(header.network)
    const chainConfig = getChainConfig(chainId)

    if (!chainConfig) {
      return null
    }

    let verifyResult: VerifyResult

    if (signatureType === 'eoa' && chainConfig.officialFacilitatorUrl) {
      // Forward EOA signatures to official facilitator
      const paymentRequirements: PaymentRequirements = {
        scheme: 'exact',
        network: chainConfig.name,
        payTo: expectedRecipient,
        asset: header.payload.asset as Address,
        maxAmountRequired: expectedAmount.toString(),
        maxTimeoutSeconds: 300,
        description: 'API access payment',
        mimeType: 'application/json',
      }

      verifyResult = await verifyWithOfficialFacilitator(
        chainConfig.officialFacilitatorUrl,
        paymentHeaderBase64,
        paymentRequirements
      )
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
      return null
    }

    return {
      address: header.payload.from as Address,
      paymentNonce,
      paymentHeader: header,
      signatureType,
    }
  } catch {
    return null
  }
}
