'use client'

import { useCallback, useMemo } from 'react'
import { useConnect, useConnectors } from 'wagmi'
import { baseSepolia } from 'wagmi/chains'

export function useMetaMaskConnect() {
  const connectors = useConnectors()
  const connect = useConnect()
  const connector = useMemo(
    () => connectors.find((item) => item.id === 'metaMaskSDK') ?? connectors[0],
    [connectors]
  )

  const open = useCallback(async () => {
    if (!connector) {
      throw new Error('MetaMask connector is not available')
    }

    return connect.mutateAsync({
      connector,
      chainId: baseSepolia.id,
    })
  }, [connect, connector])

  return {
    open,
    isPending: connect.isPending,
    error: connect.error,
    connector,
  }
}
