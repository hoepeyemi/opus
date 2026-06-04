'use client'

import { useState, useCallback, useMemo } from 'react'
import { useConnection } from 'wagmi'
import type { Address } from 'viem'
import { useUser } from '@/context/user'
import { getUsdceConfig, defaultChainId } from '@/config/tokens'
import {
  buildEIP3009Message,
  buildPaymentHeader,
  encodePaymentHeader,
} from '@/lib/x402/client'
import type { PaymentStatus } from './types'

interface UseSessionPaymentParams {
  /** Session ID to use for signing */
  sessionId: string
  /** Payment recipient address */
  recipient: Address
  /** Initial amount in USD */
  initialAmountUsd: number
}

export interface UseSessionPaymentReturn {
  status: PaymentStatus
  error: string | null
  txHash: string | null
  amount: string
  amountSmallestUnit: number
  isValidAmount: boolean
  setAmount: (amount: string) => void
  pay: () => Promise<void>
  reset: () => void
}

/**
 * Hook for handling x402 payments using session keys
 *
 * Similar to usePayment but instead of signing with the wallet,
 * it requests a signature from the server using the encrypted session key.
 *
 * Flow:
 * 1. Build EIP-3009 message (same as manual flow)
 * 2. POST to /api/sessions/[sessionId]/sign to get session signature
 * 3. Build payment header with 149-byte signature (sessionId + verifyingContract + structHash + ecdsaSig)
 * 4. POST to /api/pay/settle (same as manual flow)
 */
export function useSessionPayment(params: UseSessionPaymentParams): UseSessionPaymentReturn {
  const { sessionId, recipient, initialAmountUsd } = params

  const { session } = useUser()
  const { address, chainId } = useConnection()

  // State
  const [status, setStatus] = useState<PaymentStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [amount, setAmount] = useState(initialAmountUsd.toString())

  // Derived values
  const currentChainId = chainId || defaultChainId
  const usdceConfig = getUsdceConfig(currentChainId)
  const isAuthenticated = session?.isAuthenticated ?? false

  // Parse and validate amount
  const parsedAmount = parseFloat(amount)
  const isValidAmount = !isNaN(parsedAmount) && parsedAmount > 0 && parsedAmount <= 1_000_000
  const amountSmallestUnit = isValidAmount ? Math.round(parsedAmount * 1_000_000) : 0

  /**
   * Execute the payment using session key
   */
  const pay = useCallback(async () => {
    if (!address || !isAuthenticated || !isValidAmount || !sessionId) {
      setError('Cannot execute payment: wallet not connected, invalid amount, or no session')
      return
    }

    setStatus('signing')
    setError(null)
    setTxHash(null)

    try {
      // Build EIP-3009 message
      const message = buildEIP3009Message({
        from: address,
        to: recipient,
        value: BigInt(amountSmallestUnit),
        validitySeconds: 300, // 5 minutes
      })

      console.log('[SessionPay] Requesting session signature:', {
        sessionId,
        message: {
          ...message,
          value: message.value.toString(),
          validAfter: message.validAfter.toString(),
          validBefore: message.validBefore.toString(),
        },
      })

      // Request signature from server using session key
      const signResponse = await fetch(`/api/sessions/${sessionId}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: address,
          to: recipient,
          value: amountSmallestUnit.toString(),
          validAfter: Number(message.validAfter),
          validBefore: Number(message.validBefore),
          nonce: message.nonce,
          chainId: currentChainId,
          tokenAddress: usdceConfig.address,
        }),
      })

      if (!signResponse.ok) {
        const err = await signResponse.json()
        throw new Error(err.error || 'Failed to sign with session key')
      }

      const { signature } = await signResponse.json()
      console.log('[SessionPay] Session signature obtained, length:', signature.length)

      setStatus('submitting')

      // Build and encode payment header
      const paymentHeader = buildPaymentHeader({
        message,
        signature,
        asset: usdceConfig.address,
        chainId: currentChainId,
      })
      const paymentHeaderBase64 = encodePaymentHeader(paymentHeader)

      // Submit to facilitator via API route
      const response = await fetch('/api/pay/settle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentHeader: paymentHeaderBase64 }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Payment failed')
      }

      console.log('[SessionPay] Payment settled:', result)
      setTxHash(result.txHash)
      setStatus('success')
    } catch (err) {
      console.error('[SessionPay] Payment failed:', err)
      setError(err instanceof Error ? err.message : 'Payment failed')
      setStatus('error')
    }
  }, [
    address,
    isAuthenticated,
    isValidAmount,
    sessionId,
    recipient,
    amountSmallestUnit,
    currentChainId,
    usdceConfig,
  ])

  /**
   * Reset payment state for retry
   */
  const reset = useCallback(() => {
    setStatus('idle')
    setError(null)
    setTxHash(null)
  }, [])

  return useMemo(
    () => ({
      status,
      error,
      txHash,
      amount,
      amountSmallestUnit,
      isValidAmount,
      setAmount,
      pay,
      reset,
    }),
    [status, error, txHash, amount, amountSmallestUnit, isValidAmount, pay, reset]
  )
}
