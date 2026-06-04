'use client'

import { useAppKit } from '@reown/appkit/react'
import { cn } from '@/lib/utils'
import { usePayLinkGenerator } from '../model'
import { LinkGeneratorInputView } from './LinkGeneratorInputView'
import { LinkGeneratorGeneratedView } from './LinkGeneratorGeneratedView'

export function LinkGeneratorView() {
  const { open } = useAppKit()

  const {
    // Wallet state
    address,
    truncatedAddress,

    // State
    state,
    isTransitioning,
    recipient,
    amount,
    croName,
    isLookingUp,
    copied,
    baseHost,

    // Validation
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
    useCroName,
  } = usePayLinkGenerator()

  const handleOpenWallet = () => open()

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
      <div
        className={cn(
          "flex flex-col items-center w-full transition-all duration-300 ease-out",
          isTransitioning ? "opacity-0 scale-95" : "opacity-100 scale-100"
        )}
      >
        {state === 'input' ? (
          <LinkGeneratorInputView
            address={address}
            truncatedAddress={truncatedAddress}
            onOpenWallet={handleOpenWallet}
            recipient={recipient}
            amount={amount}
            croName={croName}
            isLookingUp={isLookingUp}
            baseHost={baseHost}
            isValidRecipient={isValidRecipient}
            isValidAmount={isValidAmount}
            canGenerate={canGenerate}
            onRecipientChange={setRecipient}
            onAmountChange={setAmount}
            onGenerate={generate}
            onUseAddress={useAddress}
            onUseCroName={useCroName}
          />
        ) : (
          <LinkGeneratorGeneratedView
            baseHost={baseHost}
            displayRecipient={displayRecipient}
            amount={amount}
            copied={copied}
            onEdit={edit}
            onCopy={copy}
            onShareOnX={shareOnX}
            onOpenLink={openLink}
          />
        )}
      </div>
    </div>
  )
}
