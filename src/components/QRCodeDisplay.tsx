'use client'

import { useEffect, useRef } from 'react'
import QRCodeStyling from 'qr-code-styling'
import { cn } from '@/lib/utils'

interface QRCodeDisplayProps {
    value: string
    size?: number
    className?: string
    includeMargin?: boolean
}

export function QRCodeDisplay({
    value,
    size = 256,
    className,
    includeMargin = false
}: QRCodeDisplayProps) {
    const ref = useRef<HTMLDivElement>(null)
    const qrCode = useRef<QRCodeStyling | null>(null)

    useEffect(() => {
        if (!qrCode.current) {
            qrCode.current = new QRCodeStyling({
                width: size,
                height: size,
                type: 'svg',
                data: value,
                margin: includeMargin ? 4 : 0,
                qrOptions: {
                    errorCorrectionLevel: 'H'
                },
                dotsOptions: {
                    type: 'dots',
                    color: '#000000',
                    roundSize: true
                },
                cornersSquareOptions: {
                    type: 'extra-rounded',
                    color: '#000000'
                },
                cornersDotOptions: {
                    type: 'dot',
                    color: '#000000'
                },
                backgroundOptions: {
                    color: '#FFFFFF'
                }
            })
        }

        if (ref.current) {
            ref.current.innerHTML = ''
            qrCode.current.append(ref.current)

            // Scale down dots to create gaps (after SVG is rendered)
            setTimeout(() => {
                if (ref.current) {
                    const svg = ref.current.querySelector('svg')
                    if (svg) {
                        // Get all circle elements (dots) but not the corner patterns
                        const circles = svg.querySelectorAll('circle')
                        circles.forEach((circle) => {
                            const r = circle.getAttribute('r')
                            if (r) {
                                // Reduce radius by 25% to create gaps
                                const newRadius = parseFloat(r) * 1.18
                                circle.setAttribute('r', newRadius.toString())
                            }
                        })
                    }
                }
            }, 50)
        }
    }, [])

    useEffect(() => {
        if (qrCode.current) {
            qrCode.current.update({
                data: value,
                width: size,
                height: size,
                margin: includeMargin ? 4 : 0
            })

            // Re-apply dot scaling after update
            setTimeout(() => {
                if (ref.current) {
                    const svg = ref.current.querySelector('svg')
                    if (svg) {
                        const circles = svg.querySelectorAll('circle')
                        circles.forEach((circle) => {
                            const r = circle.getAttribute('r')
                            if (r) {
                                const newRadius = parseFloat(r) * 0.7
                                circle.setAttribute('r', newRadius.toString())
                            }
                        })
                    }
                }
            }, 50)
        }
    }, [value, size, includeMargin])

    return (
        <div className={cn(
            "inline-flex items-center justify-center bg-white rounded-xl shadow-lg overflow-hidden",
            className
        )}>
            <div ref={ref} />
        </div>
    )
}

