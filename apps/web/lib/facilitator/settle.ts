import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  http,
  parseSignature,
  type Address,
  type Hex,
  type Account,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'
import { USDC_CONFIG } from '@x402/payment'
import type {
  PaymentHeader,
  PaymentRequirements,
  SettleResult,
  FeeConfig,
} from './types'
import { detectSignatureType } from './detect'
import { unwrapEIP6492 } from './unwrap'
import { getChainConfig, parseChainId } from './chains'
import { getDefaultFeeConfig, calculateNetAmount } from './fee'
import { paymentNonceRepository } from '@/lib/repositories'

/**
 * EIP-3009 ABI for transferWithAuthorization
 */
const USDC_TRANSFER_AUTHORIZATION_ABI = [
  {
    name: 'transferWithAuthorization',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
      { name: 'v', type: 'uint8' },
      { name: 'r', type: 'bytes32' },
      { name: 's', type: 'bytes32' },
    ],
    outputs: [],
  },
] as const

/**
 * Calculate a conservative calldata-based gas floor.
 * Ethermint enforces a minimum gas based on transaction data (EIP-2028):
 * - 4 gas per zero byte
 * - 16 gas per non-zero byte
 * - Plus 21000 base transaction gas
 */
function calculateFloorGas(calldata: Hex): bigint {
  const data = calldata.slice(2) // Remove '0x' prefix
  let calldataGas = BigInt(0)

  for (let i = 0; i < data.length; i += 2) {
    const byte = parseInt(data.slice(i, i + 2), 16)
    calldataGas += byte === 0 ? BigInt(4) : BigInt(16)
  }

  const baseTxGas = BigInt(21000)
  return baseTxGas + calldataGas
}

/**
 * Get the viem chain object for a chain ID
 */
function getViemChain(chainId: number) {
  if (chainId === 84532) return baseSepolia
  throw new Error(`Unsupported chain: ${chainId}`)
}

type SettlementChain = ReturnType<typeof getViemChain>
type SettlementPublicClient = Pick<
  ReturnType<typeof createPublicClient>,
  'estimateContractGas' | 'waitForTransactionReceipt'
>
type SettlementWalletClient = Pick<
  ReturnType<typeof createWalletClient>,
  'writeContract'
>

function usesPaymentPayloadRequest(facilitatorUrl: string): boolean {
  return facilitatorUrl.includes('dev-api.cx.metamask.io')
    || facilitatorUrl.includes('x402.org/facilitator')
}

function withEip712Domain(
  requirements: PaymentRequirements,
  chainId: number
): PaymentRequirements {
  const tokenConfig = USDC_CONFIG[chainId as keyof typeof USDC_CONFIG]

  return {
    ...requirements,
    // x402 facilitators expect the canonical CAIP-2 network id.
    network: `eip155:${chainId}`,
    amount: requirements.amount ?? requirements.maxAmountRequired,
    extra: {
      ...requirements.extra,
      name: tokenConfig?.domainName ?? 'USDC',
      version: tokenConfig?.domainVersion ?? '2',
    },
  }
}

async function getSettlementDiagnostics(
  header: PaymentHeader,
  chainId: number,
  rpcUrl: string,
  expectedRecipient: Address,
  expectedAmount: number
) {
  const publicClient = createPublicClient({
    chain: getViemChain(chainId),
    transport: http(rpcUrl),
  })

  try {
    const [balance, decimalsResult, symbolResult] = await Promise.all([
      publicClient.readContract({
        address: header.payload.asset as Address,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [header.payload.from as Address],
      }),
      publicClient.readContract({
        address: header.payload.asset as Address,
        abi: erc20Abi,
        functionName: 'decimals',
      }).catch(() => 6),
      publicClient.readContract({
        address: header.payload.asset as Address,
        abi: erc20Abi,
        functionName: 'symbol',
      }).catch(() => 'USDC'),
    ])
    const decimals = typeof decimalsResult === 'number' ? decimalsResult : 6
    const symbol = typeof symbolResult === 'string' ? symbolResult : 'USDC'
    const requiredAmount = BigInt(header.payload.value)

    return {
      payer: header.payload.from,
      recipient: header.payload.to,
      expectedRecipient,
      asset: header.payload.asset,
      chainId,
      headerAmount: header.payload.value,
      expectedAmount: expectedAmount.toString(),
      headerAmountFormatted: `${formatUnits(requiredAmount, decimals)} ${symbol}`,
      payerBalance: balance.toString(),
      payerBalanceFormatted: `${formatUnits(balance, decimals)} ${symbol}`,
      hasEnoughBalance: balance >= requiredAmount,
      validAfter: header.payload.validAfter,
      validBefore: header.payload.validBefore,
      nonce: header.payload.nonce,
    }
  } catch (error) {
    return {
      payer: header.payload.from,
      recipient: header.payload.to,
      expectedRecipient,
      asset: header.payload.asset,
      chainId,
      headerAmount: header.payload.value,
      expectedAmount: expectedAmount.toString(),
      diagnosticsError: error instanceof Error ? error.message : String(error),
    }
  }
}

function toFacilitatorPaymentPayload(
  header: PaymentHeader,
  paymentRequirements: PaymentRequirements
) {
  return {
    x402Version: 2,
    accepted: paymentRequirements,
    payload: {
      signature: header.payload.signature,
      authorization: {
        from: header.payload.from,
        to: header.payload.to,
        value: header.payload.value,
        validAfter: header.payload.validAfter.toString(),
        validBefore: header.payload.validBefore.toString(),
        nonce: header.payload.nonce,
      },
    },
  }
}

/**
 * Forward settlement to the configured x402 facilitator.
 */
async function settleWithOfficialFacilitator(
  facilitatorUrl: string,
  paymentHeaderBase64: string,
  paymentRequirements: PaymentRequirements
): Promise<SettleResult> {
  const chainId = parseChainId(paymentRequirements.network)
  const facilitatorPaymentRequirements = usesPaymentPayloadRequest(facilitatorUrl)
    ? withEip712Domain(paymentRequirements, chainId)
    : paymentRequirements
  const paymentPayload = usesPaymentPayloadRequest(facilitatorUrl)
    ? toFacilitatorPaymentPayload(
      JSON.parse(Buffer.from(paymentHeaderBase64, 'base64').toString('utf8')) as PaymentHeader,
      facilitatorPaymentRequirements
    )
    : null
  const x402Version = paymentPayload?.x402Version ?? 1
  const settlementRequest = paymentPayload
    ? {
      x402Version,
      paymentPayload,
      paymentRequirements: facilitatorPaymentRequirements,
    }
    : {
      x402Version,
      paymentHeader: paymentHeaderBase64,
      paymentRequirements: facilitatorPaymentRequirements,
    }

  console.log('[Facilitator] Forwarding settlement to official facilitator:', facilitatorUrl)

  try {
    const response = await fetch(`${facilitatorUrl}/settle`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X402-Version': x402Version.toString(),
      },
      body: JSON.stringify(settlementRequest),
    })

    const responseText = await response.text()
    console.log('[Facilitator] Official facilitator settlement response:', responseText)

    if (!response.ok) {
      return {
        success: false,
        error: `Settlement failed: ${response.status} ${responseText}`,
      }
    }

    const result = JSON.parse(responseText)
    const txHash = findTransactionHash(result.txHash)
      ?? findTransactionHash(result.transactionHash)
      ?? findTransactionHash(result.tx)
      ?? findTransactionHash(result)

    if ((result.event === 'payment.settled' || result.success !== false) && txHash) {
      return {
        success: true,
        txHash,
      }
    }

    if (result.success === false) {
      return {
        success: false,
        error: [
          result.errorReason,
          result.errorMessage ?? result.error,
        ].filter(Boolean).join(': ') || 'Facilitator settlement failed',
      }
    }

    return {
      success: false,
      error: 'Unexpected facilitator response',
    }
  } catch (error) {
    console.error('[Facilitator] Official facilitator settlement failed:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Settlement request failed',
    }
  }
}

function findTransactionHash(value: unknown): Hex | null {
  if (typeof value === 'string' && /^0x[a-fA-F0-9]{64}$/.test(value)) {
    return value as Hex
  }

  if (!value || typeof value !== 'object') {
    return null
  }

  for (const candidate of Object.values(value as Record<string, unknown>)) {
    const txHash = findTransactionHash(candidate)
    if (txHash) {
      return txHash
    }
  }

  return null
}

/**
 * Settle an EIP-3009 payment directly on-chain.
 */
async function settlePaymentOnChain(
  walletClient: SettlementWalletClient,
  publicClient: SettlementPublicClient,
  header: PaymentHeader,
  feeConfig: FeeConfig,
  chain: SettlementChain,
  account: Account
): Promise<SettleResult> {
  const payload = header.payload

  // Unwrap EIP-6492 to get inner signature
  const innerSignature = unwrapEIP6492(payload.signature as Hex)

  // Calculate fee (for logging, we'll collect it in a future iteration)
  const amount = BigInt(payload.value)
  const { netAmount, fee } = calculateNetAmount(amount, feeConfig)
  const { r, s, yParity } = parseSignature(innerSignature)
  const v = yParity === 1 ? 28 : 27

  console.log('[Facilitator] Settling EIP-3009 payment on-chain:', {
    from: payload.from,
    to: payload.to,
    amount: amount.toString(),
    fee: fee.toString(),
    netAmount: netAmount.toString(),
    innerSignatureLength: innerSignature.length,
  })

  try {
    // Execute transferWithAuthorization directly
    // Note: For hackathon, we send full amount to recipient
    // Fee collection would be done in a separate step or via a splitter contract
    const args = [
      payload.from as Address,
      payload.to as Address,
      amount,
      BigInt(payload.validAfter),
      BigInt(payload.validBefore),
      payload.nonce as Hex,
      v,
      r,
      s,
    ] as const

    // Encode calldata to calculate Ethermint floor gas
    const calldata = encodeFunctionData({
      abi: USDC_TRANSFER_AUTHORIZATION_ABI,
      functionName: 'transferWithAuthorization',
      args,
    })

    // Calculate floor gas (Ethermint enforces minimum based on calldata size)
    const floorGas = calculateFloorGas(calldata)

    // Get EVM execution gas estimate
    const estimatedGas = await publicClient.estimateContractGas({
      address: payload.asset as Address,
      abi: USDC_TRANSFER_AUTHORIZATION_ABI,
      functionName: 'transferWithAuthorization',
      args,
      account: account.address,
    })

    // Use the higher of floor gas or estimated gas
    const gasLimit = estimatedGas > floorGas ? estimatedGas : floorGas

    console.log('[Facilitator] Gas calculation:', {
      floorGas: floorGas.toString(),
      estimatedGas: estimatedGas.toString(),
      gasLimit: gasLimit.toString(),
    })

    const hash = await walletClient.writeContract({
      chain,
      account,
      address: payload.asset as Address,
      abi: USDC_TRANSFER_AUTHORIZATION_ABI,
      functionName: 'transferWithAuthorization',
      args,
      gas: gasLimit,
    })

    console.log('[Facilitator] Settlement transaction submitted:', hash)

    // Wait for confirmation
    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      confirmations: 1,
    })

    console.log('[Facilitator] Settlement confirmed in block:', receipt.blockNumber)

    return {
      success: true,
      txHash: receipt.transactionHash,
    }
  } catch (error) {
    console.error('[Facilitator] On-chain payment settlement failed:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Settlement transaction failed',
    }
  }
}

/**
 * Settle a payment
 *
 * - For EOA signatures: Forward to the configured x402 facilitator
 * - For smart account signatures: Execute transferWithAuthorization directly
 *
 * Should only be called AFTER target API returns success
 */
export async function settlePayment(
  paymentHeaderBase64: string,
  header: PaymentHeader,
  expectedAmount: number,
  expectedRecipient: Address,
  paymentRequirementsOverride?: Partial<PaymentRequirements>
): Promise<{ txHash: Hex } | null> {
  const chainId = parseChainId(header.network)
  const chainConfig = getChainConfig(chainId)

  if (!chainConfig) {
    console.error('[Facilitator] Unsupported chain for settlement:', chainId)
    return null
  }

  // Detect signature type
  const signatureType = detectSignatureType(header.payload.signature as Hex)

  console.log('[Facilitator] Settling payment:', {
    signatureType,
    chainId,
    from: header.payload.from,
    to: header.payload.to,
    amount: header.payload.value,
  })

  let result: SettleResult

  if (signatureType === 'eoa') {
    // Settle standard EOA EIP-3009 payments directly. This avoids facilitator
    // metadata mismatches and uses the signed authorization exactly as-is.
    const relayerKey = process.env.FACILITATOR_RELAYER_KEY

    if (!relayerKey) {
      console.error('[Facilitator] FACILITATOR_RELAYER_KEY not configured')
      return null
    }

    const chain = getViemChain(chainId)
    const account = privateKeyToAccount(relayerKey as Hex)

    const publicClient = createPublicClient({
      chain,
      transport: http(chainConfig.rpcUrl),
    })

    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(chainConfig.rpcUrl),
    })

    const feeConfig = getDefaultFeeConfig()

    result = await settlePaymentOnChain(
      walletClient,
      publicClient,
      header,
      feeConfig,
      chain,
      account
    )
  } else if (chainConfig.officialFacilitatorUrl) {
    const canonicalNetwork = `eip155:${chainId}`
    const paymentRequirements: PaymentRequirements = {
      scheme: 'exact',
      network: canonicalNetwork,
      payTo: expectedRecipient,
      asset: header.payload.asset as Address,
      amount: expectedAmount.toString(),
      maxAmountRequired: expectedAmount.toString(),
      maxTimeoutSeconds: 300,
      description: 'API access payment',
      mimeType: 'application/json',
      ...paymentRequirementsOverride,
    }

    result = await settleWithOfficialFacilitator(
      chainConfig.officialFacilitatorUrl,
      paymentHeaderBase64,
      paymentRequirements
    )
  } else {
    console.error('[Facilitator] Smart account settlement requires X402_FACILITATOR_URL')
    return null
  }

  if (!result.success || !result.txHash) {
    console.error('[Facilitator] Settlement failed:', result.error)
    console.error('[Facilitator] Settlement diagnostics:', await getSettlementDiagnostics(
      header,
      chainId,
      chainConfig.rpcUrl,
      expectedRecipient,
      expectedAmount
    ))
    return null
  }

  console.log('[Facilitator] Payment settled! TxHash:', result.txHash)

  return { txHash: result.txHash }
}
