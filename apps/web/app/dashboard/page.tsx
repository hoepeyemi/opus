'use client'

import { useRouter } from 'next/navigation'
import { Loader2, Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DashboardView } from '@/features/dashboard'
import { useUser } from '@/context/user'
import { useMetaMaskConnect } from '@/features/wallet/model/useMetaMaskConnect'

export default function DashboardPage() {
  const router = useRouter()
  const { session, isLoading } = useUser()
  const { open, error, isPending } = useMetaMaskConnect()

  const isAuthenticated = session?.isAuthenticated
  const hasConnectedWallet = Boolean(session?.walletAddress)

  // Show loading while checking auth
  if (isLoading) {
    return (
      <div className="container py-8">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    )
  }

  // Not authenticated - show sign in prompt
  if (!isAuthenticated) {
    return (
      <div className="container py-8 max-w-lg">
        <Card>
          <CardHeader className="text-center">
            <Wallet className="size-12 mx-auto mb-4 text-muted-foreground" />
            <CardTitle>{hasConnectedWallet ? 'Sign In' : 'Connect Your Wallet'}</CardTitle>
            <CardDescription>
              {hasConnectedWallet
                ? 'Sign this message to create your dashboard session.'
                : 'You need to connect your wallet to access your dashboard and manage your APIs.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4">
            <Button onClick={() => void open()} disabled={isPending} size="lg" className="gap-2">
              <Wallet className="size-4" />
              {isPending
                ? 'Waiting for MetaMask...'
                : hasConnectedWallet
                  ? 'Sign In with MetaMask Flask'
                  : 'Connect MetaMask Flask'}
            </Button>
            {error && (
              <p className="text-center text-sm text-destructive">
                {error.message}
              </p>
            )}
            <Button variant="ghost" onClick={() => router.push('/')}>
              Browse APIs Instead
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return <DashboardView />
}
