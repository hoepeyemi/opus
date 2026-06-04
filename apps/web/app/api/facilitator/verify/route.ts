import { NextRequest, NextResponse } from 'next/server'
import type { Address } from 'viem'
import {
  parsePaymentHeader,
  verifyPayment,
  parseChainId,
  getChainConfig,
} from '@/lib/facilitator'

/**
 * POST /api/facilitator/verify
 *
 * Verify an x402 payment signature.
 * - For EOA signatures: Forwards to official Cronos facilitator
 * - For smart account signatures: Verifies via EIP-1271 isValidSignature()
 *
 * Request body:
 * {
 *   x402Version: 1,
 *   paymentHeader: string (base64),
 *   paymentRequirements: {
 *     scheme: 'exact',
 *     network: 'cronos-mainnet' | 'cronos-testnet',
 *     payTo: Address,
 *     asset: Address,
 *     maxAmountRequired: string,
 *     maxTimeoutSeconds: number,
 *     description?: string,
 *     mimeType?: string,
 *   }
 * }
 *
 * Response:
 * {
 *   isValid: boolean,
 *   invalidReason?: string,
 *   signatureType?: 'eoa' | 'smart_account',
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    const { x402Version, paymentHeader: paymentHeaderBase64, paymentRequirements } = body

    // Validate request
    if (x402Version !== 1) {
      return NextResponse.json(
        { isValid: false, invalidReason: 'Unsupported x402 version' },
        { status: 400 }
      )
    }

    if (!paymentHeaderBase64 || !paymentRequirements) {
      return NextResponse.json(
        { isValid: false, invalidReason: 'Missing paymentHeader or paymentRequirements' },
        { status: 400 }
      )
    }

    // Parse payment header to get amount and recipient
    const header = parsePaymentHeader(paymentHeaderBase64)
    const chainId = parseChainId(header.network)
    const chainConfig = getChainConfig(chainId)

    if (!chainConfig) {
      return NextResponse.json(
        { isValid: false, invalidReason: `Unsupported chain: ${chainId}` },
        { status: 400 }
      )
    }

    // Extract expected values from requirements
    const expectedAmount = parseInt(paymentRequirements.maxAmountRequired, 10)
    const expectedRecipient = paymentRequirements.payTo as Address

    // Verify the payment
    const result = await verifyPayment(
      paymentHeaderBase64,
      expectedAmount,
      expectedRecipient
    )

    if (!result) {
      return NextResponse.json({
        isValid: false,
        invalidReason: 'Payment verification failed',
      })
    }

    return NextResponse.json({
      isValid: true,
      signatureType: result.signatureType,
    })
  } catch (error) {
    console.error('[Facilitator API] Verify error:', error)

    return NextResponse.json(
      {
        isValid: false,
        invalidReason: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    )
  }
}
