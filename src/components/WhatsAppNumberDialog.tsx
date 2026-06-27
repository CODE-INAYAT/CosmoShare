import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { whatsappConfig } from '@/config/whatsapp'
import WhatsAppIcon from './WhatsAppIcon'
import { useIsMobile } from '@/hooks/use-mobile'
import { Drawer, DrawerContent, DrawerTitle, DrawerDescription } from '@/components/ui/drawer'
import * as Flags from 'country-flag-icons/react/3x2'
import { Badge } from '@/components/ui/badge'
import { AlertCircle } from 'lucide-react'
import { formatBytes } from '@/lib/utils'

interface WhatsAppNumberDialogProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: (fullNumber: string) => void
  totalFileSize?: number
}

export default function WhatsAppNumberDialog({ isOpen, onClose, onConfirm, totalFileSize = 0 }: WhatsAppNumberDialogProps) {
  const [selectedCountry, setSelectedCountry] = useState(whatsappConfig.countries[0])
  const [realValue, setRealValue] = useState('')
  const isSizeLimitExceeded = totalFileSize > 50 * 1024 * 1024
  const [isFocused, setIsFocused] = useState(!isSizeLimitExceeded)
  const inputRef = useRef<HTMLInputElement>(null)
  const isMobile = useIsMobile()

  // Clear state when dialog opens
  useEffect(() => {
    let timerId: NodeJS.Timeout | null = null

    if (isOpen) {
      setRealValue('')
      const isExceeded = totalFileSize > 50 * 1024 * 1024
      setIsFocused(!isExceeded)
      if (typeof window !== 'undefined') {
        const savedCountryCode = localStorage.getItem('cosmoshare_wa_country_code') || '+91'
        const country = whatsappConfig.countries.find(c => c.code === savedCountryCode) || whatsappConfig.countries[0]
        setSelectedCountry(country)
      }

      // Auto-focus the input field by default only on desktop screens
      const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 768
      if (isDesktop && !isExceeded) {
        timerId = setTimeout(() => {
          inputRef.current?.focus()
        }, 150)
      }
    }

    return () => {
      if (timerId) clearTimeout(timerId)
    }
  }, [isOpen, totalFileSize])

  const countries = whatsappConfig.enableMultiCountrySelector
    ? whatsappConfig.countries
    : [whatsappConfig.countries[0]]

  // Formatting and masking logic
  const getDisplayValue = () => {
    if (realValue.length === 0) return ''
    if (realValue.length <= 5) return realValue
    if (realValue.length < 10) {
      return '••••• ' + realValue.slice(5)
    }
    return '••••• •' + realValue.slice(6)
  }

  const displayValue = getDisplayValue()
  const displayChars = displayValue.split('')

  const handleConfirm = () => {
    if (realValue.length !== 10) {
      alert('Please enter a valid 10-digit mobile number.')
      return
    }
    // Save to local storage
    localStorage.setItem('cosmoshare_wa_country_code', selectedCountry.code)

    const fullNumber = selectedCountry.code.replace('+', '') + realValue
    onConfirm(fullNumber)
    onClose()
  }

  const dialogInnerContent = (
    <div className="flex flex-col h-full w-full">
      {/* Header */}
      <div className="flex flex-col items-center justify-center text-center sm:text-left sm:items-start gap-1 pb-2">
        <h2 className="flex items-center gap-2 text-lg font-bold text-emerald-600 dark:text-emerald-400">
          <WhatsAppIcon className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          Share to WhatsApp
          <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 border-emerald-500/20 dark:border-emerald-400/20 text-[10px] font-semibold px-1.5 py-0 h-5 rounded-md uppercase tracking-wider ml-1">
            Beta
          </Badge>
        </h2>
        <p className="text-muted-foreground text-xs sm:text-sm">
          Enter the WhatsApp mobile number to share your selected content.
        </p>
        {isSizeLimitExceeded && (
          <div className="flex items-start gap-2.5 p-3.5 bg-destructive/10 dark:bg-destructive/15 border border-destructive/20 text-destructive rounded-lg w-full mt-2 animate-in fade-in-50 slide-in-from-top-1 duration-200">
            <AlertCircle className="w-4.5 h-4.5 shrink-0 mt-0.5 text-destructive" />
            <div className="flex flex-col gap-0.5 text-left">
              <span className="text-xs font-bold uppercase tracking-wider">Size Limit Exceeded</span>
              <span className="text-xs text-destructive/95 leading-normal">
                WhatsApp sharing is unavailable because the selected files ({formatBytes(totalFileSize)}) exceed the 50 MB size limit.
                <span className="block mt-1 text-[11px] opacity-80 font-medium">Note: This size limit only applies to WhatsApp sharing.</span>
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="space-y-4 py-4 flex flex-col items-center sm:items-start w-full">
        <div className="space-y-2 w-full flex flex-col items-center sm:items-start">
          <Label htmlFor="phone-input" className="text-xs font-semibold text-muted-foreground text-center sm:text-left w-full">
            WhatsApp Mobile Number
          </Label>
          <div className="flex flex-col sm:flex-row gap-2.5 items-center justify-center w-full">
            {/* Country Selector */}
            <Select
              disabled={isSizeLimitExceeded}
              value={selectedCountry.code}
              onValueChange={(code) => {
                const country = whatsappConfig.countries.find(c => c.code === code)
                if (country) setSelectedCountry(country)
              }}
            >
              <SelectTrigger className="w-full max-w-[220px] sm:w-[115px] bg-secondary/50 dark:bg-secondary/30 border border-border/50 text-foreground focus:ring-emerald-500 flex items-center justify-between px-3">
                <div className="flex-1 flex items-center justify-center gap-2">
                  {(() => {
                    const Flag = Flags[selectedCountry.iso.toUpperCase() as keyof typeof Flags]
                    return Flag ? <Flag className="w-5 h-3.5 object-cover rounded-sm border border-border/10 shrink-0" /> : null
                  })()}
                  <span>
                    {isMobile 
                      ? `${selectedCountry.code} (${selectedCountry.name})` 
                      : selectedCountry.code
                    }
                  </span>
                </div>
              </SelectTrigger>
              <SelectContent className="bg-popover border border-border/50 text-popover-foreground">
                {countries.map((c) => {
                  const Flag = Flags[c.iso.toUpperCase() as keyof typeof Flags]
                  return (
                    <SelectItem key={c.code} value={c.code} className="focus:bg-emerald-500/10 focus:text-emerald-600 dark:focus:text-emerald-400">
                      <div className="flex items-center gap-2">
                        {Flag ? <Flag className="w-5 h-3.5 object-cover rounded-sm border border-border/10 shrink-0" /> : null}
                        <span className="font-medium">{c.code}</span>
                        <span className="text-muted-foreground text-xs">({c.name})</span>
                      </div>
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>

            {/* Styled Interactive Input Container */}
            <div
              className={`relative w-full max-w-[280px] sm:max-w-none sm:flex-1 h-10 border rounded-md flex items-center px-3 font-mono text-sm transition-all duration-200 ${
                isSizeLimitExceeded
                  ? 'border-border/20 bg-secondary/20 dark:bg-secondary/10 opacity-50 cursor-not-allowed'
                  : isFocused
                  ? 'border-emerald-500 ring-1 ring-emerald-500 bg-secondary/50 dark:bg-secondary/30'
                  : 'border-border/50 bg-secondary/50 dark:bg-secondary/30'
              }`}
              onClick={() => {
                if (!isSizeLimitExceeded) {
                  inputRef.current?.focus()
                }
              }}
            >
              {/* Display/Masked Layer */}
              <div className="flex items-center pointer-events-none select-none h-full w-full justify-center sm:justify-start">
                <AnimatePresence mode="popLayout">
                  {displayChars.map((char, index) => {
                    const isMasked = char === '•'
                    const charKey = `${index}-${isMasked ? 'masked' : 'unmasked'}-${char}`
                    return (
                      <motion.span
                        key={charKey}
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -5 }}
                        transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                        className={`inline-block font-mono text-sm sm:text-base ${
                          char === ' ' ? 'w-2' : 'text-foreground'
                        }`}
                      >
                        {char}
                      </motion.span>
                    )
                  })}
                </AnimatePresence>

                {/* Blinking Cursor */}
                {isFocused && !isSizeLimitExceeded && (
                  <motion.span
                    animate={{ opacity: [1, 0] }}
                    transition={{ repeat: Infinity, duration: 0.8 }}
                    className="w-[2px] h-4 bg-emerald-500 dark:bg-emerald-400 ml-0.5"
                  />
                )}

                {/* Placeholder */}
                {!realValue && (
                  <span className="text-muted-foreground/50 font-sans text-xs sm:text-sm pointer-events-none select-none">
                    {isSizeLimitExceeded ? 'Sharing unavailable' : 'Enter WhatsApp number'}
                  </span>
                )}
              </div>

              {/* Invisible native input for capturing events */}
              <input
                ref={inputRef}
                type="tel"
                id="phone-input"
                value={realValue}
                onChange={(e) => {
                  const clean = e.target.value.replace(/\D/g, '').slice(0, 10)
                  setRealValue(clean)
                }}
                onFocus={() => !isSizeLimitExceeded && setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                className="absolute inset-0 w-full h-full opacity-0 cursor-text disabled:cursor-not-allowed"
                maxLength={10}
                autoComplete="off"
                disabled={isSizeLimitExceeded}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex flex-row sm:justify-end gap-2 border-t border-border/50 pt-4 w-full mt-2">
        <Button variant="outline" onClick={onClose} className="flex-1 sm:flex-none">
          Cancel
        </Button>
        <Button
          onClick={handleConfirm}
          disabled={realValue.length !== 10 || isSizeLimitExceeded}
          className="flex-1 sm:flex-none"
        >
          Confirm & Share
        </Button>
      </div>
    </div>
  )

  if (isMobile) {
    return (
      <Drawer open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DrawerContent
          className="p-6 pb-10 bg-background/95 backdrop-blur-xl border-t border-border/50"
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <DrawerTitle className="sr-only">Share to WhatsApp</DrawerTitle>
          <DrawerDescription className="sr-only">Enter the WhatsApp mobile number to share your selected content.</DrawerDescription>
          <div className="overflow-y-auto flex-1 h-full w-full">
            {dialogInnerContent}
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent 
        className="sm:max-w-md border border-border/50 bg-background/95 backdrop-blur-xl p-6 rounded-2xl"
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          inputRef.current?.focus()
        }}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <DialogTitle className="sr-only">Share to WhatsApp</DialogTitle>
        <DialogDescription className="sr-only">Enter the WhatsApp mobile number to share your selected content.</DialogDescription>
        {dialogInnerContent}
      </DialogContent>
    </Dialog>
  )
}
