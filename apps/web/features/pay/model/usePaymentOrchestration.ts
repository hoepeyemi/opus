'use client'

import { useState, useCallback, useMemo } from 'react'
import type { Address } from 'viem'
import { useConnection } from 'wagmi'
import { baseSepolia } from '@reown/appkit/networks'
import { useUser } from '@/context/user'
import { defaultChainId } from '@/config/tokens'
import { usePayment, useSessionPayment } from './index'
import { useSmartAccount, type SmartAccountStatus } from '@/features/smartAccount/model/useSmartAccount'
import { useSessions, type SessionInfo } from '@/features/sessionKeys/model'

export type PaymentMethod = 'session' | 'manual'

export interface UsePaymentOrchestrationParams {
  /** Resolved recipient address */
  recipient: Address
  /** Initial amount in USD */
  initialAmountUsd: number
  /** Initial amount in smallest unit */
  initialAmountSmallestUnit: number
}

export interface UsePaymentOrchestrationReturn {
  // Core payment interface
  isReady: boolean
  buttonText: string
  buttonDisabled: boolean
  handlePayment: () => Promise<void>
  paymentMethod: PaymentMethod

  // Payment state (delegated from underlying hooks)
  payment: ReturnType<typeof usePayment>

  // Session toggle
  useSession: boolean
  setUseSession: (value: boolean) => void
  canUseSession: boolean

  // Smart account state
  isSmartAccountEnabled: boolean
  smartAccountStatus: SmartAccountStatus

  // Session state
  activeSession: SessionInfo | undefined
  isLoadingSessions: boolean

  // Chain info
  chain: typeof baseSepolia
  explorerUrl: string

  // Processing state
  isProcessing: boolean
  isAuthenticated: boolean
}

/**
 * Hook that orchestrates payment method selection and execution.
 *
 * Manages the logic for:
 * - Choosing between session-based and manual wallet payments
 * - Smart account state coordination
 * - Button state computation
 * - Payment execution flow
 */
export function usePaymentOrchestration(
  params: UsePaymentOrchestrationParams
): UsePaymentOrchestrationReturn {
  const { recipient, initialAmountUsd, initialAmountSmallestUnit } = params

  const { session } = useUser()
  const { chainId } = useConnection()

  // Smart account and session state
  const {
    isEnabled: isSmartAccountEnabled,
    enable: enableSmartAccount,
    status: smartAccountStatus,
  } = useSmartAccount()
  const { sessions, isLoading: isLoadingSessions } = useSessions()
  const activeSession = sessions[0] // Use first active session

  // Session mode toggle - default to true if session key is available
  const canUseSession = isSmartAccountEnabled && !!activeSession
  const [useSession, setUseSession] = useState(canUseSession)

  // Manual payment hook (wallet signature)
  const manualPayment = usePayment({
    recipient,
    initialAmountUsd,
    initialAmountSmallestUnit,
  })

  // Session payment hook (server-side signature)
  const sessionPayment = useSessionPayment({
    sessionId: activeSession?.sessionId ?? '',
    recipient,
    initialAmountUsd,
  })

  // Use appropriate payment method based on toggle
  const payment = useSession && activeSession ? sessionPayment : manualPayment

  // Derived state
  const isAuthenticated = session?.isAuthenticated ?? false
  const currentChainId = chainId || defaultChainId
  const isProcessing = payment.status === 'signing' || payment.status === 'submitting'
  const chain = baseSepolia
  const explorerUrl = chain.blockExplorers?.default.url ?? 'https://sepolia.basescan.org'
  const paymentMethod: PaymentMethod = useSession && activeSession ? 'session' : 'manual'

  /**
   * Handle payment button click
   */
  const handlePayment = useCallback(async () => {
    if (!isAuthenticated) {
      // Caller should handle wallet connection
      return
    }

    // If session mode is enabled but smart account not enabled, enable it
    if (useSession && !isSmartAccountEnabled) {
      await enableSmartAccount()
      return
    }

    await payment.pay()
  }, [isAuthenticated, useSession, isSmartAccountEnabled, enableSmartAccount, payment])

  /**
   * Compute button text based on current state
   */
  const buttonText = useMemo(() => {
    if (smartAccountStatus === 'enabling') {
      return 'Enabling Smart Account...'
    }

    if (isProcessing) {
      return payment.status === 'signing'
        ? useSession
          ? 'Processing...'
          : 'Sign in Wallet...'
        : 'Submitting...'
    }

    if (!isAuthenticated) {
      return 'Connect Wallet'
    }

    if (useSession && !isSmartAccountEnabled) {
      return 'Enable Smart Account'
    }

    if (useSession && !activeSession && !isLoadingSessions) {
      return 'Create Session First'
    }

    const parsedAmount = parseFloat(payment.amount)
    const amountStr = payment.isValidAmount ? parsedAmount.toFixed(2) : '0.00'
    return useSession && activeSession ? `Pay $${amountStr} (Auto)` : `Pay $${amountStr}`
  }, [
    smartAccountStatus,
    isProcessing,
    payment.status,
    payment.amount,
    payment.isValidAmount,
    useSession,
    isAuthenticated,
    isSmartAccountEnabled,
    activeSession,
    isLoadingSessions,
  ])

  /**
   * Compute button disabled state
   */
  const buttonDisabled = useMemo(() => {
    return (
      (isAuthenticated && !payment.isValidAmount) ||
      isProcessing ||
      smartAccountStatus === 'enabling' ||
      (useSession && !activeSession && !isLoadingSessions && isSmartAccountEnabled)
    )
  }, [
    isAuthenticated,
    payment.isValidAmount,
    isProcessing,
    smartAccountStatus,
    useSession,
    activeSession,
    isLoadingSessions,
    isSmartAccountEnabled,
  ])

  /**
   * Determine if payment can proceed
   */
  const isReady = useMemo(() => {
    return isAuthenticated && payment.isValidAmount && !isProcessing
  }, [isAuthenticated, payment.isValidAmount, isProcessing])

  return useMemo(
    () => ({
      isReady,
      buttonText,
      buttonDisabled,
      handlePayment,
      paymentMethod,
      payment,
      useSession,
      setUseSession,
      canUseSession,
      isSmartAccountEnabled,
      smartAccountStatus,
      activeSession,
      isLoadingSessions,
      chain,
      explorerUrl,
      isProcessing,
      isAuthenticated,
    }),
    [
      isReady,
      buttonText,
      buttonDisabled,
      handlePayment,
      paymentMethod,
      payment,
      useSession,
      canUseSession,
      isSmartAccountEnabled,
      smartAccountStatus,
      activeSession,
      isLoadingSessions,
      chain,
      explorerUrl,
      isProcessing,
      isAuthenticated,
    ]
  )
}
