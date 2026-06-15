'use client'

import { Play, Loader2, Wallet, Copy, Check, AlertCircle, Key, Shield } from 'lucide-react'
import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useUser } from '@/context/user'
import { useMetaMaskConnect } from '@/features/wallet/model/useMetaMaskConnect'
import { useAccount } from 'wagmi'
import { useApiTryIt } from '@/features/marketplace/model/useApiTryIt'
import { useSmartAccount } from '@/features/smartAccount/model/useSmartAccount'
import { useSessions } from '@/features/sessionKeys/model'
import { formatPrice } from '@/lib/formatting'
import type { VariableDefinition } from '@/features/proxy/model/variables'

interface ApiTryItProps {
  proxyId: string
  proxyUrl: string
  pricePerRequest: number
  httpMethod: string
  variablesSchema: VariableDefinition[]
  requestBodyTemplate: string | null
}

export function ApiTryIt({
  proxyId,
  proxyUrl,
  pricePerRequest,
  httpMethod,
  variablesSchema,
  requestBodyTemplate,
}: ApiTryItProps) {
  const { session } = useUser()
  const { open } = useMetaMaskConnect()
  const { isConnected } = useAccount()
  const [copied, setCopied] = useState(false)

  // Smart account and session state
  const { isEnabled: isSmartAccountEnabled, enable: enableSmartAccount, status: smartAccountStatus } = useSmartAccount()
  const { sessions, isLoading: isLoadingSessions } = useSessions()
  const activeSession = sessions[0] // Use first active session

  // Session mode toggle
  const [useSession, setUseSession] = useState(false)
  const [useMetaMaskX402, setUseMetaMaskX402] = useState(false)
  const canUseSession = isSmartAccountEnabled && !!activeSession
  const isOpusDelegated = isSmartAccountEnabled
  const canUseMetaMaskX402 = !isOpusDelegated

  useEffect(() => {
    if (isOpusDelegated && useMetaMaskX402) {
      setUseMetaMaskX402(false)
      if (canUseSession) {
        setUseSession(true)
      }
    }
  }, [canUseSession, isOpusDelegated, useMetaMaskX402])

  const {
    variables,
    setVariable,
    requestBody,
    setRequestBody,
    isLoading,
    response,
    error,
    executeRequest,
  } = useApiTryIt({
    proxyUrl,
    httpMethod,
    variablesSchema,
    requestBodyTemplate,
    sessionId: activeSession?.sessionId,
    useSessionKey: useSession && !!activeSession && !useMetaMaskX402,
    useMetaMaskX402,
  })

  // Determine if body input should be shown (POST, PUT, PATCH)
  const showBodyInput = ['POST', 'PUT', 'PATCH'].includes(httpMethod.toUpperCase())

  const isAuthenticated = session?.isAuthenticated
  const canUseWallet = isAuthenticated || isConnected

  const handleTryIt = async () => {
    if (!canUseWallet) {
      open()
      return
    }

    // If session mode is enabled but smart account not enabled, enable it
    if (useSession && !isSmartAccountEnabled) {
      await enableSmartAccount()
      return
    }

    await executeRequest()
  }

  const handleCopyResponse = async () => {
    if (response) {
      await navigator.clipboard.writeText(response.body)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const getButtonContent = () => {
    if (isLoading) {
      return (
        <>
          <Loader2 className="size-4 animate-spin" />
          {useMetaMaskX402 ? 'Requesting permission...' : useSession ? 'Processing...' : 'Signing...'}
        </>
      )
    }

    if (!canUseWallet) {
      return (
        <>
          <Wallet className="size-4" />
          Connect MetaMask Flask to Try
        </>
      )
    }

    if (useSession && !useMetaMaskX402 && !isSmartAccountEnabled) {
      return (
        <>
          <Shield className="size-4" />
          Enable Smart Account
        </>
      )
    }

    if (useSession && !useMetaMaskX402 && !activeSession && !isLoadingSessions) {
      return (
        <>
          <Key className="size-4" />
          Create Session First
        </>
      )
    }

    return (
      <>
        {useMetaMaskX402 ? <Shield className="size-4" /> : useSession ? <Key className="size-4" /> : <Play className="size-4" />}
        Make Request ({formatPrice(pricePerRequest)})
        {useMetaMaskX402 && ' - Flask'}
        {useSession && activeSession && !useMetaMaskX402 && ' - Auto'}
      </>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Play className="size-5" />
          Try It
        </CardTitle>
        <CardDescription>
          Test this API by filling in the variables and making a request.
          {useSession && activeSession
            ? ' Payment will be signed automatically with your session key.'
            : useMetaMaskX402
              ? ' Payment will use MetaMask Flask Advanced Permissions when the endpoint supports ERC-7710.'
            : ` You'll need to sign a payment of ${formatPrice(pricePerRequest)} USDC on Base Sepolia.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Variables inputs */}
        {variablesSchema.length > 0 && (
          <div className="space-y-4">
            <Label className="text-base font-semibold">Variables</Label>
            <div className="grid gap-4 sm:grid-cols-2">
              {variablesSchema.map((variable) => (
                <div key={variable.name} className="space-y-2">
                  <Label htmlFor={variable.name} className="flex items-center gap-2">
                    {variable.name}
                    {variable.required && (
                      <Badge variant="secondary" className="text-xs">Required</Badge>
                    )}
                  </Label>
                  {variable.description && (
                    <p className="text-xs text-muted-foreground">{variable.description}</p>
                  )}
                  <Input
                    id={variable.name}
                    type={variable.type === 'number' ? 'number' : 'text'}
                    value={variables[variable.name] || ''}
                    onChange={(e) => setVariable(variable.name, e.target.value)}
                    placeholder={variable.example ? String(variable.example) : undefined}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Request Body input for POST/PUT/PATCH */}
        {showBodyInput && (
          <div className="space-y-2">
            <Label htmlFor="requestBody" className="text-base font-semibold">
              Request Body
            </Label>
            <p className="text-xs text-muted-foreground">
              {requestBodyTemplate
                ? 'Edit the request body below. Variables in {{brackets}} will be substituted.'
                : 'Enter the JSON request body to send with this request.'}
            </p>
            <Textarea
              id="requestBody"
              value={requestBody}
              onChange={(e) => setRequestBody(e.target.value)}
              placeholder='{"key": "value"}'
              className="font-mono text-sm min-h-[120px]"
            />
          </div>
        )}

        {/* Session Payment Toggle */}
        {canUseWallet && (
          <div className="space-y-3">
            <div className="flex items-center gap-3 p-3 rounded-lg border">
              <input
                type="checkbox"
                id="useMetaMaskX402Api"
                checked={useMetaMaskX402}
                onChange={(e) => {
                  setUseMetaMaskX402(e.target.checked)
                  if (e.target.checked) setUseSession(false)
                }}
                disabled={isLoading || !canUseMetaMaskX402}
                className="size-4 rounded border-input"
              />
              <div className="flex-1">
                <Label
                  htmlFor="useMetaMaskX402Api"
                  className={`flex items-center gap-2 ${canUseMetaMaskX402 ? 'cursor-pointer' : 'cursor-not-allowed opacity-70'}`}
                >
                  <Shield className="size-4" />
                  Use MetaMask Flask
                  <Badge variant="secondary" className="text-xs">
                    ERC-7715
                  </Badge>
                </Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {isOpusDelegated
                    ? 'Unavailable because this account is already delegated to opus AgentDelegator. Use Session Key for this wallet.'
                    : 'Requests an Advanced Permission from MetaMask Flask for ERC-7710 x402 payments.'
                  }
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 p-3 rounded-lg border">
              <input
                type="checkbox"
                id="useSessionApi"
                checked={useSession}
                onChange={(e) => {
                  setUseSession(e.target.checked)
                  if (e.target.checked) setUseMetaMaskX402(false)
                }}
                disabled={isLoading || isLoadingSessions}
                className="size-4 rounded border-input"
              />
              <div className="flex-1">
                <Label htmlFor="useSessionApi" className="flex items-center gap-2 cursor-pointer">
                  <Key className="size-4" />
                  Use Session Key
                  {canUseSession && (
                    <Badge variant="secondary" className="text-xs">
                      No signing
                    </Badge>
                  )}
                </Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {!isSmartAccountEnabled
                    ? 'Enable Smart Account to use session keys'
                    : !activeSession
                      ? 'Create a session to enable auto-payments'
                      : 'Pay without wallet signature using session key'
                  }
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Action button */}
        <div className="flex items-center gap-4">
          <Button
            onClick={handleTryIt}
            disabled={
              isLoading ||
              smartAccountStatus === 'enabling' ||
              (useSession && !useMetaMaskX402 && !activeSession && !isLoadingSessions && isSmartAccountEnabled)
            }
            className="gap-2"
          >
            {smartAccountStatus === 'enabling' ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Enabling Smart Account...
              </>
            ) : (
              getButtonContent()
            )}
          </Button>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 p-4 rounded-lg bg-destructive/10 text-destructive">
            <AlertCircle className="size-5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Response */}
        {response && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-base font-semibold">Response</Label>
              <div className="flex items-center gap-2">
                <Badge
                  variant={response.status >= 200 && response.status < 300 ? 'default' : 'destructive'}
                >
                  {response.status} {response.statusText}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  onClick={handleCopyResponse}
                >
                  {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                </Button>
              </div>
            </div>
            <Textarea
              readOnly
              value={response.body}
              className="font-mono text-sm min-h-[200px]"
            />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
