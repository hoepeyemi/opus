'use client'

import { useCallback, useMemo } from 'react'
import { useConnect, useConnectors, useDisconnect } from 'wagmi'
import { baseSepolia } from 'viem/chains'
import { assertMetaMaskFlaskProvider } from '@/lib/metamask/connect'
import type { EIP1193Provider } from '@metamask/connect-evm'

export function useMetaMaskConnect() {
  const connectors = useConnectors()
  const { connectAsync, isPending, error } = useConnect()
  const { disconnectAsync } = useDisconnect()
  const connector = useMemo(
    () => connectors.find((item) => item.id === 'metaMaskSDK') ?? connectors[0],
    [connectors]
  )

  const open = useCallback(async () => {
    if (!connector) {
      throw new Error('MetaMask Flask connector is not available')
    }

    const result = await connectAsync({
      connector,
      chainId: baseSepolia.id,
    })
    const provider = await connector.getProvider()

    try {
      await assertMetaMaskFlaskProvider(provider as EIP1193Provider)
    } catch (error) {
      await disconnectAsync().catch(() => undefined)
      throw error
    }

    return result
  }, [connectAsync, connector, disconnectAsync])

  return {
    open,
    isPending,
    error,
    connector,
  }
}
