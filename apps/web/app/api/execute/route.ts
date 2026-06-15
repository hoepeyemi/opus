import { NextResponse, type NextRequest } from 'next/server'
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  type Address,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'
import { agentDelegatorAbi } from '@x402/contracts'
import { getAgentDelegatorAddress } from '@/lib/smartAccount/agentDelegator'

/**
 * Execute a transaction on behalf of a smart account using a session key signature.
 *
 * This endpoint is called by the MCP server to relay signed transactions from
 * session keys to the blockchain. The session key signs the execution data,
 * and this relayer submits it on-chain.
 *
 * Request body:
 * - ownerAddress: The smart account address (delegated via ERC-7702)
 * - sessionId: The session ID (bytes32)
 * - mode: Execution mode (0x00... for single, 0x01... for batch)
 * - executionData: The encoded execution data
 * - signature: Session key signature over the execution
 */
export async function POST(request: NextRequest) {
  try {
    // Read raw body first for debugging
    const rawBody = await request.text()
    console.log('[Execute] Received request, raw body length:', rawBody.length)

    if (!rawBody || rawBody.length === 0) {
      console.error('[Execute] Empty request body received')
      return NextResponse.json(
        { error: 'Empty request body' },
        { status: 400 }
      )
    }

    let body
    try {
      body = JSON.parse(rawBody)
    } catch (parseError) {
      console.error('[Execute] Failed to parse JSON body:', rawBody.slice(0, 200))
      return NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400 }
      )
    }

    const { ownerAddress, sessionId, mode, executionData, signature, chainId: bodyChainId } = body

    // Validate required fields
    if (!ownerAddress || !sessionId || !mode || !executionData || !signature) {
      return NextResponse.json(
        { error: 'Missing required fields: ownerAddress, sessionId, mode, executionData, signature' },
        { status: 400 }
      )
    }

    console.log('[Execute] Received execution request:', {
      ownerAddress,
      sessionId,
      mode,
      executionDataLength: executionData.length,
      signatureLength: signature.length,
      chainId: bodyChainId,
    })

    // Get relayer key from environment
    const relayerKey = process.env.FACILITATOR_RELAYER_KEY
    if (!relayerKey) {
      console.error('[Execute] FACILITATOR_RELAYER_KEY not configured')
      return NextResponse.json(
        { error: 'Relayer not configured' },
        { status: 500 }
      )
    }

    // Determine chain from body or default to Base Sepolia
    const chainId = bodyChainId || 84532

    // Get chain config
    const chain = baseSepolia
    const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org'

    console.log('[Execute] Using chain:', { chainId, rpcUrl })

    // Create clients
    const account = privateKeyToAccount(relayerKey as Hex)

    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    })

    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(rpcUrl),
    })

    const agentDelegatorAddress = getAgentDelegatorAddress(chainId)

    // Encode the relayed executeWithSession call. The outer transaction is
    // sent to AgentDelegator for explorer visibility, and the contract
    // forwards into the delegated owner account for storage/execution.
    const calldata = encodeFunctionData({
      abi: agentDelegatorAbi,
      functionName: 'relayExecuteWithSession',
      args: [
        ownerAddress as Address,
        sessionId as Hex,
        mode as Hex,
        executionData as Hex,
        signature as Hex,
      ],
    })

    console.log('[Execute] Submitting transaction to AgentDelegator:', {
      agentDelegatorAddress,
      ownerAddress,
    })

    // Estimate gas
    const gasEstimate = await publicClient.estimateGas({
      account: account.address,
      to: agentDelegatorAddress,
      data: calldata,
    })

    console.log('[Execute] Gas estimate:', gasEstimate.toString())

    // Submit the transaction
    const hash = await walletClient.sendTransaction({
      to: agentDelegatorAddress,
      data: calldata,
      gas: gasEstimate + (gasEstimate / BigInt(10)), // Add 10% buffer
    })

    console.log('[Execute] Transaction submitted:', hash)

    // Wait for confirmation
    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      confirmations: 1,
    })

    console.log('[Execute] Transaction confirmed in block:', receipt.blockNumber)

    if (receipt.status === 'reverted') {
      return NextResponse.json(
        { error: 'Transaction reverted' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      txHash: receipt.transactionHash,
      blockNumber: Number(receipt.blockNumber),
    })
  } catch (error) {
    console.error('[Execute] Error:', error)

    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    // AgentDelegator custom error selectors
    // 0xe356c1d3 = TargetNotAllowed(uint256 index)
    // 0xbf10e9ba = InvalidSessionKeySignature()
    // 0x6f7eac26 = SessionExpired()
    // 0x2a8c6ead = SelectorNotAllowed(uint256 index)
    // 0x5a2bb6a8 = ValueNotEnough()

    // Try to extract revert reason if available
    if (errorMessage.includes('0xe356c1d3')) {
      // Try to extract the index from the error data
      const match = errorMessage.match(/0xe356c1d3([a-f0-9]{64})/i)
      let indexInfo = ''
      if (match) {
        const index = parseInt(match[1], 16)
        indexInfo = ` (operation index: ${index})`
      }
      console.error('[Execute] TargetNotAllowed error - the target contract is not in the session\'s allowedTargets list')
      return NextResponse.json(
        {
          error: 'permission_denied',
          message: `Target not allowed by session${indexInfo}. The contract address is not in your session key's allowed targets.`,
          code: 'TARGET_NOT_ALLOWED',
          suggestion: 'Re-authorize and add this token to the "Token Approvals for Workflows" scope during OAuth consent.',
        },
        { status: 403 }
      )
    }
    if (errorMessage.includes('0x2a8c6ead')) {
      console.error('[Execute] SelectorNotAllowed error - the function selector is not allowed for this target')
      return NextResponse.json(
        {
          error: 'permission_denied',
          message: 'Function selector not allowed by session. The function you\'re trying to call is not permitted.',
          code: 'SELECTOR_NOT_ALLOWED',
          suggestion: 'Re-authorize with a scope that includes this function.',
        },
        { status: 403 }
      )
    }
    if (errorMessage.includes('0xbf10e9ba')) {
      return NextResponse.json(
        {
          error: 'invalid_signature',
          message: 'Invalid session key signature. The session key signature could not be verified.',
          code: 'INVALID_SIGNATURE',
        },
        { status: 401 }
      )
    }
    if (errorMessage.includes('SessionExpired') || errorMessage.includes('0x6f7eac26')) {
      return NextResponse.json(
        {
          error: 'session_expired',
          message: 'Session has expired. Please re-authorize to get a new session key.',
          code: 'SESSION_EXPIRED',
        },
        { status: 401 }
      )
    }
    if (errorMessage.includes('0x5a2bb6a8')) {
      return NextResponse.json(
        {
          error: 'value_not_enough',
          message: 'Value sent is not enough. The transaction requires more native token (ETH).',
          code: 'VALUE_NOT_ENOUGH',
        },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: `Execution failed: ${errorMessage}` },
      { status: 500 }
    )
  }
}
