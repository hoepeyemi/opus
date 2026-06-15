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

    const agentDelegatorAddress = getAgentDelegatorAddress(chainId)
    const owner = ownerAddress as Address

    const ownerCode = await publicClient.getCode({ address: owner })
    const expectedDelegationCode = `0xef0100${agentDelegatorAddress.slice(2).toLowerCase()}`

    if (!ownerCode || ownerCode === '0x') {
      return NextResponse.json(
        {
          error:
            `Grant session relay failed: ${owner} is not delegated on Base Sepolia according to the server RPC. ` +
            `Re-enable the smart account, then retry. If the browser says it is enabled, set BASE_SEPOLIA_RPC_URL on the server to the same reliable Base Sepolia RPC used by the web app.`,
          diagnostics: {
            owner,
            expectedAgentDelegator: agentDelegatorAddress,
            actualCode: ownerCode ?? '0x',
            rpcUrl,
          },
        },
        { status: 400 }
      )
    }

    if (ownerCode.toLowerCase() !== expectedDelegationCode) {
      return NextResponse.json(
        {
          error:
            `Grant session relay failed: ${owner} is delegated to a different implementation. ` +
            `Re-enable this wallet with the configured Base Sepolia AgentDelegator address.`,
          diagnostics: {
            owner,
            expectedAgentDelegator: agentDelegatorAddress,
            actualDelegationCode: ownerCode,
            rpcUrl,
          },
        },
        { status: 400 }
      )
    }

    const serverNonce = await publicClient.readContract({
      address: owner,
      abi: agentDelegatorAbi,
      functionName: 'getSessionNonce',
    })

    if (serverNonce !== BigInt(nonce)) {
      return NextResponse.json(
        {
          error:
            `Grant session relay failed: stale session nonce. The browser signed nonce ${nonce}, but the server RPC sees nonce ${serverNonce.toString()}. Refresh and try authorizing again.`,
          diagnostics: {
            owner,
            signedNonce: nonce.toString(),
            serverNonce: serverNonce.toString(),
            rpcUrl,
          },
        },
        { status: 409 }
      )
    }

    const relayGrant = {
      sessionKey: sessionKeyAddress as Address,
      allowedTargets: allowedTargets as Address[],
      allowedSelectors: allowedSelectors as Hex[],
      validAfter,
      validUntil,
      approvedContracts: approvedContracts as {
        contractAddress: Address
        nameHash: Hex
        versionHash: Hex
      }[],
      nonce: BigInt(nonce),
      ownerSignature: ownerSignature as Hex,
    }
    const calldata = signatureScheme === 'message'
      ? encodeFunctionData({
        abi: agentDelegatorAbi,
        functionName: 'relayGrantSessionWithMessageSignature',
        args: [ownerAddress as Address, relayGrant],
      })
      : encodeFunctionData({
        abi: agentDelegatorAbi,
        functionName: 'relayGrantSessionWithSignature',
        args: [ownerAddress as Address, relayGrant],
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
      to: agentDelegatorAddress,
      data: calldata,
    })

    const hash = await walletClient.sendTransaction({
      to: agentDelegatorAddress,
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
