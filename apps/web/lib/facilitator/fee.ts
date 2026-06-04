import type { Address } from 'viem'
import type { FeeConfig } from './types'

/**
 * Default fee configuration
 * For hackathon: 0.5% fee with min 100 units (0.0001 USDC) and max 10000 units (0.01 USDC)
 */
export function getDefaultFeeConfig(): FeeConfig {
  return {
    basisPoints: parseInt(process.env.FACILITATOR_FEE_BPS || '50', 10), // 0.5%
    minFee: BigInt(process.env.FACILITATOR_MIN_FEE || '100'), // 0.0001 USDC
    maxFee: BigInt(process.env.FACILITATOR_MAX_FEE || '10000'), // 0.01 USDC
    feeRecipient: (process.env.FACILITATOR_FEE_RECIPIENT ||
      process.env.PAYMENT_RECIPIENT_ADDRESS ||
      '0x0000000000000000000000000000000000000000') as Address,
  }
}

/**
 * Calculate the fee for a given amount
 *
 * @param amount - The transfer amount in smallest token units
 * @param config - Fee configuration
 * @returns The fee amount in smallest token units
 */
export function calculateFee(amount: bigint, config: FeeConfig): bigint {
  // Calculate percentage-based fee
  const calculated = (amount * BigInt(config.basisPoints)) / BigInt(10000)

  // Apply min/max bounds
  if (calculated < config.minFee) {
    return config.minFee
  }
  if (calculated > config.maxFee) {
    return config.maxFee
  }

  return calculated
}

/**
 * Calculate net amount after fee deduction
 *
 * @param amount - The gross transfer amount
 * @param config - Fee configuration
 * @returns Object with net amount and fee amount
 */
export function calculateNetAmount(
  amount: bigint,
  config: FeeConfig
): { netAmount: bigint; fee: bigint } {
  const fee = calculateFee(amount, config)
  const netAmount = amount - fee

  return { netAmount, fee }
}

/**
 * Format fee for display (assumes 6 decimal places for USDC)
 */
export function formatFee(fee: bigint, decimals: number = 6): string {
  const divisor = BigInt(10 ** decimals)
  const whole = fee / divisor
  const fraction = fee % divisor

  if (fraction === BigInt(0)) {
    return whole.toString()
  }

  const fractionStr = fraction.toString().padStart(decimals, '0')
  // Trim trailing zeros
  const trimmed = fractionStr.replace(/0+$/, '')

  return `${whole}.${trimmed}`
}
