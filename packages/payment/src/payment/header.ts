import type { Address, Hex } from 'viem'
import type { PaymentHeader, TransferWithAuthorizationMessage, NetworkId } from '../types'
import { CHAIN_TO_NETWORK } from '../constants'

/**
 * Build an x402 payment header from signed message components
 */
export function buildPaymentHeader(params: {
  message: TransferWithAuthorizationMessage
  signature: Hex
  asset: Address
  chainId: number
}): PaymentHeader {
  const { message, signature, asset, chainId } = params
  const network = CHAIN_TO_NETWORK[chainId as keyof typeof CHAIN_TO_NETWORK] ?? ('base-sepolia' as NetworkId)

  return {
    x402Version: 1,
    scheme: 'exact',
    network,
    payload: {
      from: message.from,
      to: message.to,
      value: message.value.toString(),
      validAfter: Number(message.validAfter),
      validBefore: Number(message.validBefore),
      nonce: message.nonce,
      signature,
      asset,
    },
  }
}

/**
 * Encode a payment header to base64 for the X-PAYMENT HTTP header
 */
export function encodePaymentHeader(header: PaymentHeader): string {
  return Buffer.from(JSON.stringify(header)).toString('base64')
}

/**
 * Decode a base64-encoded X-PAYMENT header
 */
export function decodePaymentHeader(encoded: string): PaymentHeader {
  const json = Buffer.from(encoded, 'base64').toString('utf-8')
  return JSON.parse(json) as PaymentHeader
}
