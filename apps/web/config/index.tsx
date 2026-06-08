import { cookieStorage, createConfig, createStorage } from 'wagmi'
import { baseSepolia } from 'wagmi/chains'
import { metaMaskConnect, metaMaskConnectTransports } from '@/lib/metamask/connect'

export const networks = [baseSepolia] as [typeof baseSepolia]

export const config = createConfig({
  chains: networks,
  connectors: [metaMaskConnect()],
  transports: metaMaskConnectTransports,
  storage: createStorage({
    storage: cookieStorage,
  }),
  ssr: true,
})
