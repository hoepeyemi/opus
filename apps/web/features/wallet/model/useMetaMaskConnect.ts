'use client'

import { useCallback, useMemo, useState } from 'react'
import { useConnect, useConnection, useConnectors, useSignMessage } from 'wagmi'
import { baseSepolia } from 'wagmi/chains'
import type { Address } from 'viem'
import { SESSION_CREATED_EVENT } from '@/context'

function buildSignInMessage(address: Address, nonce: string): string {
  return [
    'Sign in to opus',
    '',
    'This signature proves wallet ownership and creates a dashboard session.',
    '',
    `Wallet: ${address}`,
    `Chain ID: ${baseSepolia.id}`,
    `Nonce: ${nonce}`,
  ].join('\n')
}

export function useMetaMaskConnect() {
  const connectors = useConnectors()
  const connect = useConnect()
  const { address, isConnected } = useConnection()
  const { signMessageAsync, isPending: isSigning } = useSignMessage()
  const [authError, setAuthError] = useState<Error | null>(null)
  const connector = useMemo(
    () => (
      connectors.find((item) => item.id === 'injected' && item.name.toLowerCase().includes('metamask'))
      ?? connectors.find((item) => item.id === 'metaMask')
      ?? connectors.find((item) => item.id === 'metaMaskSDK')
      ?? connectors[0]
    ),
    [connectors]
  )

  const createServerSession = useCallback(async (walletAddress: Address) => {
    const nonceResponse = await fetch('/api/auth/nonce', {
      headers: { Accept: 'application/json' },
    })

    if (!nonceResponse.ok) {
      throw new Error('Failed to create sign-in nonce')
    }

    const { nonce } = await nonceResponse.json() as { nonce?: string }
    if (!nonce) {
      throw new Error('Sign-in nonce response was invalid')
    }

    const message = buildSignInMessage(walletAddress, nonce)
    const signature = await signMessageAsync({ message })

    const sessionResponse = await fetch('/api/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        walletAddress,
        nonce,
        message,
        signature,
      }),
    })

    if (!sessionResponse.ok) {
      const errorBody = await sessionResponse.json().catch(() => null) as { error?: string } | null
      throw new Error(errorBody?.error ?? 'Failed to create dashboard session')
    }

    window.dispatchEvent(new Event(SESSION_CREATED_EVENT))
  }, [signMessageAsync])

  const open = useCallback(async () => {
    setAuthError(null)

    try {
      if (isConnected && address) {
        await createServerSession(address)
        return { accounts: [address], chainId: baseSepolia.id }
      }

      if (!connector) {
        throw new Error('MetaMask connector is not available')
      }

      const result = await connect.mutateAsync({
        connector,
        chainId: baseSepolia.id,
      })
      const connectedAddress = result.accounts?.[0] ?? address

      if (!connectedAddress) {
        throw new Error('MetaMask connected but did not return an account')
      }

      await createServerSession(connectedAddress)
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      try {
        if (message.includes('Connector already connected') && address) {
          await createServerSession(address)
          return { accounts: [address], chainId: baseSepolia.id }
        }
      } catch (sessionError) {
        const normalizedError = sessionError instanceof Error ? sessionError : new Error(String(sessionError))
        setAuthError(normalizedError)
        return null
      }

      const normalizedError = error instanceof Error ? error : new Error(String(error))
      if (normalizedError.message.includes('scheme does not have a registered handler')) {
        normalizedError.message = 'MetaMask extension was not detected. Install or enable MetaMask Flask in this browser, then refresh and connect again.'
      }
      setAuthError(normalizedError)
      return null
    }
  }, [address, connect, connector, createServerSession, isConnected])

  return {
    open,
    isPending: connect.isPending || isSigning,
    error: authError ?? connect.error,
    connector,
  }
}
