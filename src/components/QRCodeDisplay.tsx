'use client'

import { QRCodeSVG } from 'qrcode.react'
import { cn } from '@/lib/utils'

interface QRCodeDisplayProps {
    value: string
    size?: number
    className?: string
    includeMargin?: boolean
}

export function QRCodeDisplay({
    value,
    size = 200,
    className,
    includeMargin = true
}: QRCodeDisplayProps) {
    return (
        <div className={cn(
            "inline-flex items-center justify-center p-4 bg-white rounded-2xl shadow-lg",
            className
        )}>
            <QRCodeSVG
                value={value}
                size={size}
                level="H"
                includeMargin={includeMargin}
                bgColor="#FFFFFF"
                fgColor="#000000"
            />
        </div>
    )
}
