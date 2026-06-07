import { http } from '@wagmi/core'
import type { EIP1193Provider } from '@metamask/connect-evm'
import { baseSepolia } from 'viem/chains'
import { metaMask } from 'wagmi/connectors'

const METAMASK_FLASK_CHROME_EXTENSION_ID = 'ljfoeinjpaedjfecbmggjgodbgkmjkjk'

type EthereumProvider = EIP1193Provider & {
  isMetaMask?: boolean
  providers?: EthereumProvider[]
}

function getBaseSepoliaRpcUrl(): string {
  return process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL || baseSepolia.rpcUrls.default.http[0]
}

function getDappUrl(): string {
  if (typeof window === 'undefined') {
    return 'http://localhost:3000'
  }

  return window.location.origin
}

function getMetaMaskFlaskExtensionId(): string {
  return process.env.NEXT_PUBLIC_METAMASK_FLASK_EXTENSION_ID || METAMASK_FLASK_CHROME_EXTENSION_ID
}

function getInjectedProviders(): EthereumProvider[] {
  if (typeof window === 'undefined') {
    return []
  }

  const ethereum = (window as Window & { ethereum?: EthereumProvider }).ethereum
  if (!ethereum) {
    return []
  }

  return ethereum.providers?.length ? ethereum.providers : [ethereum]
}

export async function isMetaMaskFlaskProvider(provider: EIP1193Provider): Promise<boolean> {
  const maybeMetaMask = provider as EthereumProvider
  if (!maybeMetaMask.isMetaMask) {
    return false
  }

  try {
    const clientVersion = await maybeMetaMask.request({
      method: 'web3_clientVersion',
      params: [],
    }) as string

    return clientVersion.toLowerCase().includes('flask')
  } catch {
    return false
  }
}

export async function getInjectedMetaMaskFlaskProvider(): Promise<EthereumProvider | null> {
  for (const provider of getInjectedProviders()) {
    if (await isMetaMaskFlaskProvider(provider)) {
      return provider
    }
  }

  return null
}

export async function assertMetaMaskFlaskProvider(provider: EIP1193Provider): Promise<void> {
  if (await isMetaMaskFlaskProvider(provider)) {
    return
  }

  throw new Error(
    'MetaMask Flask was not detected. Install or enable MetaMask Flask, make sure this site is connected to Flask rather than regular MetaMask, then refresh and try again.'
  )
}

export function metaMaskConnect(): ReturnType<typeof metaMask> {
  return metaMask({
    dapp: {
      name: 'opus',
      url: getDappUrl(),
      iconUrl: `${getDappUrl()}/icon.png`,
    },
    analytics: {
      enabled: false,
      integrationType: 'opus-web',
    },
    ui: {
      preferExtension: true,
      showInstallModal: true,
    },
    transport: {
      extensionId: getMetaMaskFlaskExtensionId(),
    },
  })
}

export const metaMaskConnectTransports = {
  [baseSepolia.id]: http(getBaseSepoliaRpcUrl()),
}
