import { createConnector, http } from '@wagmi/core'
import type { EIP1193Provider, Hex, MetamaskConnectEVM } from '@metamask/connect-evm'
import { getAddress, hexToNumber, numberToHex, type Address, type Chain } from 'viem'
import { baseSepolia } from 'viem/chains'

const BASE_SEPOLIA_HEX_CHAIN_ID = numberToHex(baseSepolia.id)
const METAMASK_FLASK_CHROME_EXTENSION_ID = 'ljfoeinjpaedjfecbmggjgodbgkmjkjk'
const CONNECTED_STORAGE_KEY = 'metaMaskFlask.connected'

let clientPromise: Promise<MetamaskConnectEVM> | null = null

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

export function getMetaMaskConnectClient(): Promise<MetamaskConnectEVM> {
  if (typeof window === 'undefined') {
    throw new Error('MetaMask Connect EVM can only be used in the browser')
  }

  clientPromise ??= import('@metamask/connect-evm').then(({ createEVMClient }) =>
    createEVMClient({
      dapp: {
        name: 'opus',
        url: getDappUrl(),
        iconUrl: `${getDappUrl()}/icon.png`,
      },
      api: {
        supportedNetworks: {
          [BASE_SEPOLIA_HEX_CHAIN_ID]: getBaseSepoliaRpcUrl(),
        },
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
  )

  return clientPromise
}

function normalizeAccounts(accounts: readonly string[] | undefined): readonly Address[] {
  return (accounts ?? []).map((account) => getAddress(account))
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

async function isMetaMaskFlaskProvider(provider: EthereumProvider): Promise<boolean> {
  if (!provider.isMetaMask) {
    return false
  }

  try {
    const clientVersion = await provider.request({
      method: 'web3_clientVersion',
      params: [],
    }) as string

    return clientVersion.toLowerCase().includes('flask')
  } catch {
    return false
  }
}

async function getInjectedMetaMaskFlaskProvider(): Promise<EthereumProvider | null> {
  for (const provider of getInjectedProviders()) {
    if (await isMetaMaskFlaskProvider(provider)) {
      return provider
    }
  }

  return null
}

async function getMetaMaskFlaskProvider(): Promise<EthereumProvider> {
  const injectedProvider = await getInjectedMetaMaskFlaskProvider()
  if (injectedProvider) {
    return injectedProvider
  }

  const client = await getMetaMaskConnectClient()
  const connectProvider = client.getProvider() as EthereumProvider

  if (await isMetaMaskFlaskProvider(connectProvider)) {
    return connectProvider
  }

  throw new Error(
    'MetaMask Flask was not detected. Install or enable MetaMask Flask, disable regular MetaMask for this site if both extensions are installed, then refresh and try again.'
  )
}

function toAddEthereumChainParameter(chain: Chain) {
  const { default: defaultBlockExplorer, ...blockExplorers } = chain.blockExplorers ?? {}
  const blockExplorerUrls = defaultBlockExplorer
    ? [
      defaultBlockExplorer.url,
      ...Object.values(blockExplorers).map((blockExplorer) => blockExplorer.url),
    ]
    : undefined

  return {
    chainId: numberToHex(chain.id),
    chainName: chain.name,
    nativeCurrency: chain.nativeCurrency,
    rpcUrls: [...chain.rpcUrls.default.http],
    blockExplorerUrls,
  }
}

export function metaMaskConnect() {
  let accountsChanged: ((accounts: string[]) => void) | undefined
  let chainChanged: ((chainId: string) => void) | undefined
  let disconnect: ((error?: Error) => void) | undefined

  return createConnector<EIP1193Provider>((config) => ({
    id: 'metaMaskFlask',
    name: 'MetaMask Flask',
    rdns: ['io.metamask', 'io.metamask.mmc'],
    type: 'metaMaskFlask',

    async setup() {
      if (typeof window === 'undefined') {
        return
      }

      const provider = await this.getProvider() as EIP1193Provider
      await provider?.request({ method: 'eth_accounts', params: [] }).catch(() => undefined)
    },

    async connect({ chainId, isReconnecting, withCapabilities } = {}) {
      const requestedChainId = chainId ?? baseSepolia.id
      const targetChainId = numberToHex(requestedChainId) as Hex
      const injectedProvider = await getInjectedMetaMaskFlaskProvider()
      const client = injectedProvider ? null : await getMetaMaskConnectClient()
      const provider = injectedProvider ?? (client as MetamaskConnectEVM).getProvider()

      const result = isReconnecting
        ? {
          accounts: normalizeAccounts(await provider.request({ method: 'eth_accounts', params: [] }) as string[]),
          chainId: provider.chainId ?? BASE_SEPOLIA_HEX_CHAIN_ID,
        }
        : injectedProvider
          ? {
            accounts: normalizeAccounts(await provider.request({
              method: 'eth_requestAccounts',
              params: [],
            }) as string[]),
            chainId: await provider.request({ method: 'eth_chainId', params: [] }) as Hex,
          }
          : await (client as MetamaskConnectEVM).connect({
            chainIds: [targetChainId],
          })

      if (!(await isMetaMaskFlaskProvider(provider))) {
        throw new Error(
          'The selected wallet is regular MetaMask, not MetaMask Flask. Please select MetaMask Flask or disable regular MetaMask for this site, then try again.'
        )
      }

      if (!accountsChanged) {
        accountsChanged = this.onAccountsChanged.bind(this)
        provider.on('accountsChanged', accountsChanged)
      }

      if (!chainChanged) {
        chainChanged = this.onChainChanged.bind(this)
        provider.on('chainChanged', chainChanged)
      }

      if (!disconnect) {
        disconnect = this.onDisconnect.bind(this)
        provider.on('disconnect', disconnect)
      }

      let currentChainId = hexToNumber(result.chainId)
      if (currentChainId !== requestedChainId) {
        if (client) {
          await client.switchChain({
            chainId: targetChainId,
            chainConfiguration: toAddEthereumChainParameter(
              config.chains.find((chain) => chain.id === requestedChainId) ?? baseSepolia
            ),
          })
        } else {
          await provider.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: targetChainId }],
          }).catch(async (error) => {
            if ((error as { code?: number })?.code !== 4902) {
              throw error
            }

            await provider.request({
              method: 'wallet_addEthereumChain',
              params: [toAddEthereumChainParameter(
                config.chains.find((chain) => chain.id === requestedChainId) ?? baseSepolia
              )],
            })
          })
        }

        currentChainId = requestedChainId
      }

      await config.storage?.setItem(CONNECTED_STORAGE_KEY, true)

      const accounts = normalizeAccounts(result.accounts)
      return {
        accounts: withCapabilities
          ? accounts.map((address) => ({ address, capabilities: {} }))
          : accounts,
        chainId: currentChainId,
      } as never
    },

    async disconnect() {
      const provider = await getMetaMaskFlaskProvider()

      if (accountsChanged) {
        provider.removeListener('accountsChanged', accountsChanged)
        accountsChanged = undefined
      }

      if (chainChanged) {
        provider.removeListener('chainChanged', chainChanged)
        chainChanged = undefined
      }

      if (disconnect) {
        provider.removeListener('disconnect', disconnect)
        disconnect = undefined
      }

      const injectedProvider = await getInjectedMetaMaskFlaskProvider()
      if (injectedProvider) {
        await injectedProvider.request({
          method: 'wallet_revokePermissions',
          params: [{ eth_accounts: {} }],
        }).catch(() => undefined)
      } else {
        const client = await getMetaMaskConnectClient()
        await client.disconnect().catch(() => undefined)
      }
      await config.storage?.removeItem(CONNECTED_STORAGE_KEY)
    },

    async getAccounts() {
      const provider = await this.getProvider() as EIP1193Provider
      const accounts = await provider.request({ method: 'eth_accounts', params: [] }) as string[]

      return normalizeAccounts(accounts)
    },

    async getChainId() {
      const provider = await this.getProvider() as EIP1193Provider
      const chainId = await provider.request({ method: 'eth_chainId', params: [] }) as Hex

      return hexToNumber(chainId)
    },

    async getProvider() {
      return getMetaMaskFlaskProvider()
    },

    async isAuthorized() {
      const wasConnected = await config.storage?.getItem(CONNECTED_STORAGE_KEY)
      if (!wasConnected) {
        return false
      }

      try {
        const accounts = await this.getAccounts()
        return accounts.length > 0
      } catch {
        return false
      }
    },

    async switchChain({ chainId }) {
      const injectedProvider = await getInjectedMetaMaskFlaskProvider()
      const client = injectedProvider ? null : await getMetaMaskConnectClient()
      const chain = config.chains.find((item) => item.id === chainId)
      if (!chain) {
        throw new Error(`Unsupported chain: ${chainId}`)
      }

      if (client) {
        await client.switchChain({
          chainId: numberToHex(chainId) as Hex,
          chainConfiguration: toAddEthereumChainParameter(chain),
        })
      } else {
        await (injectedProvider as EthereumProvider).request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: numberToHex(chainId) }],
        })
      }

      config.emitter.emit('change', { chainId })
      return chain
    },

    onAccountsChanged(accounts) {
      const normalizedAccounts = normalizeAccounts(accounts)

      if (normalizedAccounts.length === 0) {
        this.onDisconnect()
        return
      }

      config.emitter.emit('change', { accounts: normalizedAccounts })
    },

    onChainChanged(chainId) {
      config.emitter.emit('change', { chainId: hexToNumber(chainId as Hex) })
    },

    onDisconnect() {
      config.storage?.removeItem(CONNECTED_STORAGE_KEY)
      config.emitter.emit('disconnect')
    },
  }))
}

export const metaMaskConnectTransports = {
  [baseSepolia.id]: http(getBaseSepoliaRpcUrl()),
}
