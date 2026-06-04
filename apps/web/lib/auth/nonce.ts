import { siwxNonceRepository } from '@/lib/repositories'
import { closeRedisClient } from '@/lib/redis'
import { randomUUID } from 'crypto'

/**
 * SIWX Authentication Nonce Management
 *
 * Thin wrapper around the nonce repository for backward compatibility
 * and to provide a clear API for authentication flows.
 */

const LOCAL_NONCE_TTL_MS = 5 * 60 * 1000
const localNonces = new Map<string, number>()

function useLocalNonceFallback(): boolean {
  return process.env.NODE_ENV !== 'production'
}

function pruneExpiredLocalNonces(): void {
  const now = Date.now()

  for (const [nonce, expiresAt] of localNonces.entries()) {
    if (expiresAt <= now) {
      localNonces.delete(nonce)
    }
  }
}

function generateLocalNonce(): string {
  pruneExpiredLocalNonces()

  const nonce = randomUUID()
  localNonces.set(nonce, Date.now() + LOCAL_NONCE_TTL_MS)

  return nonce
}

function consumeLocalNonce(nonce: string): boolean {
  pruneExpiredLocalNonces()

  const expiresAt = localNonces.get(nonce)
  if (!expiresAt || expiresAt <= Date.now()) {
    localNonces.delete(nonce)
    return false
  }

  localNonces.delete(nonce)
  return true
}

/**
 * Generate a new nonce for SIWX authentication.
 * Nonces expire after 5 minutes.
 */
export async function generateNonce(): Promise<string> {
  try {
    return await siwxNonceRepository.generate()
  } catch (error) {
    if (!useLocalNonceFallback()) throw error

    console.warn('[Auth] Redis unavailable; using in-memory SIWX nonce fallback')
    return generateLocalNonce()
  }
}

/**
 * Verify and consume a nonce.
 * Returns true if the nonce is valid and unused, false otherwise.
 * A nonce can only be used once (atomic operation).
 */
export async function verifyNonce(nonce: string): Promise<boolean> {
  try {
    return await siwxNonceRepository.consume(nonce)
  } catch (error) {
    if (!useLocalNonceFallback()) throw error

    console.warn('[Auth] Redis unavailable; verifying SIWX nonce from in-memory fallback')
    return consumeLocalNonce(nonce)
  }
}

/**
 * Check if a nonce exists and is valid (without consuming it).
 * Useful for validation before signature verification.
 */
export async function isNonceValid(nonce: string): Promise<boolean> {
  try {
    return await siwxNonceRepository.isValid(nonce)
  } catch (error) {
    if (!useLocalNonceFallback()) throw error

    pruneExpiredLocalNonces()
    return localNonces.has(nonce)
  }
}

/**
 * Get the number of active nonces (for monitoring/debugging).
 */
export async function getActiveNonceCount(): Promise<number> {
  try {
    return await siwxNonceRepository.countActive()
  } catch (error) {
    if (!useLocalNonceFallback()) throw error

    pruneExpiredLocalNonces()
    return localNonces.size
  }
}

/**
 * Close the Redis connection (for graceful shutdown).
 */
export { closeRedisClient as closeRedisConnection }
