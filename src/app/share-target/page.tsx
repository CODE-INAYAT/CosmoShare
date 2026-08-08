'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTheme } from 'next-themes'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import Image from 'next/image'
import {
  Loader2,
  Users,
  Zap,
  Shield,
  QrCode,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  Monitor,
  Sun,
  Moon,
  HelpCircle
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { roomNumbers } from '@/config/rooms'
import { URL_OBFUSCATION_ENABLED, encodeUrlData } from '@/config/urlObfuscation'
import { SupportDialog } from '@/components/SupportDialog'
import { getSharedFiles } from '@/lib/shareTargetIdb'

// Animation variants - matching homepage
const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] as const }
  }
}

// Particles component — matching homepage
function Particles() {
  const [particles, setParticles] = useState<Array<{ id: number; left: string; duration: string; delay: string }>>([])

  useEffect(() => {
    const generated = [...Array(20)].map((_, i) => ({
      id: i,
      left: `${Math.random() * 100}%`,
      duration: `${15 + Math.random() * 20}s`,
      delay: `${Math.random() * 10}s`,
    }))
    setParticles(generated)
  }, [])

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {particles.map((particle) => (
        <div
          key={particle.id}
          className="absolute w-1 h-1 bg-primary/30 rounded-full particle"
          style={{
            left: particle.left,
            animationDuration: particle.duration,
            animationDelay: particle.delay,
          }}
        />
      ))}
    </div>
  )
}

// Theme Toggle — matching homepage
function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  if (!mounted) return (
    <div className="w-10 h-10 rounded-xl bg-secondary/50 animate-pulse" />
  )

  return (
    <motion.button
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
      className="relative w-10 h-10 rounded-xl bg-secondary/80 hover:bg-secondary flex items-center justify-center transition-all duration-300 hover:shadow-lg hover:shadow-primary/20"
      aria-label="Toggle theme"
    >
      <AnimatePresence mode="wait">
        {resolvedTheme === 'dark' ? (
          <motion.div
            key="sun"
            initial={{ rotate: -90, opacity: 0 }}
            animate={{ rotate: 0, opacity: 1 }}
            exit={{ rotate: 90, opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <Sun className="w-5 h-5 text-amber-400" />
          </motion.div>
        ) : (
          <motion.div
            key="moon"
            initial={{ rotate: 90, opacity: 0 }}
            animate={{ rotate: 0, opacity: 1 }}
            exit={{ rotate: -90, opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <Moon className="w-5 h-5 text-primary" />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.button>
  )
}

function generateUniqueId(name: string): string {
  const firstChar = name.charAt(0).toUpperCase()
  const randomNum = Math.floor(1000 + Math.random() * 9000)
  return `${firstChar}${randomNum}`
}

function ShareTargetInner() {
  const { resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const [fileCount, setFileCount] = useState<number | null>(null)

  useEffect(() => {
    if (searchParams?.get('error') === 'sw_bypassed') {
      setError('Cannot share files right now. Please ensure the app is open or try again.')
    }
    
    getSharedFiles().then(files => setFileCount(files.length)).catch(() => setFileCount(0))
  }, [searchParams])

  // Portal state - reusing homepage logic
  const [portalTab, setPortalTab] = useState<'oneshare' | 'labshare'>('oneshare')
  const [roomNumber, setRoomNumber] = useState('')
  const [name, setName] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isOneShareLoading, setIsOneShareLoading] = useState(false)
  const [error, setError] = useState('')
  const [suggestedNames, setSuggestedNames] = useState<string[]>([])
  const [roomOpen, setRoomOpen] = useState(false)
  const [supportOpen, setSupportOpen] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  // Prefetch routes
  useEffect(() => {
    router.prefetch('/oneshare')
    router.prefetch('/student')
  }, [router])

  if (!mounted) return null

  const generateNameSuggestions = (baseName: string): string[] => {
    const suggestions: string[] = []
    const firstChar = baseName.charAt(0).toUpperCase()
    for (let i = 1; i <= 3; i++) {
      const randomNum = Math.floor(Math.random() * 1000)
      suggestions.push(`${baseName}_${firstChar}${randomNum}`)
    }
    return suggestions
  }

  const handleStudentSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!roomNumber || !name) {
      setError('Please fill in all fields')
      return
    }
    if (name.length < 3 || name.length > 30) {
      setError('Name must be between 3 and 30 characters')
      return
    }

    setIsLoading(true)
    setError('')

    try {
      const existingNames = ['John', 'Alice', 'Bob']
      const nameExists = existingNames.some(existingName =>
        existingName.toLowerCase() === name.toLowerCase()
      )

      if (nameExists) {
        const suggestions = generateNameSuggestions(name)
        setSuggestedNames(suggestions)
        setError('This name is already taken in this room. Please choose a suggested name or enter a different one.')
        setIsLoading(false)
        return
      }

      const uniqueId = generateUniqueId(name)
      const userData = {
        id: Date.now().toString(),
        name,
        uniqueId,
        roomNumber,
        userType: 'student'
      }

      if (URL_OBFUSCATION_ENABLED) {
        const token = encodeUrlData({ room: roomNumber, user: userData })
        router.push(`/student?s=${token}&shared=true`)
      } else {
        router.push(`/student?room=${roomNumber}&user=${encodeURIComponent(JSON.stringify(userData))}&shared=true`)
      }
    } catch {
      setError('Failed to join room. Please try again.')
      setIsLoading(false)
    }
  }

  const handleSuggestedNameClick = (suggestedName: string) => {
    setName(suggestedName)
    setSuggestedNames([])
    setError('')
  }

  return (
    <div className="min-h-screen bg-background text-foreground overflow-hidden relative flex flex-col transition-colors duration-500">
      {/* Animated Background — matching homepage */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute inset-0 bg-mesh opacity-60" />
        <div className="orb-1 absolute top-[-20%] left-[-10%] w-[600px] h-[600px] rounded-full bg-gradient-to-br from-emerald-500/20 to-teal-500/10 blur-[100px]" />
        <div className="orb-2 absolute top-[40%] right-[-15%] w-[500px] h-[500px] rounded-full bg-gradient-to-br from-teal-500/15 to-cyan-500/10 blur-[80px]" />
        <div className="orb-3 absolute bottom-[-10%] left-[30%] w-[700px] h-[700px] rounded-full bg-gradient-to-br from-cyan-500/10 to-emerald-500/15 blur-[120px]" />
        <div className="absolute inset-0 bg-grid-light dark:bg-grid-dark opacity-40" />
        <Particles />
      </div>

      {/* Minimal top bar with logo + theme toggle */}
      <div className="relative z-10 flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3">
          <Image src="/logo.svg" alt="CosmoShare Logo" width={120} height={40} className="block dark:hidden h-8 sm:h-10 w-auto" priority />
          <Image src="/logoDark.svg" alt="CosmoShare Logo" width={120} height={40} className="hidden dark:block h-8 sm:h-10 w-auto" priority />
          <span className="text-xl font-bold gradient-text">CosmoShare</span>
        </div>
        <ThemeToggle />
      </div>

      {/* Portal Section — reusing exact homepage layout */}
      <div className="relative z-10 flex-1 flex items-center justify-center px-4 pb-8">
        <div className="max-w-5xl mx-auto w-full">
          {/* Section Header */}
          <motion.div
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            className="text-center mb-8"
          >
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-4 leading-tight">
              <span className="gradient-text">Where to Share ?</span>
            </h2>
            <div className="flex justify-center items-center">
              <Badge variant="outline" className="px-3 py-1 text-sm bg-background border-primary/20 text-primary">
                {fileCount === null 
                  ? 'Loading your shared files...' 
                  : `Ready to Share · ${fileCount} File${fileCount === 1 ? '' : 's'}.`}
              </Badge>
            </div>
          </motion.div>

          {/* Primary Toggle (OneShare vs LabShare) */}
          <motion.div
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            className="flex p-1 bg-slate-100 dark:bg-slate-900 rounded-full border border-slate-200 dark:border-slate-800/80 w-fit mx-auto mb-10 relative shadow-[inset_0_1px_2px_rgba(0,0,0,0.05)] dark:shadow-[inset_0_1px_3px_rgba(0,0,0,0.2)]"
          >
            {[
              { id: 'oneshare', label: 'OneShare' },
              { id: 'labshare', label: 'LabShare' }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => {
                  setError('')
                  setPortalTab(tab.id as 'oneshare' | 'labshare')
                }}
                className={`relative px-6 py-2.5 text-sm font-bold rounded-full transition-all duration-200 z-10 ${portalTab === tab.id
                  ? 'text-white dark:text-white'
                  : 'text-slate-500 hover:text-slate-850 dark:text-slate-400 dark:hover:text-slate-100'
                  }`}
              >
                {portalTab === tab.id && (
                  <motion.div
                    layoutId="pwa-tab-bg"
                    className="absolute inset-0 bg-primary rounded-full -z-10 shadow-sm shadow-primary/20"
                    transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                  />
                )}
                {tab.label}
              </button>
            ))}
          </motion.div>

          {/* Conditional Cards with AnimatePresence */}
          <div className="relative min-h-[520px] max-w-md mx-auto">
            <AnimatePresence mode="wait">
              {portalTab === 'oneshare' ? (
                <motion.div
                  key="oneshare-card"
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -15 }}
                  transition={{ duration: 0.25, ease: 'easeInOut' }}
                  className="w-full"
                >
                  <Card className="glass-card shimmer-border rounded-[45px] overflow-hidden">
                    <CardHeader className="text-center pt-8 pb-4">
                      <div className="w-20 h-20 mx-auto mb-4 rounded-[1.75rem] gradient-primary flex items-center justify-center">
                        {isOneShareLoading ? (
                          <Loader2 className="w-10 h-10 text-white animate-spin" />
                        ) : (
                          <QrCode className="w-10 h-10 text-white" />
                        )}
                      </div>
                      <CardTitle className="text-2xl font-bold text-foreground">OneShare</CardTitle>
                      <CardDescription className="text-muted-foreground px-4 text-sm mt-1">
                        Quick peer-to-peer file sharing without joining a room.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="p-6 pt-2 pb-8">
                      <div className="space-y-3 mb-6">
                        {[
                          { text: 'Secure direct device-to-device file transfer', icon: Zap },
                          { text: 'No server storage, files are completely private', icon: Shield },
                          { text: 'Instant connection via QR codes or numeric keys', icon: QrCode }
                        ].map((item, idx) => {
                          const Icon = item.icon
                          return (
                            <div key={idx} className="flex items-center gap-4 py-3.5 px-6 bg-secondary/10 dark:bg-secondary/5 border border-border/5 rounded-full text-left">
                              <Icon className="w-4 h-4 text-primary shrink-0" />
                              <span className="text-sm text-foreground/90 font-medium leading-normal">{item.text}</span>
                            </div>
                          )
                        })}
                      </div>
                      <div className="flex justify-center">
                        <Button
                          onClick={() => {
                            setIsOneShareLoading(true)
                            router.push('/oneshare?shared=true')
                          }}
                          disabled={isOneShareLoading}
                          className="w-fit min-w-[200px] px-8 h-12 gradient-primary text-white rounded-full group flex items-center justify-center font-semibold text-sm transition-opacity hover:opacity-95 glow-button"
                        >
                          {isOneShareLoading ? (
                            <>
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              Launching OneShare...
                            </>
                          ) : (
                            <>
                              Launch OneShare
                              <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-0.5 transition-transform" />
                            </>
                          )}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              ) : (
                <motion.div
                  key="labshare-card"
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -15 }}
                  transition={{ duration: 0.25, ease: 'easeInOut' }}
                  className="w-full"
                >
                  <Card className="glass-card shimmer-border rounded-[45px] overflow-hidden">
                    <CardContent className="p-6 pt-6">
                      <motion.div
                        key="student-form"
                        initial={{ opacity: 0, x: -15 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 15 }}
                        transition={{ duration: 0.2 }}
                      >
                        <div className="text-center pb-6">
                          <motion.div
                            initial={{ opacity: 0, y: 12, scale: 0.94 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            transition={{
                              duration: 0.45,
                              ease: [0.16, 1, 0.3, 1],
                              delay: 0.05
                            }}
                            className="w-20 h-20 mx-auto mb-4 rounded-[1.75rem] gradient-primary flex items-center justify-center"
                          >
                            <Users className="w-10 h-10 text-white" />
                          </motion.div>
                          <h3 className="text-2xl font-bold text-foreground">Lab Portal</h3>
                          <p className="text-sm text-muted-foreground mt-1">Join your lab room to start sharing</p>
                        </div>

                        <form onSubmit={handleStudentSubmit} className="space-y-4">
                          <div className="space-y-1.5">
                            <Label htmlFor="student-room" className="text-muted-foreground text-xs font-medium pl-2">Lab Room Number</Label>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => setRoomOpen(true)}
                              className="w-full justify-between bg-secondary/20 dark:bg-secondary/10 border-border/80 hover:border-primary/50 text-foreground rounded-full h-11 hover:bg-secondary/40 transition-colors pl-4 pr-5 flex items-center"
                            >
                              {roomNumber ? (
                                <span className="font-medium text-foreground">Room {roomNumber}</span>
                              ) : (
                                <span className="text-muted-foreground text-sm">Select Lab Room...</span>
                              )}
                              <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                            </Button>
                          </div>

                          <div className="space-y-1.5">
                            <Label htmlFor="name" className="text-muted-foreground text-xs font-medium pl-2">Your Name</Label>
                            <Input
                              id="name"
                              type="text"
                              placeholder="Enter your name"
                              value={name}
                              onChange={(e) => setName(e.target.value.toUpperCase())}
                              minLength={3}
                              maxLength={30}
                              autoComplete="name"
                              autoCapitalize="characters"
                              className="bg-secondary/20 dark:bg-secondary/10 border-border/80 text-foreground rounded-full h-11 px-5 placeholder:text-muted-foreground focus-visible:ring-primary focus-visible:ring-offset-0 uppercase font-semibold text-sm transition-colors"
                            />
                            <div className="flex items-center justify-between mt-1 px-2">
                              <span className={`text-[11px] transition-colors duration-200 ${name.length === 0
                                ? 'text-muted-foreground'
                                : name.length < 3
                                  ? 'text-red-500 font-medium'
                                  : name.length >= 25
                                    ? 'text-amber-500'
                                    : 'text-muted-foreground'
                                }`}>
                                {name.length === 0
                                  ? 'Min 3 characters'
                                  : name.length < 3
                                    ? `${3 - name.length} more needed`
                                    : `${name.length}/30 characters`}
                              </span>
                              {name.length >= 3 && (
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                              )}
                            </div>
                          </div>

                          {/* Error Message */}
                          {error && (
                            <div className="bg-destructive/5 border border-destructive/20 text-destructive rounded-2xl p-4.5 text-xs flex items-start gap-2.5">
                              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                              <span>{error}</span>
                            </div>
                          )}

                          {/* Suggested Names */}
                          {suggestedNames.length > 0 && (
                            <div className="space-y-1.5">
                              <Label className="text-muted-foreground text-xs font-medium pl-2">Suggested Names</Label>
                              <div className="flex flex-wrap gap-2 px-1">
                                {suggestedNames.map((suggestedName, index) => (
                                  <Badge
                                    key={index}
                                    variant="secondary"
                                    className="bg-secondary hover:bg-primary/20 hover:text-primary cursor-pointer transition-colors rounded-full px-3.5 py-1 font-medium"
                                    onClick={() => handleSuggestedNameClick(suggestedName)}
                                  >
                                    {suggestedName}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}

                          <div className="flex justify-center pt-2">
                            <Button
                              type="submit"
                              className="w-fit min-w-[200px] px-8 h-11 gradient-primary text-white rounded-full group flex items-center justify-center font-semibold text-sm transition-opacity hover:opacity-95 glow-button"
                              disabled={isLoading}
                            >
                              {isLoading ? (
                                <>
                                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                  Joining Room...
                                </>
                              ) : (
                                <>
                                  Join Lab Room
                                  <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-0.5 transition-transform" />
                                </>
                              )}
                            </Button>
                          </div>
                        </form>
                      </motion.div>
                    </CardContent>
                  </Card>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Command Dialog for Selecting Room */}
          <CommandDialog
            open={roomOpen}
            onOpenChange={setRoomOpen}
            title="Select Room"
            description="Choose your lab room"
          >
            <CommandInput placeholder="Search room..." />
            <CommandList className="max-h-[50vh] py-2">
              <CommandEmpty>
                <p className="py-4 text-sm text-muted-foreground text-center">No room found</p>
              </CommandEmpty>
              <CommandGroup>
                {roomNumbers.map((room) => (
                  <CommandItem
                    key={room}
                    value={room}
                    onSelect={(currentValue) => {
                      setRoomNumber(currentValue)
                      setRoomOpen(false)
                    }}
                    className={`flex items-center justify-between mx-2 px-3 py-2.5 rounded-lg cursor-pointer ${roomNumber === room ? 'bg-primary/10' : ''
                      }`}
                  >
                    <span className="flex items-center gap-3">
                      <Monitor className="w-4 h-4" />
                      <span className={roomNumber === room ? 'font-medium' : ''}>
                        Room {room}
                      </span>
                    </span>
                    {roomNumber === room && (
                      <CheckCircle2 className="w-4 h-4 text-primary" />
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </CommandDialog>
        </div>
      </div>

      {/* Floating Help Button */}
      <AnimatePresence>
        <motion.button
          id="support-fab"
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 20 }}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          onClick={() => setSupportOpen(true)}
          className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-50 w-11 h-11 sm:w-14 sm:h-14 rounded-full gradient-primary text-white shadow-lg glow-button flex items-center justify-center cursor-pointer"
          aria-label="Open support"
        >
          <HelpCircle className="w-5 h-5 sm:w-6 sm:h-6" />
        </motion.button>
      </AnimatePresence>

      {/* Footer */}
      <footer className="py-6 md:py-12 px-4 border-t border-border/50">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col items-center justify-center gap-4">
            <p className="text-muted-foreground text-sm md:text-sm text-center" style={{ fontFamily: 'Consolas, monospace' }}>
              Made With <svg className="mx-1 inline-block" style={{ height: '18px', width: '18px' }} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <g id="SVGRepo_bgCarrier" strokeWidth="0"></g>
                <g id="SVGRepo_tracerCarrier" strokeLinecap="round" strokeLinejoin="round"></g>
                <g id="SVGRepo_iconCarrier">
                  <path d="M2 9.1371C2 14 6.01943 16.5914 8.96173 18.9109C10 19.7294 11 20.5 12 20.5C13 20.5 14 19.7294 15.0383 18.9109C17.9806 16.5914 22 14 22 9.1371C22 4.27416 16.4998 0.825464 12 5.50063C7.50016 0.825464 2 4.27416 2 9.1371Z" fill="#e24040"></path>
                </g>
              </svg> By ISK
            </p>
            <SupportDialog externalOpen={supportOpen} onExternalOpenChange={setSupportOpen} hideTrigger={true} />
          </div>
        </div>
      </footer>
    </div>
  )
}

export default function ShareTargetPage() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>}>
      <ShareTargetInner />
    </Suspense>
  )
}
