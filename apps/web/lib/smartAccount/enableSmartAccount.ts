import type { WalletClient, PublicClient, Address, Hash, Hex } from 'viem'
import { numberToHex } from 'viem'

export interface EnableSmartAccountParams {
  walletClient: WalletClient
  publicClient: PublicClient
  contractAddress: Address
}

export interface EnableSmartAccountResult {
  hash: Hash
  success: boolean
}

export interface EnableSmartAccountError {
  success: false
  error: 'wallet_unsupported' | 'chain_unsupported' | 'transaction_failed' | 'unknown'
  message: string
}

interface SignedAuthorization {
  address: Address
  chainId: number
  nonce: number
  r: Hex
  s: Hex
  yParity: number
}

/**
 * Enable ERC-7702 smart account by delegating the EOA to our AgentDelegator contract
 *
 * This function:
 * 1. Signs an ERC-7702 authorization (allows the EOA to delegate execution to the contract)
 * 2. Sends a transaction with the authorization list to enable the delegation
 *
 * After this transaction, the EOA's code will be set to 0xef0100 + contractAddress,
 * and all calls to the EOA will be executed by the AgentDelegator contract.
 *
 * Note: EIP-7702 requires wallet support. Currently supported by:
 * - Rabby (with experimental features enabled)
 * - Some other wallets that implement wallet_signAuthorization
 *
 * @param params.walletClient - Connected wallet client
 * @param params.publicClient - Public client for chain interactions
 * @param params.contractAddress - AgentDelegator contract address to delegate to
 */
export async function enableSmartAccount({
  walletClient,
  publicClient,
  contractAddress,
}: EnableSmartAccountParams): Promise<EnableSmartAccountResult | EnableSmartAccountError> {
  const account = walletClient.account

  if (!account) {
    return {
      success: false,
      error: 'unknown',
      message: 'Wallet not connected',
    }
  }

  const chainId = walletClient.chain?.id
  if (!chainId) {
    return {
      success: false,
      error: 'unknown',
      message: 'Chain not connected',
    }
  }

  try {
    // Get the current nonce for the account
    const nonce = await publicClient.getTransactionCount({
      address: account.address,
    })

    console.log('[enableSmartAccount] Preparing authorization:', {
      contractAddress,
      chainId,
      nonce,
    })

    // Step 1: Sign authorization using wallet_signAuthorization RPC
    // This is the experimental EIP-7702 RPC method that wallets need to implement
    let authorization: SignedAuthorization

    try {
      // Try wallet_signAuthorization RPC method
      const result = await walletClient.request({
        method: 'wallet_signAuthorization' as never,
        params: [{
          contractAddress,
          chainId: numberToHex(chainId),
          nonce: numberToHex(nonce),
        }] as never,
      }) as { r: Hex; s: Hex; yParity: number }

      authorization = {
        address: contractAddress,
        chainId,
        nonce,
        r: result.r,
        s: result.s,
        yParity: result.yParity,
      }

      console.log('[enableSmartAccount] Authorization signed via wallet_signAuthorization')
    } catch (rpcError) {
      console.error('[enableSmartAccount] wallet_signAuthorization failed:', rpcError)

      // Check if this is specifically a "method not found" error
      const errorMessage = rpcError instanceof Error ? rpcError.message : String(rpcError)
      const isMethodNotFound =
        errorMessage.includes('does not exist') ||
        errorMessage.includes('not available') ||
        errorMessage.includes('MethodNotFound') ||
        errorMessage.includes("doesn't has corresponding handler")

      if (isMethodNotFound) {
        return {
          success: false,
          error: 'wallet_unsupported',
          message: 'Your wallet does not support EIP-7702 smart account authorization. ' +
            'EIP-7702 is a new feature that requires wallet support. ' +
            'Please try:\n' +
            '• Rabby Wallet (enable "Experimental Features" in settings)\n' +
            '• MetaMask (may need latest version with 7702 support)\n' +
            '• Or wait for your wallet to add EIP-7702 support.',
        }
      }

      // Other RPC error
      return {
        success: false,
        error: 'unknown',
        message: errorMessage,
      }
    }

    console.log('[enableSmartAccount] Authorization signed:', authorization)

    // Step 2: Send transaction with authorization list
    // The transaction itself doesn't need to do anything - the authorization list
    // is what causes the delegation to be set. We send to self with empty data.
    const hash = await walletClient.sendTransaction({
      account,
      chain: walletClient.chain,
      authorizationList: [authorization],
      to: account.address,
      data: '0x',
    })

    console.log('[enableSmartAccount] Transaction sent:', hash)

    // Step 3: Wait for confirmation
    const receipt = await publicClient.waitForTransactionReceipt({ hash })

    console.log('[enableSmartAccount] Transaction confirmed:', {
      status: receipt.status,
      blockNumber: receipt.blockNumber,
    })

    if (receipt.status !== 'success') {
      return {
        success: false,
        error: 'transaction_failed',
        message: 'Transaction failed on-chain',
      }
    }

    // Step 4: Verify the delegation was actually applied
    // Check that the account code now matches the expected ERC-7702 delegation prefix
    const code = await publicClient.getCode({ address: account.address })
    const expectedCode = `0xef0100${contractAddress.slice(2).toLowerCase()}`

    if (!code || code.toLowerCase() !== expectedCode.toLowerCase()) {
      console.error('[enableSmartAccount] Delegation verification failed:', {
        expectedCode,
        actualCode: code,
      })
      return {
        success: false,
        error: 'chain_unsupported',
        message: 'ERC-7702 delegation was not applied. The transaction succeeded but the account code was not updated. ' +
          'This may indicate that EIP-7702 is not supported on this network yet.',
      }
    }

    console.log('[enableSmartAccount] Delegation verified:', code)

    return {
      hash,
      success: true,
    }
  } catch (err) {
    // Catch any unexpected errors from async operations
    console.error('[enableSmartAccount] Unexpected error:', err)
    return {
      success: false,
      error: 'unknown',
      message: err instanceof Error ? err.message : 'An unexpected error occurred',
    }
  }
}
