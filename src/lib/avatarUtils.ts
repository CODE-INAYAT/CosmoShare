
export const generateGradient = (name: string) => {
  const colorGroups: Record<string, string[]> = {
    warm: [
      '#dc2626',
      '#ea580c',
      '#d97706',
      '#ca8a04',
      '#f59e0b',
      '#fbbf24',
      '#facc15',
      '#ef4444',
      '#f97316',
      '#fb923c',
    ],
    cool: [
      '#0891b2',
      '#0d9488',
      '#059669',
      '#16a34a',
      '#2563eb',
      '#4f46e5',
      '#7c3aed',
      '#06b6d4',
      '#14b8a6',
      '#10b981',
    ],
    vibrant: [
      '#ec4899',
      '#be185d',
      '#e11d48',
      '#f43f5e',
      '#fb7185',
      '#f472b6',
      '#ff006e',
      '#fb8500',
      '#ffbe0b',
      '#8338ec',
    ],
    electric: [
      '#8b5cf6',
      '#9333ea',
      '#a855f7',
      '#c084fc',
      '#6366f1',
      '#3b82f6',
      '#7c3aed',
      '#5b21b6',
      '#6d28d9',
      '#581c87',
    ],
    nature: [
      '#65a30d',
      '#84cc16',
      '#22c55e',
      '#10b981',
      '#14b8a6',
      '#06d6a0',
      '#059669',
      '#047857',
      '#065f46',
      '#064e3b',
    ],
    sunset: [
      '#f97316',
      '#fb923c',
      '#f87171',
      '#60a5fa',
      '#0ea5e9',
      '#06b6d4',
      '#ff7c7c',
      '#ff9f43',
      '#ffc93c',
      '#06d6a0',
    ],
  }

  let hash = 0
  for (let i = 0; i < name.length; i++) {
    const char = name.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash
  }

  const absHash = Math.abs(hash)
  const groupNames = Object.keys(colorGroups)
  const selectedGroup = groupNames[absHash % groupNames.length]
  const colors = colorGroups[selectedGroup]

  const color1 = colors[absHash % colors.length]
  const color2 = colors[(absHash + 3) % colors.length]
  const color3 = colors[(absHash + 6) % colors.length]

  const angle = absHash % 360
  const centerX = 25 + (absHash % 50)
  const centerY = 25 + ((absHash * 7) % 50)

  return [
    `conic-gradient(from ${angle}deg at ${centerX}% ${centerY}%, ${color1}95, ${color2}90, ${color3}85, ${color1}95)`,
    `radial-gradient(ellipse 140% 110% at 20% 80%, ${color2}75, transparent 60%)`,
    `radial-gradient(ellipse 120% 140% at 80% 20%, ${color1}70, transparent 65%)`,
    `radial-gradient(ellipse 90% 90% at 70% 70%, ${color3}50, transparent 80%)`,
    `radial-gradient(ellipse 70% 70% at 30% 30%, ${color1}40, transparent 85%)`,
    `linear-gradient(${angle + 45}deg, ${color1}10, transparent 50%, ${color2}15)`,
  ].join(', ')
}
