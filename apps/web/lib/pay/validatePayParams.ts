import { payParamsSchema } from '@/lib/validations/pay'
import { isCroDomain, isValidAddress } from '@/lib/cronosid'

/**
 * Payment parameters interface
 */
export interface PayParams {
  recipient: string
  amount: number
  chainId: number
}

/**
 * Validation result interface
 */
export interface ValidationResult {
  valid: boolean
  error?: string
}

/**
 * Amount validation result with parsed value
 */
export interface AmountValidationResult extends ValidationResult {
  amountInSmallestUnit?: number
}

/**
 * USDC decimals constant
 */
const USDC_DECIMALS = 6

/**
 * Validate recipient - must be a valid address or .cro domain format
 *
 * @param recipient - The recipient string to validate
 * @returns Validation result with error message if invalid
 */
export function validateRecipient(recipient: string): ValidationResult {
  const normalized = recipient.toLowerCase().trim()

  // Check if it's a .cro domain
  if (normalized.endsWith('.cro')) {
    if (isCroDomain(normalized)) {
      return { valid: true }
    }
    return {
      valid: false,
      error: 'Invalid .cro domain format',
    }
  }

  // Check if it's a valid EVM address
  if (isValidAddress(normalized)) {
    return { valid: true }
  }

  return {
    valid: false,
    error: 'Invalid recipient. Must be a .cro domain or valid 0x address.',
  }
}

/**
 * Validate amount and convert to smallest unit (6 decimals for USDC)
 *
 * @param amount - The amount string to validate
 * @returns Validation result with converted amount if valid
 */
export function validateAmount(amount: string): AmountValidationResult {
  const num = parseFloat(amount)

  if (isNaN(num)) {
    return {
      valid: false,
      error: 'Invalid amount. Must be a valid number.',
    }
  }

  if (num <= 0) {
    return {
      valid: false,
      error: 'Invalid amount. Must be greater than 0.',
    }
  }

  if (num > 1_000_000) {
    return {
      valid: false,
      error: 'Invalid amount. Must be $1,000,000 or less.',
    }
  }

  // Convert to smallest unit (6 decimals for USDC)
  const amountInSmallestUnit = Math.round(num * Math.pow(10, USDC_DECIMALS))

  return {
    valid: true,
    amountInSmallestUnit,
  }
}

/**
 * Validate pay params using zod schema
 *
 * @param recipient - URL-encoded recipient string
 * @param amount - URL-encoded amount string
 * @returns Object with decoded params and validation result
 */
export function validatePayParams(
  recipient: string,
  amount: string
): {
  decodedRecipient: string
  decodedAmount: string
  valid: boolean
  error?: string
} {
  // Decode URL-encoded params
  const decodedRecipient = decodeURIComponent(recipient)
  const decodedAmount = decodeURIComponent(amount)

  // Validate params with zod
  const validation = payParamsSchema.safeParse({
    recipient: decodedRecipient,
    amount: decodedAmount,
  })

  if (!validation.success) {
    return {
      decodedRecipient,
      decodedAmount,
      valid: false,
      error: validation.error.issues[0]?.message ?? 'Validation failed',
    }
  }

  return {
    decodedRecipient,
    decodedAmount,
    valid: true,
  }
}
