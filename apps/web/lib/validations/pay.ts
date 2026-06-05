import { z } from 'zod'

/**
 * EVM address regex pattern
 */
const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/

/**
 * Validates recipient parameter - must be a 0x EVM address
 */
export const recipientSchema = z.string().refine(
  (value) => {
    const normalized = value.toLowerCase().trim()
    return EVM_ADDRESS_REGEX.test(normalized)
  },
  { message: 'Invalid recipient. Must be a valid 0x address.' }
)

/**
 * Validates amount parameter - must be positive number up to $1,000,000
 */
export const amountSchema = z.string().refine(
  (value) => {
    const num = parseFloat(value)
    return !isNaN(num) && num > 0 && num <= 1_000_000
  },
  { message: 'Invalid amount. Must be a positive number up to $1,000,000.' }
)

/**
 * Combined pay page params schema
 */
export const payParamsSchema = z.object({
  recipient: recipientSchema,
  amount: amountSchema,
})

export type PayParams = z.infer<typeof payParamsSchema>
