import { NextRequest, NextResponse } from 'next/server'
import { parsePaymentHeader, settlePayment } from '@/lib/x402'

/**
 * POST /api/pay/settle - Submit payment for settlement via x402 facilitator
 *
 * This endpoint receives a signed EIP-3009 payment authorization and
 * submits it to the Cronos x402 facilitator for on-chain settlement.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { paymentHeader: paymentHeaderBase64 } = body

    if (!paymentHeaderBase64 || typeof paymentHeaderBase64 !== 'string') {
      return NextResponse.json(
        { error: 'Missing payment header' },
        { status: 400 }
      )
    }

    // Parse the payment header
    let header
    try {
      header = parsePaymentHeader(paymentHeaderBase64)
    } catch {
      return NextResponse.json(
        { error: 'Invalid payment header format' },
        { status: 400 }
      )
    }

    // Validate header structure
    if (!header.payload?.to || !header.payload?.value || !header.payload?.asset) {
      return NextResponse.json(
        { error: 'Invalid payment header: missing required fields' },
        { status: 400 }
      )
    }

    const amount = parseInt(header.payload.value, 10)
    if (isNaN(amount) || amount <= 0) {
      return NextResponse.json(
        { error: 'Invalid payment amount' },
        { status: 400 }
      )
    }

    console.log('[POST /api/pay/settle] Settling payment:', {
      to: header.payload.to,
      amount,
      asset: header.payload.asset,
      network: header.network,
    })

    // Settle the payment with the x402 facilitator
    const result = await settlePayment(
      paymentHeaderBase64,
      header,
      amount,
      header.payload.to
    )

    if (!result) {
      return NextResponse.json(
        { error: 'Payment settlement failed. Please check your USDC.E balance and try again.' },
        { status: 500 }
      )
    }

    console.log('[POST /api/pay/settle] Payment settled successfully:', result.txHash)

    return NextResponse.json({
      success: true,
      txHash: result.txHash,
    })
  } catch (error) {
    console.error('[POST /api/pay/settle] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
