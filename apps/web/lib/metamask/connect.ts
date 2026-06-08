import { http } from 'wagmi'
import { baseSepolia } from 'wagmi/chains'
import { metaMask } from 'wagmi/connectors'

function getBaseSepoliaRpcUrl(): string {
  return process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL || baseSepolia.rpcUrls.default.http[0]
}

function getDappUrl(): string {
  if (typeof window === 'undefined') {
    return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  }

  return window.location.href
}

export function metaMaskConnect(): ReturnType<typeof metaMask> {
  return metaMask({
    dapp: {
      name: 'opus',
      url: getDappUrl(),
    },
  })
}

export const metaMaskConnectTransports = {
  [baseSepolia.id]: http(getBaseSepoliaRpcUrl()),
}
