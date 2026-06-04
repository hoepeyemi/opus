'use client'

import { useState, useCallback, useMemo } from 'react'
import { useSignTypedData, useConnection } from 'wagmi'
import type { Address } from 'viem'
import { useUser } from '@/context/user'
import { getUsdceConfig, defaultChainId } from '@/config/tokens'
import {
  EIP3009_TYPES,
  buildUsdceDomain,
  buildEIP3009Message,
  buildPaymentHeader,
  encodePaymentHeader,
} from '@/lib/x402/client'
import type { PaymentParams, PaymentStatus, UsePaymentReturn } from './types'

/**
 * Hook for handling direct x402 payments
 *
 * Manages payment state, amount editing, EIP-3009 signing,
 * and settlement via the facilitator API.
 */
export function usePayment(params: PaymentParams): UsePaymentReturn {
  const { recipient, initialAmountUsd } = params

  const { session } = useUser()
  const { address, chainId } = useConnection()
  const { mutateAsync: signTypedData } = useSignTypedData()

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
   * Execute the payment
   */
  const pay = useCallback(async () => {
    if (!address || !isAuthenticated || !isValidAmount) {
      setError('Cannot execute payment: wallet not connected or invalid amount')
      return
    }

    setStatus('signing')
    setError(null)
    setTxHash(null)

    try {
      // Build EIP-712 domain for USDC.E
      const domain = buildUsdceDomain(usdceConfig.address, currentChainId)

      // Build EIP-3009 message
      const message = buildEIP3009Message({
        from: address,
        to: recipient,
        value: BigInt(amountSmallestUnit),
        validitySeconds: 300, // 5 minutes
      })

      console.log('[Pay] Signing payment:', {
        domain,
        message: {
          ...message,
          value: message.value.toString(),
          validAfter: message.validAfter.toString(),
          validBefore: message.validBefore.toString(),
        },
      })

      // Sign the EIP-3009 authorization
      const signature = await signTypedData({
        domain,
        types: EIP3009_TYPES,
        primaryType: 'TransferWithAuthorization',
        message,
      })

      console.log('[Pay] Signature obtained:', signature)
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

      console.log('[Pay] Payment settled:', result)
      setTxHash(result.txHash)
      setStatus('success')
    } catch (err) {
      console.error('[Pay] Payment failed:', err)
      setError(err instanceof Error ? err.message : 'Payment failed')
      setStatus('error')
    }
  }, [
    address,
    isAuthenticated,
    isValidAmount,
    recipient,
    amountSmallestUnit,
    currentChainId,
    usdceConfig,
    signTypedData,
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
