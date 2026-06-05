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

export async function POST(request: NextRequest) {
  try {
    const relayerKey = process.env.FACILITATOR_RELAYER_KEY
    if (!relayerKey) {
      console.error('[GrantSessionRelayer] FACILITATOR_RELAYER_KEY not configured')
      return NextResponse.json(
        { error: 'Relayer not configured' },
        { status: 500 }
      )
    }

    const body = await request.json()
    const {
      ownerAddress,
      sessionKeyAddress,
      allowedTargets,
      allowedSelectors,
      validAfter,
      validUntil,
      approvedContracts,
      nonce,
      ownerSignature,
      signatureScheme = 'typedData',
      chainId: bodyChainId,
    } = body

    if (
      !ownerAddress ||
      !sessionKeyAddress ||
      !Array.isArray(allowedTargets) ||
      !Array.isArray(allowedSelectors) ||
      validAfter === undefined ||
      validUntil === undefined ||
      !Array.isArray(approvedContracts) ||
      nonce === undefined ||
      !ownerSignature
    ) {
      return NextResponse.json(
        { error: 'Missing required grant session fields' },
        { status: 400 }
      )
    }

    const chainId = bodyChainId || 84532
    if (chainId !== baseSepolia.id) {
      return NextResponse.json(
        { error: `Unsupported chain: ${chainId}` },
        { status: 400 }
      )
    }

    const account = privateKeyToAccount(relayerKey as Hex)
    const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org'

    const publicClient = createPublicClient({
      chain: baseSepolia,
      transport: http(rpcUrl),
    })

    const walletClient = createWalletClient({
      account,
      chain: baseSepolia,
      transport: http(rpcUrl),
    })

    const calldata = encodeFunctionData({
      abi: agentDelegatorAbi,
      functionName: signatureScheme === 'message'
        ? 'grantSessionWithMessageSignature'
        : 'grantSessionWithSignature',
      args: [
        sessionKeyAddress as Address,
        allowedTargets as Address[],
        allowedSelectors as Hex[],
        validAfter,
        validUntil,
        approvedContracts as {
          contractAddress: Address
          nameHash: Hex
          versionHash: Hex
        }[],
        BigInt(nonce),
        ownerSignature as Hex,
      ],
    })

    console.log('[GrantSessionRelayer] Submitting grantSessionWithSignature:', {
      ownerAddress,
      sessionKeyAddress,
      allowedTargets: allowedTargets.length,
      allowedSelectors: allowedSelectors.length,
      approvedContracts: approvedContracts.length,
      nonce,
      chainId,
      signatureScheme,
    })

    const gasEstimate = await publicClient.estimateGas({
      account: account.address,
      to: ownerAddress as Address,
      data: calldata,
    })

    const hash = await walletClient.sendTransaction({
      to: ownerAddress as Address,
      data: calldata,
      gas: gasEstimate + gasEstimate / BigInt(10),
    })

    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      confirmations: 1,
    })

    if (receipt.status !== 'success') {
      return NextResponse.json(
        { error: 'Grant session transaction reverted', txHash: receipt.transactionHash },
        { status: 500 }
      )
    }

    return NextResponse.json({
      txHash: receipt.transactionHash,
      blockNumber: Number(receipt.blockNumber),
    })
  } catch (error) {
    console.error('[GrantSessionRelayer] Error:', error)

    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    if (
      errorMessage.includes('Execution reverted for an unknown reason') &&
      errorMessage.includes('Estimate Gas Arguments') &&
      errorMessage.includes('0xf4f1bbbf')
    ) {
      return NextResponse.json(
        {
          error:
            'Grant session relay failed: the delegated AgentDelegator contract does not appear to support message-signature session grants. Redeploy AgentDelegator, update NEXT_PUBLIC_BASE_SEPOLIA_AGENT_DELEGATOR_ADDRESS, restart the web server, then generate or redelegate a smart account wallet.',
        },
        { status: 500 }
      )
    }

    return NextResponse.json(
      { error: `Grant session relay failed: ${errorMessage}` },
      { status: 500 }
    )
  }
}
