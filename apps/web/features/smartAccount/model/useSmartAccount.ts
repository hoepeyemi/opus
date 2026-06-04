'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import { useWalletClient, usePublicClient } from 'wagmi'
import { useConnection } from 'wagmi'
import { isAgentDelegatorDeployed, getAgentDelegatorAddress } from '@x402/contracts'
import { checkDelegation, getDelegationTarget, enableSmartAccount, type EnableSmartAccountError } from '@/lib/smartAccount'

export type SmartAccountStatus =
  | 'checking'
  | 'not_enabled'
  | 'enabling'
  | 'enabled'
  | 'error'
  | 'unsupported' // Chain doesn't support ERC7702 or contract not deployed
  | 'wallet_unsupported' // Wallet doesn't support EIP-7702 signing
  | 'incompatible_delegation' // Wallet is delegated to a different contract

export interface UseSmartAccountReturn {
  status: SmartAccountStatus
  error: string | null
  delegatedTo: string | null // The contract address the wallet is delegated to (if incompatible)
  isEnabled: boolean
  isSupported: boolean
  isLoading: boolean
  enable: () => Promise<void>
  refresh: () => Promise<void>
}

/**
 * Hook for managing ERC-7702 smart account status
 *
 * Checks if the connected wallet is delegated to our AgentDelegator contract
 * and provides functionality to enable the smart account.
 */
export function useSmartAccount(): UseSmartAccountReturn {
  const { address, chainId } = useConnection()
  const { data: walletClient } = useWalletClient()
  const publicClient = usePublicClient()

  const [status, setStatus] = useState<SmartAccountStatus>('checking')
  const [error, setError] = useState<string | null>(null)
  const [delegatedTo, setDelegatedTo] = useState<string | null>(null)

  // Check if contract is deployed on this chain
  const isSupported = chainId ? isAgentDelegatorDeployed(chainId) : false

  /**
   * Check the current delegation status
   */
  const checkStatus = useCallback(async () => {
    if (!publicClient || !address || !chainId) {
      setStatus('unsupported')
      setDelegatedTo(null)
      return
    }

    if (!isAgentDelegatorDeployed(chainId)) {
      setStatus('unsupported')
      setDelegatedTo(null)
      return
    }

    setStatus('checking')
    setError(null)
    setDelegatedTo(null)

    try {
      const contractAddress = getAgentDelegatorAddress(chainId)
      const isDelegated = await checkDelegation(publicClient, address, contractAddress)

      if (isDelegated) {
        setStatus('enabled')
      } else {
        // Check if delegated to a different contract
        const currentDelegation = await getDelegationTarget(publicClient, address)
        if (currentDelegation) {
          setStatus('incompatible_delegation')
          setDelegatedTo(currentDelegation)
        } else {
          setStatus('not_enabled')
        }
      }
    } catch (err) {
      console.error('[useSmartAccount] Failed to check delegation:', err)
      setStatus('error')
      setError('Failed to check smart account status')
    }
  }, [publicClient, address, chainId])

  /**
   * Enable the smart account by signing ERC-7702 authorization
   */
  const enable = useCallback(async () => {
    if (!walletClient || !publicClient || !address || !chainId) {
      setStatus('error')
      setError('Wallet not ready')
      return
    }

    if (!isAgentDelegatorDeployed(chainId)) {
      setStatus('unsupported')
      setError('Smart account not supported on this network')
      return
    }

    setStatus('enabling')
    setError(null)

    try {
      const contractAddress = getAgentDelegatorAddress(chainId)

      const result = await enableSmartAccount({
        walletClient,
        publicClient,
        contractAddress,
      })

      if (result.success) {
        setStatus('enabled')
        setError(null)
      } else {
        // Handle specific error types
        const errorResult = result as EnableSmartAccountError
        console.error('[useSmartAccount] Failed to enable smart account:', errorResult)

        if (errorResult.error === 'wallet_unsupported') {
          setStatus('wallet_unsupported')
        } else if (errorResult.error === 'chain_unsupported') {
          setStatus('unsupported')
        } else {
          setStatus('error')
        }
        setError(errorResult.message)
      }
    } catch (err) {
      // Catch any unexpected errors
      console.error('[useSmartAccount] Unexpected error enabling smart account:', err)
      setStatus('error')
      setError(err instanceof Error ? err.message : 'Failed to enable smart account')
    }
  }, [walletClient, publicClient, address, chainId])

  // Check status on mount and when address/chain changes
  useEffect(() => {
    if (address && chainId && publicClient) {
      checkStatus()
    } else {
      setStatus('unsupported')
    }
  }, [address, chainId, publicClient, checkStatus])

  return useMemo(
    () => ({
      status,
      error,
      delegatedTo,
      isEnabled: status === 'enabled',
      isSupported,
      isLoading: status === 'checking' || status === 'enabling',
      enable,
      refresh: checkStatus,
    }),
    [status, error, delegatedTo, isSupported, enable, checkStatus]
  )
}
