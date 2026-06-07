'use client'

import { useRouter } from 'next/navigation'
import { Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ProxyFormProvider, ProxyForm } from '@/features/proxy'
import { useMetaMaskConnect } from '@/features/wallet/model/useMetaMaskConnect'

interface CreatePageClientProps {
  showWalletButton?: boolean
}

export function CreatePageClient({ showWalletButton }: CreatePageClientProps) {
  const router = useRouter()
  const { open } = useMetaMaskConnect()

  if (showWalletButton) {
    return (
      <Button onClick={() => open()} className="gap-2">
        <Wallet className="size-4" />Connect MetaMask Flask</Button>
    )
  }

  const handleSuccess = () => {
    router.push('/dashboard')
  }

  return (
    <ProxyFormProvider onSuccess={handleSuccess}>
      <ProxyForm />
    </ProxyFormProvider>
  )
}
