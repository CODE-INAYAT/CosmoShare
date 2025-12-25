'use client'

import { useRef, useState, useEffect, KeyboardEvent, ClipboardEvent, forwardRef, useImperativeHandle, useCallback } from 'react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'

interface CodeInputProps {
    length?: number
    onComplete: (code: string) => void
    className?: string
    disabled?: boolean
    autoFocus?: boolean
}

export interface CodeInputRef {
    reset: () => void
    focus: () => void
    shake: () => void
}

export const CodeInput = forwardRef<CodeInputRef, CodeInputProps>(({
    length = 4,
    onComplete,
    className,
    disabled = false,
    autoFocus = true
}, ref) => {
    const [values, setValues] = useState<string[]>(Array(length).fill(''))
    const [isShaking, setIsShaking] = useState(false)
    const inputRefs = useRef<(HTMLInputElement | null)[]>([])
    const containerRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (autoFocus && inputRefs.current[0]) {
            inputRefs.current[0].focus()
        }
    }, [autoFocus])

    const focusFirstInput = useCallback(() => {
        // Use requestAnimationFrame to ensure DOM is ready
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                const firstInput = inputRefs.current[0]
                if (firstInput) {
                    firstInput.focus()
                    firstInput.select()
                }
            })
        })
    }, [])

    const triggerShake = useCallback(() => {
        setIsShaking(true)
        setTimeout(() => setIsShaking(false), 500)
    }, [])

    // Expose reset, focus, and shake methods via ref
    useImperativeHandle(ref, () => ({
        reset: () => {
            setValues(Array(length).fill(''))
            triggerShake()
            focusFirstInput()
        },
        focus: () => {
            // Focus on first empty input or last input if all filled
            const firstEmptyIndex = values.findIndex(v => !v)
            const targetIndex = firstEmptyIndex === -1 ? length - 1 : firstEmptyIndex
            inputRefs.current[targetIndex]?.focus()
        },
        shake: () => {
            triggerShake()
        }
    }), [length, values, focusFirstInput, triggerShake])

    const handleChange = (index: number, value: string) => {
        // Only allow digits
        const digit = value.replace(/\D/g, '').slice(-1)

        const newValues = [...values]
        newValues[index] = digit
        setValues(newValues)

        // Move to next input if digit entered
        if (digit && index < length - 1) {
            inputRefs.current[index + 1]?.focus()
        }

        // Check if complete
        const code = newValues.join('')
        if (code.length === length && !newValues.includes('')) {
            onComplete(code)
        }
    }

    const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Backspace') {
            if (!values[index] && index > 0) {
                // Move to previous input on backspace if current is empty
                const newValues = [...values]
                newValues[index - 1] = ''
                setValues(newValues)
                inputRefs.current[index - 1]?.focus()
            }
        } else if (e.key === 'ArrowLeft' && index > 0) {
            inputRefs.current[index - 1]?.focus()
        } else if (e.key === 'ArrowRight' && index < length - 1) {
            inputRefs.current[index + 1]?.focus()
        }
    }

    const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
        e.preventDefault()
        const pastedData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length)

        if (pastedData.length > 0) {
            const newValues = [...values]
            for (let i = 0; i < length; i++) {
                newValues[i] = pastedData[i] || ''
            }
            setValues(newValues)

            // Focus the next empty input or last input
            const lastFilledIndex = Math.min(pastedData.length, length) - 1
            if (lastFilledIndex < length - 1) {
                inputRefs.current[lastFilledIndex + 1]?.focus()
            } else {
                inputRefs.current[lastFilledIndex]?.focus()
            }

            // Check if complete
            const code = newValues.join('')
            if (code.length === length && !newValues.includes('')) {
                onComplete(code)
            }
        }
    }

    const handleFocus = (index: number) => {
        inputRefs.current[index]?.select()
    }

    return (
        <motion.div
            ref={containerRef}
            className={cn("flex gap-2 sm:gap-3 justify-center", className)}
            animate={isShaking ? {
                x: [0, -10, 10, -10, 10, -5, 5, 0],
                transition: { duration: 0.5 }
            } : {}}
        >
            {Array.from({ length }).map((_, index) => (
                <input
                    key={index}
                    ref={(el) => { inputRefs.current[index] = el }}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={1}
                    value={values[index]}
                    onChange={(e) => handleChange(index, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(index, e)}
                    onPaste={handlePaste}
                    onFocus={() => handleFocus(index)}
                    disabled={disabled}
                    className={cn(
                        "w-12 h-14 sm:w-16 sm:h-20 text-center text-2xl sm:text-3xl font-bold",
                        "rounded-xl border-2 border-border bg-secondary/50",
                        "focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none",
                        "transition-all duration-200",
                        "disabled:opacity-50 disabled:cursor-not-allowed",
                        values[index] && "border-primary bg-primary/5",
                        isShaking && "border-destructive bg-destructive/10"
                    )}
                />
            ))}
        </motion.div>
    )
})

CodeInput.displayName = 'CodeInput'
