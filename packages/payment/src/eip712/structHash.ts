import { keccak256, encodeAbiParameters, type Hex } from 'viem'
import { TRANSFER_WITH_AUTHORIZATION_TYPEHASH } from '../constants'
import type { TransferWithAuthorizationMessage } from '../types'

/**
 * Compute the EIP-712 struct hash for TransferWithAuthorization
 * structHash = keccak256(abi.encode(TYPE_HASH, from, to, value, validAfter, validBefore, nonce))
 */
export function computeTransferWithAuthorizationStructHash(
  message: TransferWithAuthorizationMessage
): Hex {
  // Compute type hash
  const typeHash = keccak256(
    new TextEncoder().encode(TRANSFER_WITH_AUTHORIZATION_TYPEHASH)
  ) as Hex

  // Encode and hash the struct
  const encoded = encodeAbiParameters(
    [
      { type: 'bytes32' }, // typeHash
      { type: 'address' }, // from
      { type: 'address' }, // to
      { type: 'uint256' }, // value
      { type: 'uint256' }, // validAfter
      { type: 'uint256' }, // validBefore
      { type: 'bytes32' }, // nonce
    ],
    [
      typeHash,
      message.from,
      message.to,
      message.value,
      message.validAfter,
      message.validBefore,
      message.nonce,
    ]
  )

  return keccak256(encoded)
}
