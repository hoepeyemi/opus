'use client'

import { Shield, ShieldCheck, ShieldAlert, ShieldX, ShieldBan, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useSmartAccount } from '../model/useSmartAccount'

/**
 * Badge component showing the smart account status
 *
 * Shows:
 * - Loading state while checking
 * - "Smart Account" badge with checkmark if enabled
 * - "Enable Smart Account" button if not enabled
 * - "Incompatible" badge if delegated to a different contract
 * - Nothing if chain doesn't support ERC-7702
 */
export function SmartAccountBadge() {
  const { status, isEnabled, isSupported, enable, error, delegatedTo } = useSmartAccount()

  // Don't render anything if chain doesn't support smart accounts
  if (!isSupported) {
    return null
  }

  // Checking state
  if (status === 'checking') {
    return (
      <Badge variant="secondary" className="gap-1">
        <Loader2 className="size-3 animate-spin" />
        <span>Checking...</span>
      </Badge>
    )
  }

  // Enabled state
  if (isEnabled) {
    return (
      <Badge variant="default" className="gap-1 bg-green-600 hover:bg-green-600">
        <ShieldCheck className="size-3" />
        <span>Smart Account</span>
      </Badge>
    )
  }

  // Wallet unsupported state - wallet doesn't support EIP-7702
  if (status === 'wallet_unsupported') {
    return (
      <Badge
        variant="secondary"
        className="gap-1 cursor-help"
        title="Your wallet doesn't support EIP-7702 signing yet. Try Rabby with experimental features enabled, or wait for wallet updates."
      >
        <ShieldX className="size-3" />
        <span>Wallet Unsupported</span>
      </Badge>
    )
  }

  // Incompatible delegation state - delegated to a different contract
  if (status === 'incompatible_delegation') {
    return (
      <Badge
        variant="secondary"
        className="gap-1 cursor-help bg-amber-100 text-amber-800 hover:bg-amber-100"
        title={`Your wallet is delegated to a different smart account (${delegatedTo}). To use this platform, you'll need to re-delegate to our contract.`}
      >
        <ShieldBan className="size-3" />
        <span>Incompatible Account</span>
      </Badge>
    )
  }

  // Error state
  if (status === 'error') {
    return (
      <Badge variant="destructive" className="gap-1" title={error || 'Error'}>
        <ShieldAlert className="size-3" />
        <span>Error</span>
      </Badge>
    )
  }

  // Enabling state
  if (status === 'enabling') {
    return (
      <Button variant="outline" size="sm" disabled className="gap-1">
        <Loader2 className="size-3 animate-spin" />
        <span>Enabling...</span>
      </Button>
    )
  }

  // Not enabled - show enable button
  return (
    <Button variant="outline" size="sm" onClick={enable} className="gap-1">
      <Shield className="size-3" />
      <span>Enable Smart Account</span>
    </Button>
  )
}
