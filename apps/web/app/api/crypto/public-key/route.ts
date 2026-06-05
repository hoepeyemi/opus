import { NextResponse } from 'next/server'
import { getServerPublicKeyPem } from '@/lib/crypto/encryption'

/**
 * GET /api/crypto/public-key
 * Returns the server's RSA public key for client-side encryption.
 */
export async function GET() {
  try {
    const publicKey = getServerPublicKeyPem()

    return NextResponse.json({
      publicKey,
      algorithm: 'RSA-OAEP',
      hash: 'SHA-256',
    })
  } catch (error) {
    console.error('[GET /api/crypto/public-key] Error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'

    return NextResponse.json(
      {
        error: 'Server encryption not configured',
        message,
        setup:
          'Run `pnpm generate-keys` in apps/web, copy SERVER_PUBLIC_KEY and SERVER_PRIVATE_KEY into apps/web/.env.local, then restart the Next.js server.',
      },
      { status: 500 }
    )
  }
}
