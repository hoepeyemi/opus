import { NextRequest, NextResponse } from 'next/server'
import type { Address } from 'viem'
import {
  parsePaymentHeader,
  verifyPayment,
  settlePayment,
  parseChainId,
  getChainConfig,
} from '@/lib/facilitator'
import { paymentNonceRepository } from '@/lib/repositories'

/**
 * POST /api/facilitator/settle
 *
 * Settle an x402 payment (execute the transfer on-chain).
 * - For EOA signatures: Forwards to official Cronos facilitator
 * - For smart account signatures: Executes transferWithAuthorization directly
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
 *   event: 'payment.settled',
 *   txHash: Hex,
 * }
 *
 * Or on error:
 * {
 *   error: string,
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    const { x402Version, paymentHeader: paymentHeaderBase64, paymentRequirements } = body

    // Validate request
    if (x402Version !== 1) {
      return NextResponse.json(
        { error: 'Unsupported x402 version' },
        { status: 400 }
      )
    }

    if (!paymentHeaderBase64 || !paymentRequirements) {
      return NextResponse.json(
        { error: 'Missing paymentHeader or paymentRequirements' },
        { status: 400 }
      )
    }

    // Parse payment header
    const header = parsePaymentHeader(paymentHeaderBase64)
    const chainId = parseChainId(header.network)
    const chainConfig = getChainConfig(chainId)

    if (!chainConfig) {
      return NextResponse.json(
        { error: `Unsupported chain: ${chainId}` },
        { status: 400 }
      )
    }

    // Extract expected values from requirements
    const expectedAmount = parseInt(paymentRequirements.maxAmountRequired, 10)
    const expectedRecipient = paymentRequirements.payTo as Address

    // First verify the payment (this also checks nonce)
    const verifyResult = await verifyPayment(
      paymentHeaderBase64,
      expectedAmount,
      expectedRecipient
    )

    if (!verifyResult) {
      return NextResponse.json(
        { error: 'Payment verification failed' },
        { status: 402 }
      )
    }

    // Settle the payment
    const settleResult = await settlePayment(
      paymentHeaderBase64,
      header,
      expectedAmount,
      expectedRecipient
    )

    if (!settleResult) {
      return NextResponse.json(
        { error: 'Payment settlement failed' },
        { status: 500 }
      )
    }

    // Mark nonce as used after successful settlement
    await paymentNonceRepository.consume(verifyResult.paymentNonce)

    return NextResponse.json({
      event: 'payment.settled',
      txHash: settleResult.txHash,
      signatureType: verifyResult.signatureType,
    })
  } catch (error) {
    console.error('[Facilitator API] Settle error:', error)

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
