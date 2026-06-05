'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useConnection } from 'wagmi'
import { isAddress } from 'viem'
import type { Address } from 'viem'

export type GeneratorState = 'input' | 'generated'

export interface UsePayLinkGeneratorReturn {
  // Wallet state
  address: Address | undefined
  truncatedAddress: string

  // State
  state: GeneratorState
  isTransitioning: boolean
  recipient: string
  amount: string
  copied: boolean
  baseHost: string

  // Derived
  paymentUrl: string
  isValidRecipient: boolean
  isValidAmount: boolean
  canGenerate: boolean
  displayRecipient: string

  // Actions
  setRecipient: (value: string) => void
  setAmount: (value: string) => void
  generate: () => void
  edit: () => void
  copy: () => Promise<void>
  shareOnX: () => void
  openLink: () => void
  useAddress: () => void
}

export function usePayLinkGenerator(): UsePayLinkGeneratorReturn {
  const { address } = useConnection()

  const [state, setState] = useState<GeneratorState>('input')
  const [isTransitioning, setIsTransitioning] = useState(false)
  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('1.50')
  const [copied, setCopied] = useState(false)
  const [baseHost, setBaseHost] = useState('')
  const [baseOrigin, setBaseOrigin] = useState('')

  // Set host/origin after mount to avoid hydration mismatch
  useEffect(() => {
    setBaseHost(window.location.host)
    setBaseOrigin(window.location.origin)
  }, [])

  // Auto-fill recipient with the connected wallet address.
  useEffect(() => {
    if (address) {
      setRecipient(address)
    }
  }, [address])

  // Derived values
  const paymentUrl = baseOrigin
    ? `${baseOrigin}/pay/${encodeURIComponent(recipient)}/${encodeURIComponent(amount)}`
    : ''

  const isValidRecipient = recipient.length > 0 && isAddress(recipient)

  const parsedAmount = parseFloat(amount)
  const isValidAmount = !isNaN(parsedAmount) && parsedAmount > 0 && parsedAmount <= 1_000_000

  const canGenerate = isValidRecipient && isValidAmount

  const displayRecipient = recipient
    ? isAddress(recipient)
      ? `${recipient.slice(0, 6)}...${recipient.slice(-4)}`
      : recipient
    : ''

  // Actions
  const generate = useCallback(() => {
    if (canGenerate) {
      setIsTransitioning(true)
      setTimeout(() => {
        setState('generated')
        setTimeout(() => setIsTransitioning(false), 50)
      }, 200)
    }
  }, [canGenerate])

  const edit = useCallback(() => {
    setIsTransitioning(true)
    setTimeout(() => {
      setState('input')
      setCopied(false)
      setTimeout(() => setIsTransitioning(false), 50)
    }, 200)
  }, [])

  const copy = useCallback(async () => {
    if (!paymentUrl) return
    try {
      await navigator.clipboard.writeText(paymentUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error('[PayLink] Failed to copy:', error)
    }
  }, [paymentUrl])

  const shareOnX = useCallback(() => {
    if (!paymentUrl) return
    const text = `Pay me $${amount} via x402 - gas-free USDC payment on Base Sepolia`
    const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(paymentUrl)}`
    window.open(twitterUrl, '_blank', 'noopener,noreferrer')
  }, [amount, paymentUrl])

  const openLink = useCallback(() => {
    if (!paymentUrl) return
    window.open(paymentUrl, '_blank', 'noopener,noreferrer')
  }, [paymentUrl])

  const useAddress = useCallback(() => {
    if (address) {
      setRecipient(address)
    }
  }, [address])

  // Memoized truncated address
  const truncatedAddress = useMemo(() => {
    if (!address) return ''
    return `${address.slice(0, 6)}...${address.slice(-4)}`
  }, [address])

  return {
    // Wallet state
    address: address as Address | undefined,
    truncatedAddress,

    // State
    state,
    isTransitioning,
    recipient,
    amount,
    copied,
    baseHost,

    // Derived
    paymentUrl,
    isValidRecipient,
    isValidAmount,
    canGenerate,
    displayRecipient,

    // Actions
    setRecipient,
    setAmount,
    generate,
    edit,
    copy,
    shareOnX,
    openLink,
    useAddress,
  }
}
