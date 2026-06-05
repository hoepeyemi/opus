import { NextResponse, type NextRequest } from 'next/server'
import {
  createPublicClient,
  createWalletClient,
  http,
  isAddressEqual,
  type Address,
  type Hex,
} from 'viem'
import { recoverAuthorizationAddress } from 'viem/utils'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'
import { getAgentDelegatorAddress, isAgentDelegatorConfigured } from '@/lib/smartAccount/agentDelegator'
import {
  verifyPayment,
  settlePayment,
  buildPaymentRequirements,
  getUsdcAddress,
} from '@/lib/facilitator'
import { paymentNonceRepository } from '@/lib/repositories'

// Cost to generate a wallet: $0.50 in USDC (6 decimals)
const WALLET_GENERATION_COST = 500000

/**
 * Relay an EIP-7702 enablement transaction.
 *
 * This endpoint allows clients to enable EIP-7702 smart account delegation
 * without needing a wallet that supports authorizationList transactions.
 *
 * REQUIRES x402 PAYMENT: $0.50 to prevent relayer abuse.
 *
 * The client signs the EIP-7702 authorization locally with their new wallet,
 * and this relayer submits the transaction on their behalf.
 *
 * Request body:
 * - targetAddress: The address being delegated (the new wallet)
 * - authorization: The signed EIP-7702 authorization object containing:
 *   - address: The contract address to delegate to (AgentDelegator)
 *   - chainId: The chain ID
 *   - nonce: The authorization nonce
 *   - r, s, yParity: The signature components
 * - chainId: The Base Sepolia chain ID (84532)
 */
export async function POST(request: NextRequest) {
  try {
    // Get relayer key - we'll derive the address from it for payment recipient
    const relayerKey = process.env.FACILITATOR_RELAYER_KEY
    if (!relayerKey) {
      console.error('[Enable7702] FACILITATOR_RELAYER_KEY not configured')
      return NextResponse.json(
        { error: 'Relayer not configured' },
        { status: 500 }
      )
    }

    // Derive relayer address from key - payments go to the relayer
    const relayerAccount = privateKeyToAccount(relayerKey as Hex)
    const paymentRecipient = relayerAccount.address

    // Check for x402 payment header
    const paymentHeaderValue = request.headers.get('X-PAYMENT')
    const paymentChainId = parseInt(process.env.NEXT_PUBLIC_BASE_SEPOLIA_CHAIN_ID || '84532', 10)
    const paymentRequirements = buildPaymentRequirements({
      amount: WALLET_GENERATION_COST,
      asset: getUsdcAddress(paymentChainId),
      recipient: paymentRecipient as Address,
      chainId: paymentChainId,
      description: 'Smart account wallet generation fee',
      mimeType: 'application/json',
      maxTimeoutSeconds: 300,
    })

    // If no payment, return 402 Payment Required
    if (!paymentHeaderValue) {
      console.log('[Enable7702] No payment - returning 402 with requirements')

      return NextResponse.json(
        { paymentRequirements },
        { status: 402 }
      )
    }

    // Verify payment signature
    console.log('[Enable7702] Verifying payment signature...')
    const paymentResult = await verifyPayment(
      paymentHeaderValue,
      WALLET_GENERATION_COST,
      paymentRecipient as Address,
      paymentRequirements
    )

    if (!paymentResult) {
      console.log('[Enable7702] Payment verification failed')
      return NextResponse.json(
        { error: 'Payment verification failed' },
        { status: 402 }
      )
    }

    console.log('[Enable7702] Payment verified for wallet:', paymentResult.address)

    // Parse the request body
    const body = await request.json()

    const { targetAddress, authorization, chainId: bodyChainId } = body

    // Validate required fields
    if (!targetAddress || !authorization) {
      return NextResponse.json(
        { error: 'Missing required fields: targetAddress, authorization' },
        { status: 400 }
      )
    }

    // Validate authorization object
    if (
      !authorization.address ||
      authorization.chainId === undefined ||
      authorization.nonce === undefined ||
      !authorization.r ||
      !authorization.s ||
      authorization.yParity === undefined
    ) {
      return NextResponse.json(
        {
          error:
            'Invalid authorization object. Required: address, chainId, nonce, r, s, yParity',
        },
        { status: 400 }
      )
    }

    console.log('[Enable7702] Received request:', {
      targetAddress,
      authorizationAddress: authorization.address,
      chainId: bodyChainId,
    })

    // Determine chain from body or default to Base Sepolia
    const chainId = bodyChainId || 84532

    if (!isAgentDelegatorConfigured(chainId)) {
      return NextResponse.json(
        {
          error:
            'Base Sepolia AgentDelegator address is not configured. Set NEXT_PUBLIC_BASE_SEPOLIA_AGENT_DELEGATOR_ADDRESS to the deployed AgentDelegator contract.',
        },
        { status: 500 }
      )
    }

    // Verify the authorization is for the correct AgentDelegator contract
    const expectedContract = getAgentDelegatorAddress(chainId)
    if (
      authorization.address.toLowerCase() !== expectedContract.toLowerCase()
    ) {
      return NextResponse.json(
        {
          error: `Authorization is for wrong contract. Expected ${expectedContract}, got ${authorization.address}`,
        },
        { status: 400 }
      )
    }

    // Get chain config
    const chain = baseSepolia
    const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org'

    console.log('[Enable7702] Using chain:', { chainId, rpcUrl })

    // Create clients
    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    })

    const walletClient = createWalletClient({
      account: relayerAccount,
      chain,
      transport: http(rpcUrl),
    })

    // Check if target already has delegation
    const existingCode = await publicClient.getCode({
      address: targetAddress as Address,
    })
    const expectedCode = `0xef0100${expectedContract.slice(2).toLowerCase()}`

    if (existingCode?.toLowerCase() === expectedCode.toLowerCase()) {
      console.log('[Enable7702] Target already has correct delegation - NOT charging')
      // Don't charge if already enabled - no work was done
      return NextResponse.json({
        success: true,
        alreadyEnabled: true,
        message: 'Smart account already enabled',
      })
    }

    console.log('[Enable7702] Submitting 7702 transaction for:', targetAddress)

    // Format the authorization for the transaction
    const formattedAuth = {
      address: authorization.address as Address,
      chainId: authorization.chainId,
      nonce: authorization.nonce,
      r: authorization.r as Hex,
      s: authorization.s as Hex,
      yParity: authorization.yParity,
    }

    const recoveredAuthorizationSigner = await recoverAuthorizationAddress({
      authorization: formattedAuth,
    })

    if (!isAddressEqual(recoveredAuthorizationSigner, targetAddress as Address)) {
      console.error('[Enable7702] Authorization signer mismatch:', {
        recoveredAuthorizationSigner,
        targetAddress,
      })
      return NextResponse.json(
        {
          error:
            'Invalid EIP-7702 authorization. The authorization was not signed by the generated wallet.',
        },
        { status: 400 }
      )
    }

    const targetNonce = await publicClient.getTransactionCount({
      address: targetAddress as Address,
      blockTag: 'pending',
    })

    if (authorization.nonce !== targetNonce) {
      console.error('[Enable7702] Authorization nonce mismatch:', {
        authorizationNonce: authorization.nonce,
        targetNonce,
      })
      return NextResponse.json(
        {
          error:
            'Invalid EIP-7702 authorization nonce. Please try generating the wallet again.',
        },
        { status: 400 }
      )
    }

    const targetBalance = await publicClient.getBalance({
      address: targetAddress as Address,
    })

    if (targetBalance === BigInt(0)) {
      console.log('[Enable7702] Funding generated wallet with 1 wei before delegation')
      const fundingHash = await walletClient.sendTransaction({
        to: targetAddress as Address,
        value: BigInt(1),
      })

      const fundingReceipt = await publicClient.waitForTransactionReceipt({
        hash: fundingHash,
        confirmations: 1,
      })

      if (fundingReceipt.status !== 'success') {
        console.error('[Enable7702] Generated wallet funding transaction failed:', fundingHash)
        return NextResponse.json(
          {
            error:
              'Failed to initialize the generated wallet before EIP-7702 delegation. No USDC payment was settled.',
          },
          { status: 500 }
        )
      }
    }

    // Send the transaction with the authorization list. The authorization list
    // applies the delegation; the transaction target can be any account, so use
    // the relayer itself to avoid executing empty calldata on the new delegated
    // wallet during enablement.
    const hash = await walletClient.sendTransaction({
      to: relayerAccount.address,
      data: '0x',
      authorizationList: [formattedAuth],
      type: 'eip7702',
      gas: BigInt(100000), // EIP-7702 requires extra gas for the authorization list
    })

    console.log('[Enable7702] Transaction submitted:', hash)

    // Wait for confirmation
    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      confirmations: 1,
    })

    console.log('[Enable7702] Transaction confirmed in block:', receipt.blockNumber)

    const tx = await publicClient.getTransaction({ hash })
    const txWithAuthorizationList = tx as typeof tx & {
      authorizationList?: unknown[]
    }
    const minedTxDetails = {
      txHash: receipt.transactionHash,
      type: tx.type,
      authorizationListLength: txWithAuthorizationList.authorizationList?.length ?? 0,
    }
    console.log('[Enable7702] Mined transaction details:', {
      type: minedTxDetails.type,
      authorizationListLength: minedTxDetails.authorizationListLength,
    })

    if (receipt.status === 'reverted') {
      console.error('[Enable7702] Transaction reverted before payment settlement')
      return NextResponse.json(
        { error: 'EIP-7702 transaction reverted. No USDC payment was settled.' },
        { status: 500 }
      )
    }

    // Verify the delegation was applied
    const newCode = await publicClient.getCode({
      address: targetAddress as Address,
    })

    if (newCode?.toLowerCase() !== expectedCode.toLowerCase()) {
      console.error('[Enable7702] Delegation verification failed:', {
        expected: expectedCode,
        actual: newCode,
        minedTxDetails,
      })
      return NextResponse.json(
        {
          error:
            'Delegation was not applied. The EIP-7702 transaction was mined but the generated wallet code was not updated. This usually means the Base Sepolia RPC/network path did not apply the authorization. No USDC payment was settled for this failed enablement.',
          diagnostics: {
            ...minedTxDetails,
            expectedCode,
            actualCode: newCode ?? null,
          },
        },
        { status: 500 }
      )
    }

    console.log('[Enable7702] Delegation verified successfully')

    // Settle the x402 payment only after the smart account is actually enabled.
    console.log('[Enable7702] Settling payment after successful delegation...')
    const settlement = await settlePayment(
      paymentHeaderValue,
      paymentResult.paymentHeader,
      WALLET_GENERATION_COST,
      paymentRecipient as Address,
      paymentRequirements
    )

    if (!settlement) {
      console.error('[Enable7702] Payment settlement failed after delegation')
      return NextResponse.json(
        {
          error:
            'Smart account was enabled, but payment settlement failed. Please contact support with the transaction hash.',
          txHash: receipt.transactionHash,
        },
        { status: 402 }
      )
    }

    console.log('[Enable7702] Payment settled! TxHash:', settlement.txHash)
    await paymentNonceRepository.consume(paymentResult.paymentNonce)

    return NextResponse.json({
      success: true,
      txHash: receipt.transactionHash,
      blockNumber: Number(receipt.blockNumber),
    })
  } catch (error) {
    console.error('[Enable7702] Error:', error)

    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error'

    return NextResponse.json(
      { error: `Failed to enable 7702: ${errorMessage}` },
      { status: 500 }
    )
  }
}
