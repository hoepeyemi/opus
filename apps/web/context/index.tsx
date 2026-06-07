'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { type ReactNode, useState } from 'react'
import { type State, WagmiProvider } from 'wagmi'
import { config } from '@/config'
import { UserProvider } from './user'

export const SESSION_CREATED_EVENT = 'x402:session:created'
export const SESSION_DESTROYED_EVENT = 'x402:session:destroyed'

export function Web3Provider(props: { children: ReactNode; initialState?: State }) {
  const [queryClient] = useState(() => new QueryClient())

  return (
    <WagmiProvider config={config} initialState={props.initialState}>
      <QueryClientProvider client={queryClient}>
        <UserProvider>{props.children}</UserProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}
