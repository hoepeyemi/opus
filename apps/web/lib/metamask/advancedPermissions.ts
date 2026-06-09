import type { Address, Hex, PublicClient, WalletClient } from 'viem'
import { getAddress, isAddress } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import type { SmartAccountsEnvironment } from '@metamask/smart-accounts-kit'
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
  redelegatedPermissionContext: Hex
  delegationManager: Address
  sessionSigner: ReturnType<typeof privateKeyToAccount>
  sessionAccount: {
    address: Address
    environment: SmartAccountsEnvironment
  }
  delegator: Address
}

interface X402PaymentRequirementsForDelegation {
  scheme: string
  network: string
  asset: Address
  amount: string
  payTo: Address
  maxTimeoutSeconds: number
  extra?: Record<string, unknown>
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
  x402PaymentRequirements?: X402PaymentRequirementsForDelegation
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
const SMART_ACCOUNT_UPGRADE_TIMEOUT_MS = 180_000
const SMART_ACCOUNT_UPGRADE_POLL_INTERVAL_MS = 2_000

type UpgradeCheckResult = {
  upgraded: boolean
  code?: Hex
  delegatedAddress: Address | null
}

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
): Promise<{
  signer: ReturnType<typeof privateKeyToAccount>
  account: { address: Address; environment: SmartAccountsEnvironment }
}> {
  const signer = getOrCreateMetaMaskSessionSigner(owner, chainId)
  const { getSmartAccountsEnvironment } = await import('@metamask/smart-accounts-kit')

  return {
    signer,
    account: {
      address: signer.address,
      environment: getSmartAccountsEnvironment(chainId),
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
  const code = (error as { code?: number | string })?.code

  if (
    code === 4100 ||
    message.includes('has not been authorized') ||
    message.includes('not been authorized') ||
    message.includes('method and/or account has not been authorized')
  ) {
    return 'MetaMask Flask rejected wallet_requestExecutionPermissions because this site/account is not authorized for Advanced Permissions. Open Flask, disconnect localhost from Connected sites, reconnect from opus on Base Sepolia, and approve the Advanced Permissions prompt. If regular MetaMask is also installed, disable regular MetaMask for localhost or use a Flask-only browser profile.'
  }

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

async function refreshMetaMaskAccountAuthorization(walletClient: WalletClient): Promise<void> {
  const request = walletClient.request as (args: {
    method: string
    params?: unknown[]
  }) => Promise<unknown>

  await request({
    method: 'eth_requestAccounts',
    params: [],
  })
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
  const result = await getMetaMaskFlaskUpgradeState(publicClient, accountAddress, expected)

  return result.upgraded
}

async function getMetaMaskFlaskUpgradeState(
  publicClient: PublicClient,
  accountAddress: Address,
  expected: Address
): Promise<UpgradeCheckResult> {
  const code = await publicClient.getCode({ address: accountAddress })
  const delegatedAddress = getDelegatedAddress(code)

  return {
    upgraded: delegatedAddress?.toLowerCase() === expected.toLowerCase(),
    code,
    delegatedAddress,
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

async function waitForMetaMaskFlaskUpgrade(
  publicClient: PublicClient,
  accountAddress: Address,
  expected: Address,
  timeoutMs = SMART_ACCOUNT_UPGRADE_TIMEOUT_MS
): Promise<UpgradeCheckResult> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const state = await getMetaMaskFlaskUpgradeState(publicClient, accountAddress, expected)
    if (state.upgraded) {
      return state
    }

    await sleep(SMART_ACCOUNT_UPGRADE_POLL_INTERVAL_MS)
  }

  return getMetaMaskFlaskUpgradeState(publicClient, accountAddress, expected)
}

async function createOpenRedelegatedPermissionContext({
  sessionSigner,
  sessionAccount,
  permissionContext,
  paymentRequirements,
  expirySeconds,
  redeemer,
}: {
  sessionSigner: ReturnType<typeof privateKeyToAccount>
  sessionAccount: { address: Address; environment: SmartAccountsEnvironment }
  permissionContext: Hex
  paymentRequirements: X402PaymentRequirementsForDelegation
  expirySeconds?: number
  redeemer?: readonly Address[]
}): Promise<{ permissionContext: Hex; delegationManager: Address; delegator: Address }> {
  const { createx402DelegationProvider } = await import('@metamask/smart-accounts-kit/experimental')

  const x402DelegationProvider = createx402DelegationProvider({
    account: sessionSigner,
    environment: sessionAccount.environment,
    parentPermissionContext: permissionContext,
    expirySeconds,
    redeemers: redeemer?.length
      ? {
        requireRedeemers: true,
        addresses: [...redeemer],
      }
      : undefined,
  })

  const payload = await x402DelegationProvider(paymentRequirements)

  return {
    permissionContext: payload.permissionContext as Hex,
    delegationManager: payload.delegationManager as Address,
    delegator: payload.delegator as Address,
  }
}

export async function ensureMetaMaskFlaskSmartAccount(
  publicClient: PublicClient,
  _walletClient: WalletClient,
  accountAddress: Address,
  chainId: number
): Promise<void> {
  const expected = await getMetaMaskStatelessDeleGatorAddress(chainId)

  if (await isMetaMaskFlaskAccountUpgraded(publicClient, accountAddress, expected)) {
    return
  }

  const result = await getMetaMaskFlaskUpgradeState(publicClient, accountAddress, expected)
  const codeMessage = result.delegatedAddress
    ? ` Current delegated address: ${result.delegatedAddress}; expected: ${expected}.`
    : result.code && result.code !== '0x'
      ? ` Account code is present but is not an EIP-7702 delegation to the expected MetaMask implementation.`
      : ' Account code is still empty on Base Sepolia.'

  throw new Error(
    `MetaMask Flask account ${accountAddress} is not delegated to EIP7702StatelessDeleGator on Base Sepolia.${codeMessage} Use MetaMask Flask's Advanced Permissions prompt or switch this account to a MetaMask smart account on Base Sepolia, then try again.`
  )
}

export async function requestMetaMaskExecutionPermission(
  params: BaseRequestParams & {
    permission: PermissionTypes
    x402PaymentRequirements?: X402PaymentRequirementsForDelegation
  }
): Promise<GrantedMetaMaskPermission> {
  const {
    publicClient,
    walletClient,
    chainId,
    permission,
    expirySeconds,
    redeemer,
    payee,
    x402PaymentRequirements,
  } = params

  if (!METAMASK_SMART_ACCOUNT_SUPPORTED_CHAINS.has(chainId)) {
    throw new Error(`MetaMask Smart Accounts do not support chain ${chainId}`)
  }

  const owner = params.from ?? walletClient.account?.address
  if (!owner || !isAddress(owner)) {
    throw new Error('Connected MetaMask Flask account is not available')
  }

  await refreshMetaMaskAccountAuthorization(walletClient)

  // Check EOA code before requesting permissions (guide step 4).
  // Flask 13.9+ handles the upgrade automatically during requestExecutionPermissions,
  // but we still verify the state after granting.
  const expectedImpl = await getMetaMaskStatelessDeleGatorAddress(chainId)
  const preGrantState = await getMetaMaskFlaskUpgradeState(publicClient, owner, expectedImpl)
  if (!preGrantState.upgraded) {
    console.info(
      `[MetaMask] Account ${owner} is not yet a MetaMask Smart Account on chain ${chainId}. ` +
      `Flask 13.9+ will upgrade it automatically during the permissions prompt.`
    )
  }

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

  if (!x402PaymentRequirements) {
    throw new Error('x402 payment requirements are required to create an ERC-7710 payment redelegation')
  }

  const redelegation = await createOpenRedelegatedPermissionContext({
    sessionSigner,
    sessionAccount,
    permissionContext: grantedPermission.context,
    paymentRequirements: x402PaymentRequirements,
    expirySeconds,
    redeemer,
  })

  const upgradeState = await waitForMetaMaskFlaskUpgrade(publicClient, owner, expectedImpl)
  if (!upgradeState.upgraded) {
    const codeMessage = upgradeState.delegatedAddress
      ? ` Current delegated address: ${upgradeState.delegatedAddress}; expected: ${expectedImpl}.`
      : upgradeState.code && upgradeState.code !== '0x'
        ? ` Account code is present but is not an EIP-7702 delegation to the expected MetaMask implementation.`
        : ' Account code is still empty on Base Sepolia.'

    throw new Error(
      `MetaMask Flask granted an ERC-7715 permission, but ${owner} is still not delegated to EIP7702StatelessDeleGator on Base Sepolia.${codeMessage} Open MetaMask Flask, switch this account to a smart account on Base Sepolia, then try again.`
    )
  }

  const delegator = grantedPermission.from && isAddress(grantedPermission.from)
    ? grantedPermission.from
    : owner

  return {
    grantedPermission,
    redelegatedPermissionContext: redelegation.permissionContext,
    delegationManager: redelegation.delegationManager,
    sessionSigner,
    sessionAccount,
    delegator: redelegation.delegator || delegator,
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
