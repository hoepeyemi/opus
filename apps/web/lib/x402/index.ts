// Server-side verification and settlement
export {
  verifyPayment,
  settlePayment,
  verifyPaymentWithFacilitator,
  parsePaymentHeader,
  generatePaymentNonce,
  isPaymentNonceUsed,
  buildPaymentRequirements,
  getUsdcAddress,
  getPaymentRecipient,
  type PaymentPayload,
  type PaymentHeader,
  type PaymentDetails,
  type PaymentRequirements,
} from './verify'

// Client-side payment signing utilities
export {
  EIP3009_TYPES,
  generateNonce,
  buildUsdcDomain,
  parseChainId,
  getNetworkFromChainId,
  buildEIP3009Message,
  buildPaymentHeader,
  encodePaymentHeader,
  type EIP3009Message,
  type PaymentPayloadClient,
  type PaymentHeaderClient,
} from './client'
