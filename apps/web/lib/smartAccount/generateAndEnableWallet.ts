import {
  type Address,
  type Hash,
  type Hex,
  createWalletClient,
  createPublicClient,
  http,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'

export interface GenerateAndEnableWalletParams {
  chainId: number
  contractAddress: Address
  /** Base64-encoded X-PAYMENT header for x402 payment */
  paymentHeader: string
}

export interface GenerateAndEnableWalletResult {
  address: Address
  privateKey: Hex
  txHash: Hash
}

export interface GenerateAndEnableWalletError {
  success: false
  error: 'transaction_failed' | 'verification_failed' | 'relayer_error' | 'unknown'
  message: string
}

interface RelayerResponse {
  success?: boolean
  alreadyEnabled?: boolean
  txHash?: string
  blockNumber?: number
  error?: string
  message?: string
}

/**
 * Generate a new wallet and enable EIP-7702 smart account delegation
 *
 * This function:
 * 1. Generates a new private key and derives the address
 * 2. Creates a local wallet client for the new account
 * 3. Signs an EIP-7702 authorization with the new account (locally)
 * 4. Calls the relayer API to submit the transaction
 * 5. Verifies the delegation was applied
 *
 * The relayer pays for gas, so no connected wallet is needed.
 * The private key never leaves the client - only the signed authorization is sent.
 */
export async function generateAndEnableWallet({
  chainId,
  contractAddress,
  paymentHeader,
}: GenerateAndEnableWalletParams): Promise<
  GenerateAndEnableWalletResult | GenerateAndEnableWalletError
> {
  // Determine chain config
  const chain = chainId === baseSepolia.id ? baseSepolia : undefined

  if (!chain) {
    return {
      success: false,
      error: 'unknown',
      message: `Unsupported chain ID: ${chainId}`,
    }
  }

  // Get RPC URL for the chain
  const rpcUrl = chainId === baseSepolia.id
    ? process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org'
    : undefined

  if (!rpcUrl) {
    return {
      success: false,
      error: 'unknown',
      message: `No RPC URL configured for chain ${chainId}`,
    }
  }

  try {
    // Step 1: Generate new private key and derive account
    const privateKey = generatePrivateKey()
    const newAccount = privateKeyToAccount(privateKey)

    console.log('[generateAndEnableWallet] Generated new account:', newAccount.address)

    // Step 2: Create local wallet client for the new account
    const newWalletClient = createWalletClient({
      account: newAccount,
      chain,
      transport: http(rpcUrl),
    })

    // Step 3: Sign EIP-7702 authorization with the new account
    // By not specifying an executor, anyone (including the relayer) can submit this authorization
    const authorization = await newWalletClient.signAuthorization({
      contractAddress,
    })

    console.log('[generateAndEnableWallet] Authorization signed:', {
      address: authorization.address,
      chainId: authorization.chainId,
      nonce: authorization.nonce,
    })

    // Step 4: Call the relayer API to submit the transaction
    console.log('[generateAndEnableWallet] Calling relayer API with payment...')

    const response = await fetch('/api/relayer/enable-7702', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-PAYMENT': paymentHeader,
      },
      body: JSON.stringify({
        targetAddress: newAccount.address,
        authorization: {
          address: authorization.address,
          chainId: authorization.chainId,
          nonce: authorization.nonce,
          r: authorization.r,
          s: authorization.s,
          yParity: authorization.yParity,
        },
        chainId,
      }),
    })

    const result: RelayerResponse = await response.json()

    if (!response.ok) {
      console.error('[generateAndEnableWallet] Relayer error:', result)
      return {
        success: false,
        error: 'relayer_error',
        message: result.error || 'Relayer request failed',
      }
    }

    if (result.alreadyEnabled) {
      console.log('[generateAndEnableWallet] Already enabled')
      // This shouldn't happen for a newly generated wallet, but handle it gracefully
      return {
        address: newAccount.address,
        privateKey,
        txHash: '0x0' as Hash, // No transaction was needed
      }
    }

    if (!result.txHash) {
      return {
        success: false,
        error: 'relayer_error',
        message: 'Relayer did not return transaction hash',
      }
    }

    console.log('[generateAndEnableWallet] Transaction confirmed:', {
      txHash: result.txHash,
      blockNumber: result.blockNumber,
    })

    // Step 5: Verify the delegation was applied (double-check from client side)
    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    })

    const code = await publicClient.getCode({ address: newAccount.address })
    const expectedCode = `0xef0100${contractAddress.slice(2).toLowerCase()}`

    if (!code || code.toLowerCase() !== expectedCode.toLowerCase()) {
      console.error('[generateAndEnableWallet] Delegation verification failed:', {
        expectedCode,
        actualCode: code,
      })
      return {
        success: false,
        error: 'verification_failed',
        message:
          'EIP-7702 delegation was not applied. The transaction succeeded but the account code was not updated.',
      }
    }

    console.log('[generateAndEnableWallet] Delegation verified:', code)

    return {
      address: newAccount.address,
      privateKey,
      txHash: result.txHash as Hash,
    }
  } catch (err) {
    console.error('[generateAndEnableWallet] Error:', err)
    return {
      success: false,
      error: 'unknown',
      message: err instanceof Error ? err.message : 'An unexpected error occurred',
    }
  }
}
