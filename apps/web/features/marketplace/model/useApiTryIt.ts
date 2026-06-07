'use client'

import { useState, useCallback } from 'react'
import { useSignTypedData, useConnection, usePublicClient, useWalletClient } from 'wagmi'
import type { Address } from 'viem'
import type { VariableDefinition, VariableType } from '@/features/proxy/model/variables'
import {
  createMetaMaskX402PaymentSignature,
  type MetaMaskX402Requirements,
} from '@/lib/metamask/x402'
import {
  EIP3009_TYPES,
  buildUsdcDomain,
  buildEIP3009Message,
  buildPaymentHeader,
  encodePaymentHeader,
  parseChainId,
} from '@/lib/x402/client'

/**
 * Payment requirements per x402 spec.
 * Received in 402 response body
 */
interface PaymentRequirements {
  scheme: string
  network: string
  amount?: string
  payTo: Address
  asset: Address
  maxAmountRequired: string
  maxTimeoutSeconds: number
  description?: string
  mimeType?: string
  extra?: {
    assetTransferMethod?: string
    facilitators?: Address[]
    [key: string]: unknown
  }
}

interface ApiResponse {
  status: number
  statusText: string
  body: string
  headers: Record<string, string>
}

interface UseApiTryItOptions {
  proxyUrl: string
  httpMethod: string
  variablesSchema: VariableDefinition[]
  /** Request body template to pre-populate the body field */
  requestBodyTemplate?: string | null
  /** Optional session ID for session key signing */
  sessionId?: string
  /** Whether to use session key signing */
  useSessionKey?: boolean
  /** Whether to use MetaMask Flask Advanced Permissions for ERC-7710 x402 payments */
  useMetaMaskX402?: boolean
}

interface UseApiTryItReturn {
  variables: Record<string, string>
  setVariable: (name: string, value: string) => void
  requestBody: string
  setRequestBody: (body: string) => void
  isLoading: boolean
  response: ApiResponse | null
  error: string | null
  executeRequest: () => Promise<void>
}

/**
 * Convert string input to the appropriate type based on schema
 */
function convertToType(value: string, type: VariableType): unknown {
  if (value === '') return undefined

  switch (type) {
    case 'number':
      const num = Number(value)
      return isNaN(num) ? value : num
    case 'boolean':
      return value.toLowerCase() === 'true'
    case 'array':
      try {
        const parsed = JSON.parse(value)
        return Array.isArray(parsed) ? parsed : [value]
      } catch {
        return value.split(',').map(s => s.trim()).filter(s => s !== '')
      }
    case 'object':
      try {
        return JSON.parse(value)
      } catch {
        return value
      }
    default:
      return value
  }
}

/**
 * Convert all variables to their proper types based on schema
 */
function convertVariables(
  variables: Record<string, string>,
  schema: VariableDefinition[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const schemaMap = new Map(schema.map(s => [s.name, s]))

  for (const [name, value] of Object.entries(variables)) {
    const def = schemaMap.get(name)
    if (def) {
      const converted = convertToType(value, def.type)
      if (converted !== undefined) {
        result[name] = converted
      }
    } else {
      if (value !== '') {
        result[name] = value
      }
    }
  }

  return result
}

/**
 * Hook for executing API requests with x402 payment
 * Handles EIP-3009 TransferWithAuthorization signing
 */
export function useApiTryIt({
  proxyUrl,
  httpMethod,
  variablesSchema,
  requestBodyTemplate,
  sessionId,
  useSessionKey = false,
  useMetaMaskX402 = false,
}: UseApiTryItOptions): UseApiTryItReturn {
  const { address, chainId } = useConnection()
  const { mutateAsync: signTypedData } = useSignTypedData()
  const publicClient = usePublicClient()
  const { data: walletClient } = useWalletClient()

  const [variables, setVariables] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    variablesSchema.forEach((v) => {
      if (v.default !== undefined) {
        initial[v.name] = String(v.default)
      } else if (v.example !== undefined) {
        initial[v.name] = String(v.example)
      } else {
        initial[v.name] = ''
      }
    })
    return initial
  })

  // Initialize request body with template if provided
  const [requestBody, setRequestBody] = useState<string>(requestBodyTemplate || '')

  const [isLoading, setIsLoading] = useState(false)
  const [response, setResponse] = useState<ApiResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const setVariable = useCallback((name: string, value: string) => {
    setVariables(prev => ({ ...prev, [name]: value }))
  }, [])

  /**
   * Sign EIP-3009 TransferWithAuthorization using session key via server
   */
  const createSessionPaymentHeader = useCallback(async (
    requirements: PaymentRequirements,
    from: Address
  ): Promise<string> => {
    if (!sessionId) {
      throw new Error('Session ID required for session signing')
    }

    const { payTo, asset, maxAmountRequired, maxTimeoutSeconds, network } = requirements
    const reqChainId = parseChainId(network)

    // Build EIP-3009 message
    const message = buildEIP3009Message({
      from,
      to: payTo,
      value: BigInt(maxAmountRequired),
      validitySeconds: maxTimeoutSeconds,
    })

    // Request signature from server using session key
    const signResponse = await fetch(`/api/sessions/${sessionId}/sign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: payTo,
        value: maxAmountRequired,
        validAfter: Number(message.validAfter),
        validBefore: Number(message.validBefore),
        nonce: message.nonce,
        chainId: reqChainId,
        tokenAddress: asset,
      }),
    })

    if (!signResponse.ok) {
      const err = await signResponse.json()
      throw new Error(err.error || 'Failed to sign with session key')
    }

    const { signature } = await signResponse.json()

    // Build payment header with session signature (149 bytes)
    const header = buildPaymentHeader({
      message,
      signature,
      asset,
      chainId: reqChainId,
    })

    return encodePaymentHeader(header)
  }, [sessionId])

  /**
   * Sign EIP-3009 TransferWithAuthorization with wallet
   * Per x402 exact payment flow, sign the payment requirements returned by the proxy.
   */
  const createWalletPaymentHeader = useCallback(async (
    requirements: PaymentRequirements,
    from: Address
  ): Promise<string> => {
    const { payTo, asset, maxAmountRequired, maxTimeoutSeconds, network } = requirements
    const reqChainId = parseChainId(network)

    // Build EIP-712 domain using shared utility
    const domain = buildUsdcDomain(asset, reqChainId)

    // Build EIP-3009 message using shared utility
    const message = buildEIP3009Message({
      from,
      to: payTo,
      value: BigInt(maxAmountRequired),
      validitySeconds: maxTimeoutSeconds,
    })

    const signature = await signTypedData({
      domain,
      types: EIP3009_TYPES,
      primaryType: 'TransferWithAuthorization',
      message,
    })

    // Build payment header using shared utility
    const header = buildPaymentHeader({
      message,
      signature,
      asset,
      chainId: reqChainId,
    })

    // Encode to base64 using shared utility
    return encodePaymentHeader(header)
  }, [signTypedData])

  /**
   * Create an ERC-7710 x402 payment payload using MetaMask Flask Advanced Permissions.
   */
  const createMetaMaskPaymentHeader = useCallback(async (
    requirements: PaymentRequirements
  ): Promise<string> => {
    if (!publicClient || !walletClient) {
      throw new Error('MetaMask Flask Advanced Permissions require a connected wallet client')
    }

    return createMetaMaskX402PaymentSignature({
      requirements: requirements as MetaMaskX402Requirements,
      publicClient,
      walletClient,
    })
  }, [publicClient, walletClient])

  /**
   * Create payment header using wallet or session key based on configuration
   */
  const createPaymentHeader = useCallback(async (
    requirements: PaymentRequirements,
    from: Address
  ): Promise<string> => {
    if (useMetaMaskX402) {
      return createMetaMaskPaymentHeader(requirements)
    }
    if (useSessionKey && sessionId) {
      return createSessionPaymentHeader(requirements, from)
    }
    return createWalletPaymentHeader(requirements, from)
  }, [
    useMetaMaskX402,
    useSessionKey,
    sessionId,
    createMetaMaskPaymentHeader,
    createSessionPaymentHeader,
    createWalletPaymentHeader,
  ])

  const decodePaymentRequiredHeader = useCallback((value: string): PaymentRequirements | null => {
    try {
      const bytes = Uint8Array.from(window.atob(value), (char) => char.charCodeAt(0))
      const decoded = JSON.parse(new TextDecoder().decode(bytes)) as {
        accepts?: PaymentRequirements[]
      }

      return decoded.accepts?.[0] ?? null
    } catch {
      return null
    }
  }, [])

  const extractPaymentRequirements = useCallback(async (
    initialResponse: Response
  ): Promise<PaymentRequirements> => {
    const paymentRequiredHeader = useMetaMaskX402
      ? initialResponse.headers.get('PAYMENT-REQUIRED')
      : null
    const headerRequirements = paymentRequiredHeader
      ? decodePaymentRequiredHeader(paymentRequiredHeader)
      : null

    if (headerRequirements) {
      return {
        ...headerRequirements,
        maxAmountRequired: headerRequirements.maxAmountRequired ?? headerRequirements.amount ?? '0',
      }
    }

    if (useMetaMaskX402) {
      throw new Error(
        'This API did not advertise MetaMask Flask Advanced Permissions support. Check METAMASK_X402_FACILITATOR_URL and METAMASK_X402_FACILITATORS, or turn off "Use MetaMask Flask".'
      )
    }

    const responseData = await initialResponse.json()
    const { paymentRequirements } = responseData

    if (
      !paymentRequirements ||
      !paymentRequirements.payTo ||
      !paymentRequirements.asset ||
      (!paymentRequirements.maxAmountRequired && !paymentRequirements.amount)
    ) {
      throw new Error('Invalid payment requirements from server')
    }

    return {
      scheme: paymentRequirements.scheme,
      network: paymentRequirements.network,
      amount: paymentRequirements.amount,
      payTo: paymentRequirements.payTo as Address,
      asset: paymentRequirements.asset as Address,
      maxAmountRequired: paymentRequirements.maxAmountRequired ?? paymentRequirements.amount,
      maxTimeoutSeconds: paymentRequirements.maxTimeoutSeconds ?? 300,
      description: paymentRequirements.description,
      mimeType: paymentRequirements.mimeType,
      extra: paymentRequirements.extra,
    }
  }, [decodePaymentRequiredHeader, useMetaMaskX402])

  /**
   * Execute the API request with x402 payment flow
   */
  const executeRequest = useCallback(async () => {
    if (!address) {
      setError('Wallet not connected')
      return
    }

    setIsLoading(true)
    setError(null)
    setResponse(null)

    try {
      const typedVariables = convertVariables(variables, variablesSchema)

      // Determine if we should send a body (POST, PUT, PATCH)
      const shouldSendBody = ['POST', 'PUT', 'PATCH'].includes(httpMethod.toUpperCase())

      // Step 1: Make initial request to get payment requirements
      const initialResponse = await fetch(proxyUrl, {
        method: httpMethod,
        headers: {
          'Content-Type': 'application/json',
          'X-Variables': JSON.stringify(typedVariables),
        },
        ...(shouldSendBody && requestBody ? { body: requestBody } : {}),
      })

      // If not 402, the request went through without payment
      if (initialResponse.status !== 402) {
        const body = await initialResponse.text()
        setResponse({
          status: initialResponse.status,
          statusText: initialResponse.statusText,
          body,
          headers: Object.fromEntries(initialResponse.headers.entries()),
        })
        return
      }

      // Step 2: Extract payment requirements from a standard header or this app's JSON body.
      const requirements = await extractPaymentRequirements(initialResponse)

      // Step 3: Create signed payment header
      const paymentHeaderBase64 = await createPaymentHeader(requirements, address)

      // Step 4: Make the actual request with payment
      const paidResponse = await fetch(proxyUrl, {
        method: httpMethod,
        headers: {
          'Content-Type': 'application/json',
          'X-Variables': JSON.stringify(typedVariables),
          [useMetaMaskX402 ? 'PAYMENT-SIGNATURE' : 'X-PAYMENT']: paymentHeaderBase64,
        },
        ...(shouldSendBody && requestBody ? { body: requestBody } : {}),
      })

      const body = await paidResponse.text()

      setResponse({
        status: paidResponse.status,
        statusText: paidResponse.statusText,
        body,
        headers: Object.fromEntries(paidResponse.headers.entries()),
      })
    } catch (err) {
      console.error('[x402 Client] API request failed:', err)
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setIsLoading(false)
    }
  }, [
    address,
    variables,
    variablesSchema,
    proxyUrl,
    httpMethod,
    requestBody,
    createPaymentHeader,
    extractPaymentRequirements,
    useMetaMaskX402,
  ])

  return {
    variables,
    setVariable,
    requestBody,
    setRequestBody,
    isLoading,
    response,
    error,
    executeRequest,
  }
}
