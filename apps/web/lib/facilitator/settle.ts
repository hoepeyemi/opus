import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  type Address,
  type Hex,
  type Account,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'
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
import { verifyPayment } from './verify'
import { paymentNonceRepository } from '@/lib/repositories'

/**
 * EIP-3009 ABI for transferWithAuthorization
 */
const USDC_EIP3009_ABI = [
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
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
  },
] as const

/**
 * Calculate the Ethermint/Cronos floor gas based on calldata size.
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

/**
 * Forward settlement to the official Cronos facilitator
 */
async function settleWithOfficialFacilitator(
  facilitatorUrl: string,
  paymentHeaderBase64: string,
  paymentRequirements: PaymentRequirements
): Promise<SettleResult> {
  const settlementRequest = {
    x402Version: 1,
    paymentHeader: paymentHeaderBase64,
    paymentRequirements,
  }

  console.log('[Facilitator] Forwarding settlement to official facilitator:', facilitatorUrl)

  try {
    const response = await fetch(`${facilitatorUrl}/settle`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X402-Version': '1',
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

    if (result.event === 'payment.settled' && result.txHash) {
      return {
        success: true,
        txHash: result.txHash,
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

/**
 * Settle a smart account payment directly on-chain
 */
async function settleSmartAccountPayment(
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

  console.log('[Facilitator] Settling smart account payment:', {
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
      innerSignature,
    ] as const

    // Encode calldata to calculate Ethermint floor gas
    const calldata = encodeFunctionData({
      abi: USDC_EIP3009_ABI,
      functionName: 'transferWithAuthorization',
      args,
    })

    // Calculate floor gas (Ethermint enforces minimum based on calldata size)
    const floorGas = calculateFloorGas(calldata)

    // Get EVM execution gas estimate
    const estimatedGas = await publicClient.estimateContractGas({
      address: payload.asset as Address,
      abi: USDC_EIP3009_ABI,
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
      abi: USDC_EIP3009_ABI,
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
    console.error('[Facilitator] Smart account settlement failed:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Settlement transaction failed',
    }
  }
}

/**
 * Settle a payment
 *
 * - For EOA signatures: Forward to official Cronos facilitator
 * - For smart account signatures: Execute transferWithAuthorization directly
 *
 * Should only be called AFTER target API returns success
 */
export async function settlePayment(
  paymentHeaderBase64: string,
  header: PaymentHeader,
  expectedAmount: number,
  expectedRecipient: Address
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

  if (signatureType === 'eoa' && chainConfig.officialFacilitatorUrl) {
    // First verify with official facilitator
    const paymentRequirements: PaymentRequirements = {
      scheme: 'exact',
      network: chainConfig.name,
      payTo: expectedRecipient,
      asset: header.payload.asset as Address,
      maxAmountRequired: expectedAmount.toString(),
      maxTimeoutSeconds: 300,
      description: 'API access payment',
      mimeType: 'application/json',
    }

    result = await settleWithOfficialFacilitator(
      chainConfig.officialFacilitatorUrl,
      paymentHeaderBase64,
      paymentRequirements
    )
  } else {
    // Settle smart account payment directly
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

    result = await settleSmartAccountPayment(
      walletClient,
      publicClient,
      header,
      feeConfig,
      chain,
      account
    )
  }

  if (!result.success || !result.txHash) {
    console.error('[Facilitator] Settlement failed:', result.error)
    return null
  }

  console.log('[Facilitator] Payment settled! TxHash:', result.txHash)

  return { txHash: result.txHash }
}
