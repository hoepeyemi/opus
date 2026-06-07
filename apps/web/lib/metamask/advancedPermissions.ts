import type { Address, Hex, PublicClient, WalletClient } from 'viem'
import { getAddress, isAddress } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import type {
  Erc20TokenAllowancePermission,
  Erc20TokenPeriodicPermission,
  NativeTokenAllowancePermission,
  NativeTokenPeriodicPermission,
  NativeTokenStreamPermission,
  PermissionTypes,
  RequestExecutionPermissionsReturnType,
  TokenApprovalRevocationPermission,
} from '@metamask/smart-accounts-kit/actions'

export interface PermissionResponse {
  chainId: number
  from?: Address
  to: Address
  context: Hex
  delegationManager: Address
  dependencies?: Array<{
    factory: Address
    factoryData: Hex
  }>
}

export interface GrantedMetaMaskPermission {
  grantedPermission: PermissionResponse
  sessionSigner: ReturnType<typeof privateKeyToAccount>
  sessionAccount: {
    address: Address
  }
  delegator: Address
}

interface BaseRequestParams {
  publicClient: PublicClient
  walletClient: WalletClient
  chainId: number
  expirySeconds?: number
  from?: Address
  redeemer?: readonly Address[]
  payee?: readonly Address[]
}

export interface Erc20TokenAllowanceParams extends BaseRequestParams {
  tokenAddress: Address
  allowanceAmount: bigint
  startTime?: number
  justification?: string
  isAdjustmentAllowed?: boolean
}

export interface Erc20TokenPeriodicParams extends BaseRequestParams {
  tokenAddress: Address
  periodAmount: bigint
  periodDuration: number
  startTime?: number
  justification?: string
  isAdjustmentAllowed?: boolean
}

export interface NativeTokenAllowanceParams extends BaseRequestParams {
  allowanceAmount: bigint
  startTime?: number
  justification?: string
  isAdjustmentAllowed?: boolean
}

export interface NativeTokenPeriodicParams extends BaseRequestParams {
  periodAmount: bigint
  periodDuration: number
  startTime?: number
  justification?: string
  isAdjustmentAllowed?: boolean
}

export interface NativeTokenStreamParams extends BaseRequestParams {
  amountPerSecond: bigint
  initialAmount?: bigint
  maxAmount?: bigint
  startTime?: number
  justification?: string
  isAdjustmentAllowed?: boolean
}

export interface TokenApprovalRevocationParams extends BaseRequestParams {
  erc20Approve?: boolean
  erc721Approve?: boolean
  erc721SetApprovalForAll?: boolean
  permit2Approve?: boolean
  permit2Lockdown?: boolean
  permit2InvalidateNonces?: boolean
  justification?: string
  isAdjustmentAllowed?: boolean
}

export const METAMASK_SMART_ACCOUNT_SUPPORTED_CHAINS = new Set([
  1, 10, 56, 100, 137, 8453, 42161, 42170, 59144, 80094, 130, 747474,
  11155111, 84532, 11155420, 421614, 80002, 59141, 10200,
])

const SESSION_ACCOUNT_STORAGE_PREFIX = '@opus/metamask-flask-session'

function getSessionStorageKey(owner: Address, chainId: number): string {
  return `${SESSION_ACCOUNT_STORAGE_PREFIX}:${chainId}:${owner.toLowerCase()}`
}

export function getOrCreateMetaMaskSessionSigner(owner: Address, chainId: number) {
  const storageKey = getSessionStorageKey(owner, chainId)
  const existingPrivateKey = typeof window === 'undefined'
    ? null
    : window.localStorage.getItem(storageKey)

  if (existingPrivateKey && /^0x[a-fA-F0-9]{64}$/.test(existingPrivateKey)) {
    return privateKeyToAccount(existingPrivateKey as Hex)
  }

  const privateKey = generatePrivateKey()
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(storageKey, privateKey)
  }

  return privateKeyToAccount(privateKey)
}

export async function getOrCreateMetaMaskSessionAccount(
  publicClient: PublicClient,
  owner: Address,
  chainId: number
): Promise<{ signer: ReturnType<typeof privateKeyToAccount>; account: { address: Address } }> {
  const signer = getOrCreateMetaMaskSessionSigner(owner, chainId)
  const { Implementation, toMetaMaskSmartAccount } = await import('@metamask/smart-accounts-kit')
  const account = await toMetaMaskSmartAccount({
    client: publicClient,
    implementation: Implementation.Hybrid,
    deployParams: [signer.address, [], [], []],
    deploySalt: '0x',
    signer: { account: signer },
  })

  return {
    signer,
    account: {
      address: account.address,
    },
  }
}

function getPermissionExpiry(expirySeconds?: number): number {
  const currentTime = Math.floor(Date.now() / 1000)
  const timeoutSeconds = Math.max(expirySeconds ?? 300, 300)

  return currentTime + timeoutSeconds
}

function getFriendlyFlaskError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)

  if (
    message.includes('wallet_requestExecutionPermissions') ||
    message.includes('wallet_grantPermissions') ||
    message.includes('does not exist') ||
    message.includes('not available') ||
    message.includes('MethodNotFound')
  ) {
    return 'MetaMask Flask 13.5.0 or later is required for Advanced Permissions (ERC-7715). Your current wallet does not expose wallet_requestExecutionPermissions.'
  }

  return message
}

function getFriendlyUpgradeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)

  if (
    message.includes('wallet_sendCalls') ||
    message.includes('does not exist') ||
    message.includes('not available') ||
    message.includes('MethodNotFound')
  ) {
    return 'MetaMask Flask did not expose wallet_sendCalls, so the app cannot trigger the smart account upgrade programmatically. Update MetaMask Flask, select a MetaMask smart account that supports Base Sepolia, or use the standard wallet x402 flow.'
  }

  return message
}

function getDelegatedAddress(code: Hex | undefined): Address | null {
  if (!code || code === '0x') {
    return null
  }

  const normalized = code.toLowerCase()
  if (!normalized.startsWith('0xef0100') || normalized.length < 48) {
    return null
  }

  return getAddress(`0x${normalized.slice(8, 48)}`)
}

async function getMetaMaskStatelessDeleGatorAddress(chainId: number): Promise<Address> {
  const { getSmartAccountsEnvironment } = await import('@metamask/smart-accounts-kit') as {
    getSmartAccountsEnvironment: (chainId: number) => {
      implementations: {
        EIP7702StatelessDeleGatorImpl?: Address
      }
    }
  }

  const expected = getSmartAccountsEnvironment(chainId)
    .implementations
    .EIP7702StatelessDeleGatorImpl

  if (!expected) {
    throw new Error(`MetaMask Smart Accounts Kit has no EIP7702StatelessDeleGator implementation for chain ${chainId}`)
  }

  return expected
}

async function isMetaMaskFlaskAccountUpgraded(
  publicClient: PublicClient,
  accountAddress: Address,
  expected: Address
): Promise<boolean> {
  const code = await publicClient.getCode({ address: accountAddress })
  const delegatedAddress = getDelegatedAddress(code)

  return delegatedAddress?.toLowerCase() === expected.toLowerCase()
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

async function waitForMetaMaskFlaskUpgrade(
  publicClient: PublicClient,
  accountAddress: Address,
  expected: Address,
  timeoutMs = 30_000
): Promise<boolean> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    if (await isMetaMaskFlaskAccountUpgraded(publicClient, accountAddress, expected)) {
      return true
    }

    await sleep(1_000)
  }

  return isMetaMaskFlaskAccountUpgraded(publicClient, accountAddress, expected)
}

export async function ensureMetaMaskFlaskSmartAccount(
  publicClient: PublicClient,
  walletClient: WalletClient,
  accountAddress: Address,
  chainId: number
): Promise<void> {
  const expected = await getMetaMaskStatelessDeleGatorAddress(chainId)

  if (await isMetaMaskFlaskAccountUpgraded(publicClient, accountAddress, expected)) {
    return
  }

  const request = walletClient.request as (args: {
    method: string
    params?: unknown[]
  }) => Promise<unknown>

  try {
    await request({
      method: 'wallet_sendCalls',
      params: [
        {
          version: '2.0.0',
          chainId: `0x${chainId.toString(16)}`,
          from: accountAddress,
          atomicRequired: true,
          calls: [
            {
              to: accountAddress,
              value: '0x0',
            },
          ],
        },
      ],
    })
  } catch (error) {
    throw new Error(getFriendlyUpgradeError(error))
  }

  const upgraded = await waitForMetaMaskFlaskUpgrade(publicClient, accountAddress, expected)
  if (upgraded) {
    return
  }

  throw new Error(
    `MetaMask Flask accepted the smart account upgrade request, but ${accountAddress} is still not delegated to EIP7702StatelessDeleGator on Base Sepolia. Confirm the MetaMask upgrade prompt, make sure Base Sepolia is selected, then try again.`
  )
}

export async function requestMetaMaskExecutionPermission(
  params: BaseRequestParams & { permission: PermissionTypes }
): Promise<GrantedMetaMaskPermission> {
  const { publicClient, walletClient, chainId, permission, expirySeconds, redeemer, payee } = params

  if (!METAMASK_SMART_ACCOUNT_SUPPORTED_CHAINS.has(chainId)) {
    throw new Error(`MetaMask Smart Accounts do not support chain ${chainId}`)
  }

  const owner = params.from ?? walletClient.account?.address
  if (!owner || !isAddress(owner)) {
    throw new Error('Connected MetaMask Flask account is not available')
  }

  await ensureMetaMaskFlaskSmartAccount(publicClient, walletClient, owner, chainId)

  const { signer: sessionSigner, account: sessionAccount } = await getOrCreateMetaMaskSessionAccount(
    publicClient,
    owner,
    chainId
  )
  const { erc7715ProviderActions } = await import('@metamask/smart-accounts-kit/actions')
  const permissionClient = walletClient.extend(erc7715ProviderActions())
  let grantedPermissions: RequestExecutionPermissionsReturnType

  try {
    grantedPermissions = await permissionClient.requestExecutionPermissions([
      {
        chainId,
        from: owner,
        to: sessionAccount.address,
        expiry: getPermissionExpiry(expirySeconds),
        ...(redeemer?.length ? { redeemer } : {}),
        ...(payee?.length ? { payee } : {}),
        permission,
      },
    ])
  } catch (error) {
    throw new Error(getFriendlyFlaskError(error))
  }

  const grantedPermission = grantedPermissions[0]
  if (!grantedPermission?.context || !grantedPermission.delegationManager) {
    throw new Error('MetaMask Flask did not return a usable ERC-7715 permission context')
  }

  const delegator = grantedPermission.from && isAddress(grantedPermission.from)
    ? grantedPermission.from
    : owner

  return {
    grantedPermission,
    sessionSigner,
    sessionAccount,
    delegator,
  }
}

export function requestErc20TokenAllowancePermission(
  params: Erc20TokenAllowanceParams
): Promise<GrantedMetaMaskPermission> {
  const permission: Erc20TokenAllowancePermission = {
    type: 'erc20-token-allowance',
    data: {
      allowanceAmount: params.allowanceAmount,
      tokenAddress: params.tokenAddress,
      startTime: params.startTime ?? Math.floor(Date.now() / 1000),
      justification: params.justification,
    },
    isAdjustmentAllowed: params.isAdjustmentAllowed ?? false,
  }

  return requestMetaMaskExecutionPermission({ ...params, permission })
}

export function requestErc20TokenPeriodicPermission(
  params: Erc20TokenPeriodicParams
): Promise<GrantedMetaMaskPermission> {
  const permission: Erc20TokenPeriodicPermission = {
    type: 'erc20-token-periodic',
    data: {
      periodAmount: params.periodAmount,
      periodDuration: params.periodDuration,
      tokenAddress: params.tokenAddress,
      startTime: params.startTime ?? Math.floor(Date.now() / 1000),
      justification: params.justification,
    },
    isAdjustmentAllowed: params.isAdjustmentAllowed ?? true,
  }

  return requestMetaMaskExecutionPermission({ ...params, permission })
}

export function requestNativeTokenAllowancePermission(
  params: NativeTokenAllowanceParams
): Promise<GrantedMetaMaskPermission> {
  const permission: NativeTokenAllowancePermission = {
    type: 'native-token-allowance',
    data: {
      allowanceAmount: params.allowanceAmount,
      startTime: params.startTime ?? Math.floor(Date.now() / 1000),
      justification: params.justification,
    },
    isAdjustmentAllowed: params.isAdjustmentAllowed ?? true,
  }

  return requestMetaMaskExecutionPermission({ ...params, permission })
}

export function requestNativeTokenPeriodicPermission(
  params: NativeTokenPeriodicParams
): Promise<GrantedMetaMaskPermission> {
  const permission: NativeTokenPeriodicPermission = {
    type: 'native-token-periodic',
    data: {
      periodAmount: params.periodAmount,
      periodDuration: params.periodDuration,
      startTime: params.startTime ?? Math.floor(Date.now() / 1000),
      justification: params.justification,
    },
    isAdjustmentAllowed: params.isAdjustmentAllowed ?? true,
  }

  return requestMetaMaskExecutionPermission({ ...params, permission })
}

export function requestNativeTokenStreamPermission(
  params: NativeTokenStreamParams
): Promise<GrantedMetaMaskPermission> {
  const permission: NativeTokenStreamPermission = {
    type: 'native-token-stream',
    data: {
      amountPerSecond: params.amountPerSecond,
      initialAmount: params.initialAmount,
      maxAmount: params.maxAmount,
      startTime: params.startTime ?? Math.floor(Date.now() / 1000),
      justification: params.justification,
    },
    isAdjustmentAllowed: params.isAdjustmentAllowed ?? true,
  }

  return requestMetaMaskExecutionPermission({ ...params, permission })
}

export function requestTokenApprovalRevocationPermission(
  params: TokenApprovalRevocationParams
): Promise<GrantedMetaMaskPermission> {
  const permission: TokenApprovalRevocationPermission = {
    type: 'token-approval-revocation',
    data: {
      erc20Approve: params.erc20Approve ?? true,
      erc721Approve: params.erc721Approve ?? false,
      erc721SetApprovalForAll: params.erc721SetApprovalForAll ?? false,
      permit2Approve: params.permit2Approve ?? true,
      permit2Lockdown: params.permit2Lockdown ?? false,
      permit2InvalidateNonces: params.permit2InvalidateNonces ?? false,
      justification: params.justification,
    },
    isAdjustmentAllowed: params.isAdjustmentAllowed ?? false,
  }

  return requestMetaMaskExecutionPermission({ ...params, permission })
}
