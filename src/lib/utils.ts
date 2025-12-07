import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Format bytes into human-readable string (KB, MB, GB) with up to one decimal
export function formatBytes(bytes?: number): string {
  if (!bytes || bytes < 0) return '0 B'
  const thresh = 1024
  if (bytes < thresh) return `${bytes} B`
  const units = ['KB','MB','GB','TB']
  let u = -1
  let value = bytes
  do {
    value /= thresh
    ++u
  } while (value >= thresh && u < units.length - 1)
  return `${value.toFixed(value >= 100 || value < 10 ? 0 : 1)} ${units[u]}`
}
