import type { Address, PublicClient, WalletClient } from 'viem'

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

const METAMASK_SMART_ACCOUNT_SUPPORTED_CHAINS = new Set([
  1, 10, 56, 100, 137, 8453, 42161, 42170, 59144, 80094, 130, 747474,
  11155111, 84532, 11155420, 421614, 80002, 59141, 10200,
])

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

async function importRuntimeModule<T>(specifier: string): Promise<T> {
  const importer = new Function('specifier', 'return import(specifier)') as (
    specifier: string
  ) => Promise<T>

  return importer(specifier)
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

  const buyerAddress = walletClient.account?.address

  if (!buyerAddress) {
    throw new Error('Connected wallet account is not available')
  }

  const {
    CaveatType,
    Implementation,
    ScopeType,
    createOpenDelegation,
    toMetaMaskSmartAccount,
  } = await importRuntimeModule<{
    CaveatType: { Redeemer: unknown }
    Implementation: { Hybrid: unknown }
    ScopeType: { Erc20TransferAmount: unknown }
    createOpenDelegation: (args: unknown) => unknown
    toMetaMaskSmartAccount: (args: unknown) => Promise<{
      address: Address
      environment: { DelegationManager: Address }
      signDelegation: (args: { delegation: unknown }) => Promise<`0x${string}`>
    }>
  }>('@metamask/smart-accounts-kit')
  const { encodeDelegations } = await importRuntimeModule<{
    encodeDelegations: (delegations: unknown[]) => `0x${string}`
  }>('@metamask/smart-accounts-kit/utils')

  const buyerSmartAccount = await toMetaMaskSmartAccount({
    client: publicClient,
    implementation: Implementation.Hybrid,
    deployParams: [buyerAddress, [], [], []],
    deploySalt: '0x',
    signer: { walletClient },
  } as never)

  const delegation = createOpenDelegation({
    from: buyerSmartAccount.address,
    environment: buyerSmartAccount.environment,
    scope: {
      type: ScopeType.Erc20TransferAmount,
      tokenAddress: requirements.asset,
      maxAmount: BigInt(getPaymentAmount(requirements)),
    },
    caveats: [
      {
        type: CaveatType.Redeemer,
        redeemers: facilitators,
      },
    ],
  })

  const signature = await buyerSmartAccount.signDelegation({ delegation })
  const signedDelegation = Object.assign({}, delegation, { signature })
  const permissionContext = encodeDelegations([signedDelegation])

  return encodeBase64({
    x402Version: 2,
    accepted: {
      ...requirements,
      amount: getPaymentAmount(requirements),
    },
    payload: {
      delegationManager: buyerSmartAccount.environment.DelegationManager,
      permissionContext,
      delegator: buyerSmartAccount.address,
    },
  })
}
