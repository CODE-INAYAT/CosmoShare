'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Share, PlusSquare, ArrowUp } from 'lucide-react'

interface PWAInstallModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  variant?: 'user' | 'admin'
}

/**
 * iOS-specific PWA install instructions modal.
 * Shown when the user taps Download on Safari/iOS which doesn't support
 * the beforeinstallprompt API.
 */
export function PWAInstallModal({ open, onOpenChange, variant = 'user' }: PWAInstallModalProps) {
  const appName = variant === 'admin' ? 'LabShare Admin' : 'CosmoShare'

  const steps = [
    {
      icon: <Share className="w-6 h-6" />,
      title: 'Tap the Share button',
      description: 'Tap the Share icon at the bottom of your Safari browser (the square with an upward arrow).',
    },
    {
      icon: <PlusSquare className="w-6 h-6" />,
      title: 'Add to Home Screen',
      description: 'Scroll down in the share sheet and tap "Add to Home Screen".',
    },
    {
      icon: <ArrowUp className="w-6 h-6" />,
      title: 'Confirm & Launch',
      description: `Tap "Add" to install ${appName}. You'll find the app icon on your home screen.`,
    },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">Install {appName}</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Follow these steps to add {appName} to your home screen for the best experience.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-4">
          {steps.map((step, idx) => (
            <div key={idx} className="flex items-start gap-4">
              <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-primary/10 text-primary shrink-0 border border-primary/20">
                {step.icon}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm mb-0.5">
                  <span className="text-primary mr-1.5">Step {idx + 1}.</span>
                  {step.title}
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">{step.description}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-end pt-2">
          <Button
            onClick={() => onOpenChange(false)}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            Got it
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
