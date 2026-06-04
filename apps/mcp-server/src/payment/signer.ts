import {
  createPrivateKey,
  privateDecrypt,
  createDecipheriv,
  constants,
  KeyObject,
} from 'crypto'
import { type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import type { SessionKey, ApiProxy } from '../db/client.js'
import {
  computeTransferWithAuthorizationStructHash,
  buildAgentDelegatorDomain,
  buildSessionSignature,
  buildPaymentHeader,
  encodePaymentHeader,
  generateNonce,
  getUsdceAddress,
  SESSION_SIGNATURE_TYPES,
} from '@x402/payment'

// Constants
const AES_ALGORITHM = 'aes-256-gcm'

/**
 * Hybrid encrypted data structure from the web app
 */
interface HybridEncryptedData {
  encryptedKey: string
  iv: string
  ciphertext: string
  tag: string
}

// Cache server private key
let serverPrivateKey: KeyObject | null = null

/**
 * Normalize PEM key from environment variable
 */
function normalizePem(pem: string): string {
  return pem.replace(/\\n/g, '\n')
}

/**
 * Get the server's RSA private key for decrypting session keys
 */
function getServerPrivateKey(): KeyObject {
  if (serverPrivateKey) return serverPrivateKey

  const privateKeyPem = process.env.SERVER_PRIVATE_KEY
  if (!privateKeyPem) {
    throw new Error('SERVER_PRIVATE_KEY environment variable is not set')
  }

  serverPrivateKey = createPrivateKey(normalizePem(privateKeyPem))
  return serverPrivateKey
}

/**
 * Decrypt hybrid encrypted data (session key private key)
 */
function decryptHybrid(encrypted: HybridEncryptedData): string {
  const privateKey = getServerPrivateKey()

  // Decrypt the AES key with RSA-OAEP
  const encryptedKeyBuffer = Buffer.from(encrypted.encryptedKey, 'base64')
  const aesKey = privateDecrypt(
    {
      key: privateKey,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    encryptedKeyBuffer
  )

  // Decrypt the data with AES-GCM
  const iv = Buffer.from(encrypted.iv, 'base64')
  const ciphertext = Buffer.from(encrypted.ciphertext, 'base64')
  const tag = Buffer.from(encrypted.tag, 'base64')

  const decipher = createDecipheriv(AES_ALGORITHM, aesKey, iv)
  decipher.setAuthTag(tag)

  let plaintext = decipher.update(ciphertext, undefined, 'utf8')
  plaintext += decipher.final('utf8')

  return plaintext
}

/**
 * Decrypt a session key's private key
 */
export function decryptSessionKey(encryptedPrivateKey: HybridEncryptedData): Hex {
  const decrypted = decryptHybrid(encryptedPrivateKey)
  // The decrypted data is JSON: {"privateKey":"0x..."}
  const parsed = JSON.parse(decrypted) as { privateKey: string }
  return parsed.privateKey as Hex
}

/**
 * Sign an x402 payment using a session key
 *
 * Creates a 149-byte signature in the format:
 * sessionId (32) + verifyingContract (20) + structHash (32) + ecdsaSignature (65)
 */
export async function signPayment(params: {
  session: SessionKey
  ownerAddress: Address
  recipientAddress: Address
  amount: bigint
  chainId: number
}): Promise<string> {
  const { session, ownerAddress, recipientAddress, amount, chainId } = params

  console.log('[SignPayment] Starting with params:', {
    sessionId: session.sessionId,
    sessionKeyAddress: session.sessionKeyAddress,
    ownerAddress,
    recipientAddress,
    amount: amount.toString(),
    chainId,
    approvedContracts: session.approvedContracts,
  })

  // Decrypt the session key's private key
  const privateKey = decryptSessionKey(session.encryptedPrivateKey as HybridEncryptedData)
  const sessionAccount = privateKeyToAccount(privateKey)

  console.log('[SignPayment] Session account address:', sessionAccount.address)

  const usdceAddress = getUsdceAddress(chainId)
  const nonce = generateNonce()
  const validAfter = 0n
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 300) // 5 minutes validity

  // Build the EIP-3009 message
  const message = {
    from: ownerAddress,
    to: recipientAddress,
    value: amount,
    validAfter,
    validBefore,
    nonce,
  }

  // Get the struct hash for EIP-3009 TransferWithAuthorization
  const structHash = computeTransferWithAuthorizationStructHash(message)

  // Build the SessionSignature message that the session key will sign
  const sessionSignatureMessage = {
    verifyingContract: usdceAddress,
    structHash,
  }

  // Sign with the session key using the AgentDelegator domain
  const ecdsaSignature = await sessionAccount.signTypedData({
    domain: buildAgentDelegatorDomain(ownerAddress, chainId),
    types: SESSION_SIGNATURE_TYPES,
    primaryType: 'SessionSignature',
    message: sessionSignatureMessage,
  })

  // Build the 149-byte signature
  const fullSignature = buildSessionSignature({
    sessionId: session.sessionId as Hex,
    verifyingContract: usdceAddress,
    structHash,
    ecdsaSignature,
  })

  console.log('[SignPayment] Full signature length:', (fullSignature.length - 2) / 2, 'bytes')

  // Build and encode the payment header
  const paymentHeader = buildPaymentHeader({
    message,
    signature: fullSignature,
    asset: usdceAddress,
    chainId,
  })

  return encodePaymentHeader(paymentHeader)
}

/**
 * Build payment for a proxy request
 */
export async function buildPaymentForProxy(
  session: SessionKey,
  proxy: ApiProxy,
  chainId: number
): Promise<string> {
  const { db, users } = await import('../db/client.js')
  const { eq } = await import('drizzle-orm')

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.userId),
  })

  if (!user) {
    throw new Error('User not found for session')
  }

  return signPayment({
    session,
    ownerAddress: user.walletAddress as Address,
    recipientAddress: proxy.paymentAddress as Address,
    amount: BigInt(proxy.pricePerRequest),
    chainId,
  })
}
