import type { Address, Hex, PublicClient, WalletClient } from 'viem'
import {
  METAMASK_SMART_ACCOUNT_SUPPORTED_CHAINS,
  requestErc20TokenAllowancePermission,
} from './advancedPermissions'

export interface MetaMaskX402Requirements {
  scheme: string
  network: string
  amount?: string
  maxAmountRequired?: string
  asset: Address
  payTo: Address
  maxTimeoutSeconds?: number
  description?: string
  mimeType?: string
  extra?: {
    assetTransferMethod?: string
    facilitators?: Address[]
    [key: string]: unknown
  }
}

export interface CreateMetaMaskX402PaymentParams {
  requirements: MetaMaskX402Requirements
  publicClient: PublicClient
  walletClient: WalletClient
}

function encodeBase64(value: unknown): string {
  const json = JSON.stringify(value)

  if (typeof window === 'undefined') {
    return Buffer.from(json, 'utf8').toString('base64')
  }

  return window.btoa(unescape(encodeURIComponent(json)))
}

function parseChainId(network: string): number {
  const [namespace, reference] = network.split(':')

  if (namespace !== 'eip155' || !reference) {
    throw new Error(`MetaMask ERC-7710 x402 requires an eip155 network, received "${network}"`)
  }

  const chainId = Number(reference)
  if (!Number.isInteger(chainId)) {
    throw new Error(`Invalid eip155 network: ${network}`)
  }

  return chainId
}

function getPaymentAmount(requirements: MetaMaskX402Requirements): string {
  const amount = requirements.amount ?? requirements.maxAmountRequired

  if (!amount) {
    throw new Error('ERC-7710 payment requirements are missing an amount')
  }

  return amount
}

function assertErc7710Requirements(requirements: MetaMaskX402Requirements): Address[] {
  if (requirements.extra?.assetTransferMethod !== 'erc7710') {
    throw new Error('This endpoint did not advertise ERC-7710 x402 payments')
  }

  const facilitators = requirements.extra.facilitators ?? []

  if (facilitators.length === 0) {
    throw new Error('ERC-7710 payment requirements did not include facilitator addresses')
  }

  return facilitators
}

export function isMetaMaskX402SupportedNetwork(network: string): boolean {
  try {
    return METAMASK_SMART_ACCOUNT_SUPPORTED_CHAINS.has(parseChainId(network))
  } catch {
    return false
  }
}

export async function createMetaMaskX402PaymentSignature({
  requirements,
  publicClient,
  walletClient,
}: CreateMetaMaskX402PaymentParams): Promise<string> {
  const facilitators = assertErc7710Requirements(requirements)
  const chainId = parseChainId(requirements.network)

  if (!METAMASK_SMART_ACCOUNT_SUPPORTED_CHAINS.has(chainId)) {
    throw new Error(`MetaMask Smart Accounts do not support chain ${chainId}`)
  }

  const account = walletClient.account
  const buyerAddress = account?.address

  if (!buyerAddress) {
    throw new Error('Connected wallet account is not available')
  }

  const acceptedRequirements = {
    ...requirements,
    amount: getPaymentAmount(requirements),
    maxAmountRequired: requirements.maxAmountRequired ?? getPaymentAmount(requirements),
    extra: {
      ...requirements.extra,
      assetTransferMethod: 'erc7710',
      facilitators,
      facilitatorAddresses: facilitators,
    },
  }
  const { grantedPermission, delegator } = await requestErc20TokenAllowancePermission({
    publicClient,
    walletClient,
    chainId,
    from: buyerAddress,
    expirySeconds: requirements.maxTimeoutSeconds,
    redeemer: facilitators,
    payee: [requirements.payTo],
    tokenAddress: requirements.asset,
    allowanceAmount: BigInt(getPaymentAmount(requirements)),
    startTime: Math.floor(Date.now() / 1000),
    justification: `Permission to pay ${requirements.description ?? 'an x402 API request'} with USDC on Base Sepolia`,
    isAdjustmentAllowed: false,
  })

  return encodeBase64({
    x402Version: 2,
    accepted: acceptedRequirements,
    payload: {
      delegationManager: grantedPermission.delegationManager,
      permissionContext: grantedPermission.context,
      delegator,
    },
  })
}
