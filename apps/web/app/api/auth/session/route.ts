import { NextRequest, NextResponse } from 'next/server'
import { createSession, destroySession, getCurrentUser } from '@/lib/auth/session'
import { isNonceValid, verifyNonce } from '@/lib/auth/nonce'
import { verifyMessage } from 'viem'
import { z } from 'zod'

const createSessionSchema = z.object({
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid wallet address'),
  nonce: z.string().min(1, 'Nonce is required'),
  message: z.string().min(1, 'Message is required'),
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/, 'Invalid signature'),
})

/**
 * POST /api/auth/session - Create a session after SIWX verification
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const result = createSessionSchema.safeParse(body)

    if (!result.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: result.error.flatten() },
        { status: 400 }
      )
    }

    const { walletAddress, nonce, message, signature } = result.data

    if (!message.includes(`Nonce: ${nonce}`)) {
      return NextResponse.json(
        { error: 'Sign-in message does not include the expected nonce' },
        { status: 401 }
      )
    }

    const nonceExists = await isNonceValid(nonce)
    if (!nonceExists) {
      return NextResponse.json(
        { error: 'Invalid or expired nonce' },
        { status: 401 }
      )
    }

    const signatureValid = await verifyMessage({
      address: walletAddress as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    })

    if (!signatureValid) {
      return NextResponse.json(
        { error: 'Invalid wallet signature' },
        { status: 401 }
      )
    }

    // Verify the nonce is valid (single-use)
    const isValid = await verifyNonce(nonce)
    if (!isValid) {
      return NextResponse.json(
        { error: 'Invalid or expired nonce' },
        { status: 401 }
      )
    }

    // Create the session
    const user = await createSession(walletAddress)

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        walletAddress: user.walletAddress,
      },
    })
  } catch (error) {
    console.error('[POST /api/auth/session] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/auth/session - Get current session
 */
export async function GET() {
  try {
    const user = await getCurrentUser()

    if (!user) {
      return NextResponse.json({ authenticated: false })
    }

    return NextResponse.json({
      authenticated: true,
      user: {
        id: user.id,
        walletAddress: user.walletAddress,
      },
    })
  } catch (error) {
    console.error('[GET /api/auth/session] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/auth/session - Destroy session (logout)
 */
export async function DELETE() {
  try {
    await destroySession()
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[DELETE /api/auth/session] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
