import { cookieStorage, createConfig, createStorage } from 'wagmi'
import { baseSepolia } from 'wagmi/chains'
import { metaMaskConnect, metaMaskConnectTransports, metaMaskInjected } from '@/lib/metamask/connect'

export const networks = [baseSepolia] as [typeof baseSepolia]

export const config = createConfig({
  chains: networks,
  connectors: [metaMaskInjected(), metaMaskConnect()],
  transports: metaMaskConnectTransports,
  storage: createStorage({
    storage: cookieStorage,
  }),
  ssr: true,
})
