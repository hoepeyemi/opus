'use client'

import { useState, useCallback } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Loader2,
  Copy,
  Check,
  Eye,
  EyeOff,
  AlertTriangle,
  Wallet,
  ShieldAlert,
} from 'lucide-react'
import { useChainId, useSignTypedData, useAccount, useReadContract } from 'wagmi'
import { generateAndEnableWallet } from '@/lib/smartAccount'
import { getAgentDelegatorAddress, isAgentDelegatorDeployed } from '@x402/contracts'
import { getUsdceConfigSafe } from '@/config/tokens'
import { erc20Abi, type Address, type Hex, type Hash } from 'viem'

// Cost in USDC.e (6 decimals) - $0.50
const WALLET_GENERATION_COST = BigInt(500000)
import {
  EIP3009_TYPES,
  buildUsdceDomain,
  buildEIP3009Message,
  buildPaymentHeader,
  encodePaymentHeader,
  parseChainId,
} from '@/lib/x402/client'

type ModalState = 'initial' | 'enabling' | 'complete' | 'error'
type EnablingStep = 'payment' | 'generating' | 'signing' | 'confirming'

interface PaymentRequirements {
  scheme: string
  network: string
  payTo: Address
  asset: Address
  maxAmountRequired: string
  maxTimeoutSeconds: number
  description?: string
  mimeType?: string
}

interface GeneratedWallet {
  address: Address
  privateKey: Hex
  txHash: Hash
}

interface GenerateWalletModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function GenerateWalletModal({ open, onOpenChange }: GenerateWalletModalProps) {
  const [state, setState] = useState<ModalState>('initial')
  const [enablingStep, setEnablingStep] = useState<EnablingStep>('payment')
  const [error, setError] = useState<string | null>(null)
  const [generatedWallet, setGeneratedWallet] = useState<GeneratedWallet | null>(null)
  const [showPrivateKey, setShowPrivateKey] = useState(false)
  const [copiedAddress, setCopiedAddress] = useState(false)
  const [copiedKey, setCopiedKey] = useState(false)
  const [hasBackedUp, setHasBackedUp] = useState(false)

  const chainId = useChainId()
  const { address } = useAccount()
  const { signTypedDataAsync } = useSignTypedData()
  const isSupported = isAgentDelegatorDeployed(chainId)

  // Get USDC.e token address for current chain
  const usdceConfig = getUsdceConfigSafe(chainId)
  const usdceAddress = usdceConfig?.address

  // Check USDC.e balance using ERC20 balanceOf
  const { data: usdceBalance, isLoading: isBalanceLoading } = useReadContract({
    abi: erc20Abi,
    address: usdceAddress,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: {
      enabled: !!address && !!usdceAddress,
    },
  })

  const hasInsufficientBalance = usdceBalance !== undefined
    ? usdceBalance < WALLET_GENERATION_COST
    : true

  // Format balance for display (6 decimals for USDC.e)
  const formattedBalance = usdceBalance !== undefined
    ? (Number(usdceBalance) / 1_000_000).toFixed(2)
    : '0.00'

  const handleGenerate = useCallback(async () => {
    if (!isSupported || !address) return

    setState('enabling')
    setEnablingStep('payment')
    setError(null)

    try {
      const contractAddress = getAgentDelegatorAddress(chainId)

      // Step 1: Get payment requirements from the API
      console.log('[GenerateWallet] Getting payment requirements...')
      const initialResponse = await fetch('/api/relayer/enable-7702', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chainId }),
      })

      if (initialResponse.status !== 402) {
        throw new Error('Unexpected response from relayer API')
      }

      const { paymentRequirements } = await initialResponse.json()
      console.log('[GenerateWallet] Payment requirements:', paymentRequirements)

      if (!paymentRequirements?.payTo || !paymentRequirements?.asset) {
        throw new Error('Invalid payment requirements from server')
      }

      const requirements: PaymentRequirements = {
        scheme: paymentRequirements.scheme,
        network: paymentRequirements.network,
        payTo: paymentRequirements.payTo as Address,
        asset: paymentRequirements.asset as Address,
        maxAmountRequired: paymentRequirements.maxAmountRequired,
        maxTimeoutSeconds: paymentRequirements.maxTimeoutSeconds ?? 300,
      }

      // Step 2: Sign the x402 payment with user's wallet
      console.log('[GenerateWallet] Signing payment...')
      const reqChainId = parseChainId(requirements.network)
      const domain = buildUsdceDomain(requirements.asset, reqChainId)
      const message = buildEIP3009Message({
        from: address,
        to: requirements.payTo,
        value: BigInt(requirements.maxAmountRequired),
        validitySeconds: requirements.maxTimeoutSeconds,
      })

      const signature = await signTypedDataAsync({
        domain,
        types: EIP3009_TYPES,
        primaryType: 'TransferWithAuthorization',
        message,
      })

      console.log('[GenerateWallet] Payment signed')

      // Step 3: Build payment header
      const header = buildPaymentHeader({
        message,
        signature,
        asset: requirements.asset,
        chainId: reqChainId,
      })
      const paymentHeader = encodePaymentHeader(header)

      // Step 4: Generate wallet and enable 7702
      setEnablingStep('generating')

      const result = await generateAndEnableWallet({
        chainId,
        contractAddress,
        paymentHeader,
      })

      if ('success' in result && result.success === false) {
        setError(result.message)
        setState('error')
        return
      }

      setEnablingStep('signing')
      // Small delay to show signing state
      await new Promise((resolve) => setTimeout(resolve, 300))

      setEnablingStep('confirming')
      // Small delay to show confirming state before transitioning
      await new Promise((resolve) => setTimeout(resolve, 500))

      setGeneratedWallet(result as GeneratedWallet)
      setState('complete')
    } catch (err) {
      console.error('Failed to generate wallet:', err)
      setError(err instanceof Error ? err.message : 'An unexpected error occurred')
      setState('error')
    }
  }, [chainId, isSupported, address, signTypedDataAsync])

  const handleCopyAddress = useCallback(async () => {
    if (!generatedWallet) return
    await navigator.clipboard.writeText(generatedWallet.address)
    setCopiedAddress(true)
    setTimeout(() => setCopiedAddress(false), 2000)
  }, [generatedWallet])

  const handleCopyKey = useCallback(async () => {
    if (!generatedWallet) return
    await navigator.clipboard.writeText(generatedWallet.privateKey)
    setCopiedKey(true)
    setTimeout(() => setCopiedKey(false), 2000)
  }, [generatedWallet])

  const handleClose = useCallback(() => {
    if (state === 'enabling') return // Prevent closing during generation
    onOpenChange(false)
    // Reset state after modal closes
    setTimeout(() => {
      setState('initial')
      setEnablingStep('payment')
      setError(null)
      setGeneratedWallet(null)
      setShowPrivateKey(false)
      setCopiedAddress(false)
      setCopiedKey(false)
      setHasBackedUp(false)
    }, 200)
  }, [state, onOpenChange])

  const handleDone = useCallback(() => {
    handleClose()
  }, [handleClose])

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="sm:max-w-lg"
        showCloseButton={state !== 'enabling'}
      >
        {state === 'initial' && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Wallet className="size-5" />
                Generate Smart Account Wallet
              </DialogTitle>
              <DialogDescription>
                Create a new wallet with EIP-7702 smart account capabilities for
                session keys and x402 payments.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/50 p-4 space-y-3">
                <h4 className="font-medium text-sm">What happens next:</h4>
                <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
                  <li>Sign a $0.50 USDC payment to cover gas costs</li>
                  <li>A new wallet will be generated locally in your browser</li>
                  <li>The smart account will be enabled automatically</li>
                  <li>You&apos;ll receive the private key to import into your wallet app</li>
                </ol>
              </div>

              <div className="rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-900 p-3 space-y-2">
                <p className="text-sm text-blue-700 dark:text-blue-300">
                  <strong>Cost:</strong> $0.50 USDC.e (covers blockchain gas fees)
                </p>
                <p className="text-sm text-blue-600 dark:text-blue-400">
                  Need USDC.e?{' '}
                  <a
                    href="https://vvs.finance/trade/swap?inputCurrency=cro&outputCurrency=0xf951eC28187D9E5Ca673Da8FE6757E6f0Be5F77C&exactAmount=0&exactField=input"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-blue-800 dark:hover:text-blue-200 font-medium"
                  >
                    Get it here
                  </a>{' '}
                  on VVS Finance.
                </p>
              </div>

              {/* Balance Status */}
              {!isBalanceLoading && usdceBalance !== undefined && (
                <div
                  className={`rounded-lg border p-3 ${
                    hasInsufficientBalance
                      ? 'border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900'
                      : 'border-green-200 bg-green-50 dark:bg-green-950/20 dark:border-green-900'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {hasInsufficientBalance ? (
                      <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" />
                    ) : (
                      <Check className="size-4 text-green-600 dark:text-green-400" />
                    )}
                    <p
                      className={`text-sm ${
                        hasInsufficientBalance
                          ? 'text-amber-700 dark:text-amber-300'
                          : 'text-green-700 dark:text-green-300'
                      }`}
                    >
                      <strong>Your Balance:</strong> {formattedBalance} USDC.e
                      {hasInsufficientBalance && ' (insufficient)'}
                    </p>
                  </div>
                </div>
              )}

              {isBalanceLoading && (
                <div className="rounded-lg border bg-muted/50 p-3">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    Checking balance...
                  </div>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                onClick={handleGenerate}
                disabled={!isSupported || !address || hasInsufficientBalance || isBalanceLoading}
              >
                {hasInsufficientBalance && !isBalanceLoading
                  ? 'Insufficient USDC.e'
                  : 'Generate Wallet ($0.50)'}
              </Button>
            </DialogFooter>
          </>
        )}

        {state === 'enabling' && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Loader2 className="size-5 animate-spin" />
                Creating Smart Account...
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-3">
                {/* Step 1: Payment */}
                <div className="flex items-center gap-3">
                  <div
                    className={`size-6 rounded-full flex items-center justify-center ${
                      enablingStep === 'payment'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-green-500 text-white'
                    }`}
                  >
                    {enablingStep === 'payment' ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Check className="size-4" />
                    )}
                  </div>
                  <span
                    className={
                      enablingStep === 'payment'
                        ? 'font-medium'
                        : 'text-muted-foreground'
                    }
                  >
                    {enablingStep === 'payment' ? 'Sign payment in your wallet...' : 'Payment signed'}
                  </span>
                </div>

                {/* Step 2: Generating */}
                <div className="flex items-center gap-3">
                  <div
                    className={`size-6 rounded-full flex items-center justify-center ${
                      enablingStep === 'generating'
                        ? 'bg-primary text-primary-foreground'
                        : enablingStep === 'signing' || enablingStep === 'confirming'
                          ? 'bg-green-500 text-white'
                          : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {enablingStep === 'generating' ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : enablingStep === 'signing' || enablingStep === 'confirming' ? (
                      <Check className="size-4" />
                    ) : (
                      <span className="text-xs">2</span>
                    )}
                  </div>
                  <span
                    className={
                      enablingStep === 'generating'
                        ? 'font-medium'
                        : enablingStep === 'signing' || enablingStep === 'confirming'
                          ? 'text-muted-foreground'
                          : 'text-muted-foreground'
                    }
                  >
                    Generating wallet...
                  </span>
                </div>

                {/* Step 3: Signing authorization */}
                <div className="flex items-center gap-3">
                  <div
                    className={`size-6 rounded-full flex items-center justify-center ${
                      enablingStep === 'signing'
                        ? 'bg-primary text-primary-foreground'
                        : enablingStep === 'confirming'
                          ? 'bg-green-500 text-white'
                          : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {enablingStep === 'signing' ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : enablingStep === 'confirming' ? (
                      <Check className="size-4" />
                    ) : (
                      <span className="text-xs">3</span>
                    )}
                  </div>
                  <span
                    className={
                      enablingStep === 'signing'
                        ? 'font-medium'
                        : enablingStep === 'confirming'
                          ? 'text-muted-foreground'
                          : 'text-muted-foreground'
                    }
                  >
                    Enabling smart account...
                  </span>
                </div>

                {/* Step 4: Confirming */}
                <div className="flex items-center gap-3">
                  <div
                    className={`size-6 rounded-full flex items-center justify-center ${
                      enablingStep === 'confirming'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {enablingStep === 'confirming' ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <span className="text-xs">4</span>
                    )}
                  </div>
                  <span
                    className={
                      enablingStep === 'confirming'
                        ? 'font-medium'
                        : 'text-muted-foreground'
                    }
                  >
                    Confirming on chain...
                  </span>
                </div>
              </div>
            </div>
          </>
        )}

        {state === 'complete' && generatedWallet && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-green-600">
                <Check className="size-5" />
                Wallet Created Successfully
              </DialogTitle>
              <DialogDescription>
                Your new smart account wallet has been created. Save your private
                key securely before continuing.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {/* Address Section */}
              <div className="space-y-2">
                <Label htmlFor="wallet-address">Wallet Address</Label>
                <div className="flex gap-2">
                  <Input
                    id="wallet-address"
                    value={generatedWallet.address}
                    readOnly
                    className="font-mono text-xs"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={handleCopyAddress}
                    title="Copy address"
                  >
                    {copiedAddress ? (
                      <Check className="size-4 text-green-500" />
                    ) : (
                      <Copy className="size-4" />
                    )}
                  </Button>
                </div>
              </div>

              {/* Private Key Section */}
              <div className="space-y-2">
                <Label htmlFor="private-key">Private Key</Label>
                <div className="flex gap-2">
                  <Input
                    id="private-key"
                    type={showPrivateKey ? 'text' : 'password'}
                    value={generatedWallet.privateKey}
                    readOnly
                    className="font-mono text-xs"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setShowPrivateKey(!showPrivateKey)}
                    title={showPrivateKey ? 'Hide private key' : 'Show private key'}
                  >
                    {showPrivateKey ? (
                      <EyeOff className="size-4" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={handleCopyKey}
                    title="Copy private key"
                  >
                    {copiedKey ? (
                      <Check className="size-4 text-green-500" />
                    ) : (
                      <Copy className="size-4" />
                    )}
                  </Button>
                </div>
              </div>

              {/* Security Warnings */}
              <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900 p-4 space-y-2">
                <div className="flex items-start gap-2">
                  <ShieldAlert className="size-5 text-amber-600 shrink-0 mt-0.5" />
                  <div className="space-y-2">
                    <p className="font-medium text-amber-800 dark:text-amber-200 text-sm">
                      Important Security Information
                    </p>
                    <ul className="text-sm text-amber-700 dark:text-amber-300 space-y-1 list-disc list-inside">
                      <li>This is the only time you will see this private key</li>
                      <li>Store it securely in a password manager or write it down</li>
                      <li>Never share your private key or paste it online</li>
                      <li>If lost, this wallet cannot be recovered</li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* Backup Confirmation */}
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="backed-up"
                  checked={hasBackedUp}
                  onChange={(e) => setHasBackedUp(e.target.checked)}
                  className="size-4 rounded border-input accent-primary"
                />
                <label
                  htmlFor="backed-up"
                  className="text-sm font-medium cursor-pointer"
                >
                  I have safely backed up my private key
                </label>
              </div>

              {/* Next Steps */}
              {hasBackedUp && (
                <div className="rounded-lg border bg-muted/50 p-4 space-y-2">
                  <p className="font-medium text-sm">Next steps:</p>
                  <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
                    <li>Import the private key into your wallet app (MetaMask, Rabby, etc.)</li>
                    <li>Disconnect your current wallet</li>
                    <li>Reconnect using your new smart account wallet</li>
                  </ol>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button onClick={handleDone} disabled={!hasBackedUp}>
                Done
              </Button>
            </DialogFooter>
          </>
        )}

        {state === 'error' && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="size-5" />
                Failed to Create Wallet
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>
                Close
              </Button>
              <Button onClick={handleGenerate}>Try Again</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
