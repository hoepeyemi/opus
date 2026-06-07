'use client'

import { useCallback, useMemo } from 'react'
import { useConnect, useConnectors } from 'wagmi'
import { baseSepolia } from 'viem/chains'

export function useMetaMaskConnect() {
  const connectors = useConnectors()
  const { connectAsync, isPending, error } = useConnect()
  const connector = useMemo(
    () => connectors.find((item) => item.id === 'metaMaskFlask') ?? connectors[0],
    [connectors]
  )

  const open = useCallback(async () => {
    if (!connector) {
      throw new Error('MetaMask Flask connector is not available')
    }

    await connectAsync({
      connector,
      chainId: baseSepolia.id,
    })
  }, [connectAsync, connector])

  return {
    open,
    isPending,
    error,
    connector,
  }
}
