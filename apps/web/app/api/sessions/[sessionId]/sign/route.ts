import { NextResponse } from 'next/server'
import { db, sessionKeys } from '@/lib/db'
import { eq, and } from 'drizzle-orm'
import { withAuth } from '@/lib/auth'
import { decryptHybrid } from '@/lib/crypto/encryption'
import { privateKeyToAccount } from 'viem/accounts'
import { type Hex, type Address } from 'viem'
import { isContractApproved } from '@/lib/sessionKeys/flattenScopes'
import { deserializeScope, type SerializedSessionScope } from '@/lib/sessionKeys/types'
import {
  computeTransferWithAuthorizationStructHash,
  buildAgentDelegatorDomain,
  buildSessionSignature,
  SESSION_SIGNATURE_TYPES,
} from '@x402/payment'

/**
 * POST /api/sessions/[sessionId]/sign - Sign an EIP-3009 payment with session key
 *
 * This endpoint:
 * 1. Verifies the session belongs to the authenticated user
 * 2. Verifies the session is active and not expired
 * 3. Verifies the tokenAddress is in the session's approvedContracts
 * 4. Decrypts the session key's private key
 * 5. Computes structHash = keccak256(abi.encode(TYPE_HASH, message params))
 * 6. Signs EIP-712 typed data: SessionSignature(verifyingContract, structHash)
 * 7. Returns a 149-byte signature: sessionId (32) + tokenAddress (20) + structHash (32) + ecdsaSig (65)
 *
 * The 149-byte signature format allows on-chain preimage verification:
 * - Contract can verify hash == keccak256("\x19\x01" || domainSeparator || structHash)
 * - This proves the signature is bound to this specific contract's domain
 */
export const POST = withAuth(async (user, request, context) => {
  const { sessionId } = await context.params
  const body = await request.json()

  const {
    from,
    to,
    value,
    validAfter,
    validBefore,
    nonce,
    chainId,
    tokenAddress,
  } = body

  // Validate required fields
  if (!from || !/^0x[0-9a-f]{40}$/i.test(from)) {
    return NextResponse.json({ error: 'Invalid from address' }, { status: 400 })
  }
  if (!to || !/^0x[0-9a-f]{40}$/i.test(to)) {
    return NextResponse.json({ error: 'Invalid to address' }, { status: 400 })
  }
  if (!value || typeof value !== 'string') {
    return NextResponse.json({ error: 'Invalid value' }, { status: 400 })
  }
  if (typeof validAfter !== 'number' || typeof validBefore !== 'number') {
    return NextResponse.json({ error: 'Invalid validAfter/validBefore' }, { status: 400 })
  }
  if (!nonce || !/^0x[0-9a-f]{64}$/i.test(nonce)) {
    return NextResponse.json({ error: 'Invalid nonce - must be bytes32 hex' }, { status: 400 })
  }
  if (typeof chainId !== 'number') {
    return NextResponse.json({ error: 'Invalid chainId' }, { status: 400 })
  }
  if (!tokenAddress || !/^0x[0-9a-f]{40}$/i.test(tokenAddress)) {
    return NextResponse.json({ error: 'Invalid tokenAddress' }, { status: 400 })
  }

  // Find the session and verify ownership
  const session = await db.query.sessionKeys.findFirst({
    where: and(
      eq(sessionKeys.sessionId, sessionId.toLowerCase()),
      eq(sessionKeys.userId, user.id),
      eq(sessionKeys.isActive, true)
    ),
  })

  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  // Verify session is still valid
  const now = new Date()
  if (now < session.validAfter) {
    return NextResponse.json({ error: 'Session not yet active' }, { status: 400 })
  }
  if (now > session.validUntil) {
    return NextResponse.json({ error: 'Session expired' }, { status: 400 })
  }

  // Verify from address matches user's wallet
  if (from.toLowerCase() !== user.walletAddress.toLowerCase()) {
    return NextResponse.json({ error: 'From address must match authenticated wallet' }, { status: 403 })
  }

  // Verify tokenAddress is approved for this session
  // First check new scopes format, then fall back to legacy approvedContracts
  let isApproved = false
  let matchedScopeName: string | undefined

  const sessionScopes = session.scopes as SerializedSessionScope[] | undefined
  if (sessionScopes && sessionScopes.length > 0) {
    // New format: check scopes
    const deserializedScopes = sessionScopes.map(deserializeScope)
    const result = isContractApproved(deserializedScopes, tokenAddress.toLowerCase() as Address)
    isApproved = result.approved
    matchedScopeName = result.scope?.name
  } else {
    // Legacy format: check approvedContracts directly
    const approvedContracts = session.approvedContracts || []
    isApproved = approvedContracts.some(
      (c: { address: string }) => c.address.toLowerCase() === tokenAddress.toLowerCase()
    )
  }

  if (!isApproved) {
    // Build list of approved contracts for error message
    const approvedList: string[] = []
    if (sessionScopes && sessionScopes.length > 0) {
      for (const scope of sessionScopes) {
        if (scope.type === 'eip712' && scope.approvedContracts) {
          for (const contract of scope.approvedContracts) {
            approvedList.push(contract.address)
          }
        }
      }
    } else if (session.approvedContracts) {
      for (const c of session.approvedContracts) {
        approvedList.push(c.address)
      }
    }

    return NextResponse.json({
      error: 'Token contract not approved for this session',
      approvedContracts: approvedList,
      availableScopes: sessionScopes?.map(s => ({ id: s.id, type: s.type, name: s.name })),
    }, { status: 403 })
  }

  try {
    // Decrypt the session key private key
    const decrypted = decryptHybrid(session.encryptedPrivateKey)
    const privateKey = decrypted.privateKey as Hex

    // Verify we got the right key
    const account = privateKeyToAccount(privateKey)
    if (account.address.toLowerCase() !== session.sessionKeyAddress.toLowerCase()) {
      return NextResponse.json({ error: 'Session key mismatch' }, { status: 500 })
    }

    // Build the message for structHash computation
    const message = {
      from: from as `0x${string}`,
      to: to as `0x${string}`,
      value: BigInt(value),
      validAfter: BigInt(validAfter),
      validBefore: BigInt(validBefore),
      nonce: nonce as `0x${string}`,
    }

    // Step 1: Compute the structHash for TransferWithAuthorization
    // This is the inner hash that will be used for preimage verification on-chain
    const structHash = computeTransferWithAuthorizationStructHash(message)

    // Step 2: Build AgentDelegator EIP-712 domain (verifyingContract = user's wallet)
    const delegatorDomain = buildAgentDelegatorDomain(from as Address, chainId)

    // Step 3: Sign EIP-712 typed data: SessionSignature(verifyingContract, structHash)
    // This properly binds the session signature to the target contract using EIP-712
    const ecdsaSignature = await account.signTypedData({
      domain: delegatorDomain,
      types: SESSION_SIGNATURE_TYPES,
      primaryType: 'SessionSignature',
      message: {
        verifyingContract: tokenAddress as Address,
        structHash,
      },
    })

    // Step 4: Build 149-byte signature using shared utility
    const signature = buildSessionSignature({
      sessionId: session.sessionId as Hex,
      verifyingContract: tokenAddress as Address,
      structHash,
      ecdsaSignature,
    })

    return NextResponse.json({ signature })
  } catch {
    return NextResponse.json({ error: 'Failed to sign' }, { status: 500 })
  }
})
