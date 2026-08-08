'use client'
export const runtime = 'edge'

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTheme } from 'next-themes'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Loader2,
  Users,
  Printer,
  Wifi,
  Monitor,
  FileText,
  Share2,
  Zap,
  Shield,
  Globe,
  ArrowRight,
  Sparkles,
  UserPlus,
  MonitorSmartphone,
  Upload,
  Download,
  Sun,
  Moon,
  ChevronDown,
  Clock,
  CheckCircle2,
  Star,
  Heart,
  Layers,
  Radio,
  Files,
  ShieldCheck,
  Rocket,
  QrCode,
  HelpCircle,
  AlertCircle,
  Play
} from 'lucide-react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { roomNumbers } from '@/config/rooms'
import { AUTO_LOGIN_ENABLED, AUTO_LOGIN_PASSWORD, hashPassword, verifyHash } from '@/config/autoLogin'
import { URL_OBFUSCATION_ENABLED, encodeUrlData } from '@/config/urlObfuscation'
import { SupportDialog } from '@/components/SupportDialog'
import { trackVisitor } from '@/config/analytics'
import { StaggeredMenu } from '@/components/StaggeredMenu'
import { VIDEO_CONFIG, VIDEO_PREVIEW_ENABLED } from '@/config/videoConfig'
import { VideoModal } from '@/components/VideoModal'
import { usePWAInstall } from '@/hooks/usePWAInstall'
import { PWAInstallModal } from '@/components/PWAInstallModal'

// Register GSAP plugins
if (typeof window !== 'undefined') {
  gsap.registerPlugin(ScrollTrigger)
}

// Animation variants — GPU-composited transforms only (opacity + translate)
const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] as const }
  }
}

const fadeIn = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: 0.5, ease: 'easeOut' as const }
  }
}

const scaleIn = {
  hidden: { opacity: 0, scale: 0.92 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] as const }
  }
}

const staggerContainer = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.05
    }
  }
}

const slideFromLeft = {
  hidden: { opacity: 0, x: -40 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] as const }
  }
}

const slideFromRight = {
  hidden: { opacity: 0, x: 40 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] as const }
  }
}

const scaleUp = {
  hidden: { opacity: 0, scale: 0.85, y: 20 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] as const }
  }
}

const staggerGrid = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.15,
      delayChildren: 0.1
    }
  }
}

// How It Works steps data (used when VIDEO_PREVIEW_ENABLED is false)
const howItWorksSteps = [
  {
    step: '1',
    icon: Upload,
    title: 'Upload Your Files',
    description: 'Select and upload any files you want to share. No account or sign-up required — just drag, drop, and go.'
  },
  {
    step: '2',
    icon: Share2,
    title: 'Share the Link',
    description: 'Get an instant shareable link or QR code. Send it to anyone via chat, email, or any messaging platform.'
  },
  {
    step: '3',
    icon: Download,
    title: 'Download Anywhere',
    description: 'Recipients can download files instantly on any device — desktop, tablet, or mobile. Fast, secure, and seamless.'
  }
]

// Floating particles component
function Particles() {
  const [particles, setParticles] = useState<Array<{ id: number; left: string; duration: string; delay: string }>>([])

  useEffect(() => {
    // Generate particles only on client side to avoid hydration mismatch
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

// Theme Toggle Component
function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme()
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

export default function Home() {
  const { theme, setTheme, resolvedTheme } = useTheme()
  const [portalTab, setPortalTab] = useState<'oneshare' | 'labshare'>('oneshare')
  const [roomNumber, setRoomNumber] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isOneShareLoading, setIsOneShareLoading] = useState(false)
  const [error, setError] = useState('')
  const [suggestedNames, setSuggestedNames] = useState<string[]>([])
  const [mounted, setMounted] = useState(false)
  const [isScrolled, setIsScrolled] = useState(false)
  const [roomOpen, setRoomOpen] = useState(false)
  const [supportOpen, setSupportOpen] = useState(false)
  const [isNavAnimated, setIsNavAnimated] = useState(true)
  const [isMenuScrolling, setIsMenuScrolling] = useState(false)
  const router = useRouter()

  // PWA standalone check
  const [isStandalone, setIsStandalone] = useState(false)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setIsStandalone(
        window.matchMedia('(display-mode: standalone)').matches ||
        window.matchMedia('(display-mode: fullscreen)').matches ||
        (window.navigator as any).standalone === true
      )
    }
  }, [])

  // PWA install
  const { isInstallable, isInstalled, isIOS, promptInstall } = usePWAInstall()
  const [showIOSModal, setShowIOSModal] = useState(false)
  const [iosModalVariant, setIosModalVariant] = useState<'user' | 'admin'>('user')

  const handleDownload = (variant: 'user' | 'admin') => {
    if (isIOS) {
      setIosModalVariant(variant)
      setShowIOSModal(true)
      return
    }
    if (variant === 'admin') {
      promptInstall('/manifest-admin.webmanifest')
    } else {
      promptInstall()
    }
  }

  const showDownloadButton = (isInstallable && !isInstalled) || isIOS

  // Refs for GSAP animations
  const heroRef = useRef<HTMLDivElement>(null)
  const portalRef = useRef<HTMLDivElement>(null)
  const howItWorksRef = useRef<HTMLDivElement>(null)
  const featuresRef = useRef<HTMLDivElement>(null)
  const featuresContainerRef = useRef<HTMLDivElement>(null)
  const ctaRef = useRef<HTMLDivElement>(null)
  const footerRef = useRef<HTMLElement>(null)
  const navRef = useRef<HTMLElement>(null)
  const videoIndexRef = useRef<'oneshare' | 'labshare'>('oneshare')
  const [showFab, setShowFab] = useState(false)
  const [activeVideo, setActiveVideo] = useState<string | null>(null)

  useEffect(() => {
    setMounted(true)
    // Generate a unique hash on every page load for auto-login
    if (AUTO_LOGIN_ENABLED) setPassword(hashPassword())
    // Track unique visitor per session
    trackVisitor()

    // Clear entrance animation class from navbar after completion (600ms + buffer)
    const timer = setTimeout(() => {
      setIsNavAnimated(false)
    }, 1000)
    return () => clearTimeout(timer)
  }, [])

  // Prefetch destination routes so bundles are cached before user clicks
  useEffect(() => {
    router.prefetch('/oneshare')
    router.prefetch('/student')
    router.prefetch('/admin')
  }, [router])

  // Track scroll position to transition the navbar
  useEffect(() => {
    if (!mounted) return

    const handleScroll = () => {
      setIsScrolled(window.scrollY > 0)
    }

    handleScroll()
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [mounted])

  // Hide FAB when hero or footer is visible
  useEffect(() => {
    if (!mounted) return
    const targets = [heroRef.current, footerRef.current].filter(Boolean) as Element[]
    if (targets.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        const anyVisible = entries.some((e) => e.isIntersecting)
        setShowFab(!anyVisible)
      },
      { threshold: 0.15 }
    )
    targets.forEach((t) => observer.observe(t))
    return () => observer.disconnect()
  }, [mounted])

  // GSAP Animations with Enhanced Parallax and Horizontal Scroll
  useEffect(() => {
    if (!mounted) return

    const ctx = gsap.context(() => {
      // ============================================
      // HERO SECTION - Parallax & Text Animations
      // ============================================

      // Hero title animation - animate the whole title with dramatic entrance
      // (Avoid text splitting since title contains styled HTML children)
      gsap.fromTo('.hero-title',
        {
          opacity: 0,
          y: 100,
          scale: 0.9,
          rotateX: -15
        },
        {
          opacity: 1,
          y: 0,
          scale: 1,
          rotateX: 0,
          duration: 1.2,
          ease: 'elastic.out(1, 0.5)',
          delay: 0.2
        }
      )

      // Animate the gradient text inside hero title with a separate effect
      gsap.fromTo('.hero-title .gradient-text-animated, .hero-title .text-primary',
        {
          opacity: 0,
          scale: 0.8,
          filter: 'blur(10px)'
        },
        {
          opacity: 1,
          scale: 1,
          filter: 'blur(0px)',
          duration: 0.8,
          ease: 'power3.out',
          delay: 0.6,
          stagger: 0.2
        }
      )

      // Hero subtitle with smooth fade
      gsap.fromTo('.hero-subtitle',
        { opacity: 0, y: 60, filter: 'blur(10px)' },
        { opacity: 1, y: 0, filter: 'blur(0px)', duration: 1, ease: 'power3.out', delay: 0.8 }
      )

      // Hero CTA buttons with bounce
      gsap.fromTo('.hero-cta',
        { opacity: 0, y: 40, scale: 0.9 },
        { opacity: 1, y: 0, scale: 1, duration: 0.7, ease: 'elastic.out(1, 0.5)', delay: 1.1, stagger: 0.15 }
      )

      // Enhanced floating card parallax with depth
      gsap.to('.floating-card', {
        y: -80,
        scale: 0.95,
        scrollTrigger: {
          trigger: heroRef.current,
          start: 'top top',
          end: 'bottom top',
          scrub: 1.5
        }
      })

      // Hero content parallax - moves slower than scroll
      gsap.to('.hero-content-parallax', {
        y: 150,
        scrollTrigger: {
          trigger: heroRef.current,
          start: 'top top',
          end: 'bottom top',
          scrub: 2
        }
      })

      // Background orbs are handled purely by CSS animations
      // (no GSAP parallax — combining scroll-driven transforms with blur is expensive)

      // ============================================
      // ============================================
      // HOW IT WORKS — Video Card Stack Animation
      // ============================================

      if (howItWorksRef.current && VIDEO_PREVIEW_ENABLED) {
        const section = howItWorksRef.current;
        const previewContainer = section.querySelector('.video-preview-container') as HTMLElement
        const previewCard = section.querySelector('.video-preview-card') as HTMLElement
        const oneshareThumbnail = section.querySelector('.oneshare-thumbnail') as HTMLElement
        const labshareThumbnail = section.querySelector('.labshare-thumbnail') as HTMLElement

        if (previewContainer && previewCard && oneshareThumbnail && labshareThumbnail) {
          // A long scroll distance creates a controlled, immersive, slow animation
          const scrollDistance = Math.max(800, window.innerHeight * 1.2);

          // Calculate available space in viewport (accounting for 80px sticky navbar)
          const navbarHeight = 80;
          
          // The true visual center of the viewport (below the navbar)
          const startTrigger = () => {
            const availableHeight = window.innerHeight - navbarHeight;
            const scrollerCenter = navbarHeight + (availableHeight / 2);
            return `center ${scrollerCenter}px`;
          };

          // Function to dynamically calculate the perfect scale (UP or DOWN)
          // Ensures the card fills ~85% of available height but never overflows 90% of screen width.
          const getTargetScale = () => {
            const availableHeight = window.innerHeight - navbarHeight;
            const maxAllowedHeight = availableHeight * 0.85;
            const maxAllowedWidth = window.innerWidth * 0.9;
            const scaleY = maxAllowedHeight / (previewCard.offsetHeight || 1);
            const scaleX = maxAllowedWidth / (previewCard.offsetWidth || 1);
            return Math.min(scaleX, scaleY);
          };

          // Apply scale permanently so it maintains the correct size at all times
          const applyPermanentScale = () => {
            gsap.set(previewCard, { scale: getTargetScale() });
          };
          
          applyPermanentScale();
          ScrollTrigger.addEventListener('refreshInit', applyPermanentScale);

          // Pin the entire section exactly when the card is visually centred (accounting for navbar)
          ScrollTrigger.create({
            trigger: previewContainer,
            start: startTrigger,
            end: () => `+=${scrollDistance}`,
            pin: section,
            pinSpacing: true,
            anticipatePin: 1,
            invalidateOnRefresh: true,
          })

          const tl = gsap.timeline({
            scrollTrigger: {
              trigger: previewContainer,
              start: startTrigger,
              end: () => `+=${scrollDistance}`,
              scrub: 1.2,
              invalidateOnRefresh: true,
              onUpdate: (self) => {
                // Switch video ref halfway through the fly-through phase
                const activeIdx = self.progress > 0.5 ? 'labshare' : 'oneshare';
                if (videoIndexRef.current !== activeIdx) {
                  videoIndexRef.current = activeIdx;
                }
              }
            }
          })

          // Fly-through effect takes up the entire scroll duration
          tl.fromTo(oneshareThumbnail,
            { scale: 1, opacity: 1 },
            { scale: 3, opacity: 0, ease: 'power1.inOut' },
            0
          )
          
          tl.fromTo(labshareThumbnail,
            { scale: 0.7, opacity: 0 },
            { scale: 1, opacity: 1, ease: 'power1.inOut' },
            0
          )
        }
      }

      // ============================================
      // FEATURES SECTION - Horizontal Scroll Carousel
      // ============================================

      if (featuresRef.current) {
        const section = featuresRef.current
        const scrollWrapper = section.querySelector('.horizontal-scroll-wrapper') as HTMLElement
        const cardsContainer = section.querySelector('.horizontal-cards-container') as HTMLElement
        const cards = gsap.utils.toArray('.feature-scroll-card') as HTMLElement[]
        const numCards = cards.length

        if (numCards > 0 && cardsContainer && scrollWrapper) {
          const firstCard = cards[0]
          const cardWidth = firstCard ? firstCard.offsetWidth : (window.innerWidth < 768 ? 320 : 400)
          const cardGap = window.innerWidth < 768 ? 16 : 32
          const navbarHeight = 80
          const viewportHeight = window.innerHeight
          const cardHeight = firstCard ? firstCard.offsetHeight : 280
          const containerPaddingTop = 24
          const totalCardsAreaHeight = cardHeight + containerPaddingTop
          const availableHeight = viewportHeight - navbarHeight
          const perfectGap = Math.max(0, (availableHeight - totalCardsAreaHeight) / 2)
          const perfectStartPosition = navbarHeight + perfectGap
          const totalCardsWidth = (cardWidth + cardGap) * numCards - cardGap
          const scrollDistance = Math.max(0, totalCardsWidth - cardWidth)

          gsap.to(cardsContainer, {
            x: -scrollDistance,
            ease: 'none',
            scrollTrigger: {
              trigger: scrollWrapper,
              start: `top ${perfectStartPosition}px`,
              end: () => `+=${scrollDistance + 100}`,
              pin: true,
              pinSpacing: true,
              scrub: 1,
              anticipatePin: 1,
              invalidateOnRefresh: true
            }
          })

          // Subtle hover effects
          cards.forEach((card) => {
            card.addEventListener('mouseenter', () => {
              gsap.to(card, {
                y: -5,
                boxShadow: '0 25px 50px rgba(0, 134, 124, 0.15)',
                duration: 0.3,
                ease: 'power2.out'
              })
            })
            card.addEventListener('mouseleave', () => {
              gsap.to(card, {
                y: 0,
                boxShadow: '0 10px 40px rgba(0, 0, 0, 0.08)',
                duration: 0.3,
                ease: 'power2.out'
              })
            })
          })
        }
      }

      // ============================================
      // SCROLL PROGRESS INDICATOR
      // ============================================

      const progressBar = document.querySelector('.scroll-progress-bar')
      if (progressBar) {
        gsap.to(progressBar, {
          scaleX: 1,
          ease: 'none',
          scrollTrigger: {
            trigger: 'body',
            start: 'top top',
            end: 'bottom bottom',
            scrub: 0.3
          }
        })
      }
    })

    return () => ctx.revert()
  }, [mounted])

  const scrollToSection = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    e.preventDefault()
    setIsMenuScrolling(true)
    const element = document.getElementById(id)
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' })
      window.history.pushState(null, '', `#${id}`)
    }
    setTimeout(() => {
      setIsMenuScrolling(false)
    }, 1200)
  }

  const generateUniqueId = (name: string) => {
    const firstChar = name.charAt(0).toUpperCase()
    const randomNum = Math.floor(1000 + Math.random() * 9000)
    return `${firstChar}${randomNum}`
  }

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
        router.push(`/student?s=${token}`)
      } else {
        router.push(`/student?room=${roomNumber}&user=${encodeURIComponent(JSON.stringify(userData))}`)
      }
    } catch (error) {
      setError('Failed to join room. Please try again.')
      setIsLoading(false)
    }
  }

  const handleSuggestedNameClick = (suggestedName: string) => {
    setName(suggestedName)
    setSuggestedNames([])
    setError('')
  }

  const features = [
    {
      icon: Share2,
      title: 'P2P File Sharing',
      description: 'Lightning-fast peer-to-peer transfers using Seamless Real-Time Connectivity. No server upload required.',
      color: 'from-blue-500 to-sky-500'
    },
    {
      icon: Printer,
      title: 'Smart Print Queue',
      description: 'Submit files for printing with custom settings, messages, and priority levels.',
      color: 'from-emerald-500 to-green-500'
    },
    {
      icon: Globe,
      title: 'Link Sharing',
      description: 'Share and preview links like Google Docs, Sheets, and more with instant previews.',
      color: 'from-amber-400 to-yellow-500'
    },
    {
      icon: Radio,
      title: 'Real-time Connection',
      description: 'Live peer-to-peer streaming with instant connectivity and zero latency communication.',
      color: 'from-violet-500 to-purple-500'
    },
    {
      icon: Files,
      title: 'Batch File Transfer',
      description: 'Send multiple files simultaneously with progress tracking for each file.',
      color: 'from-red-500 to-orange-500'
    },
    {
      icon: ShieldCheck,
      title: 'Secure Connection',
      description: 'End-to-end encryption with zero-knowledge architecture for maximum privacy.',
      color: 'from-rose-500 to-pink-500'
    }
  ]

  const howItWorksSteps = [
    {
      step: 1,
      title: 'Join Your Lab Room',
      description: 'Enter your lab room number and name to connect with peers in the same room',
      icon: Wifi
    },
    {
      step: 2,
      title: 'Select Recipients & Share',
      description: 'Choose online peers from your room and share files directly via P2P or send to admin printer',
      icon: Users
    },
    {
      step: 3,
      title: 'Admin Manages Print Queue',
      description: 'Lab admin receives print requests and manages the queue for efficient printing',
      icon: Printer
    }
  ]

  const benefits = [
    'Real-time peer-to-peer connections',
    'No file size limits',
    'End-to-end encryption',
    'Cross-platform support'
  ]

  if (!mounted) return null

  return (
    <div className="min-h-screen bg-background text-foreground overflow-hidden relative transition-colors duration-500">
      {/* Scroll Progress Bar */}
      <div className="scroll-progress-bar" style={{ transform: 'scaleX(0)' }} />

      {/* Animated Background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        {/* Gradient Mesh */}
        <div className="absolute inset-0 bg-mesh opacity-60" />

        {/* Animated Orbs */}
        <div className="orb-1 absolute top-[-20%] left-[-10%] w-[600px] h-[600px] rounded-full bg-gradient-to-br from-emerald-500/20 to-teal-500/10 blur-[100px]" />
        <div className="orb-2 absolute top-[40%] right-[-15%] w-[500px] h-[500px] rounded-full bg-gradient-to-br from-teal-500/15 to-cyan-500/10 blur-[80px]" />
        <div className="orb-3 absolute bottom-[-10%] left-[30%] w-[700px] h-[700px] rounded-full bg-gradient-to-br from-cyan-500/10 to-emerald-500/15 blur-[120px]" />

        {/* Grid Background */}
        <div className="absolute inset-0 bg-grid-light dark:bg-grid-dark opacity-40" />

        {/* Particles */}
        <Particles />
      </div>

      {/* Navbar */}
      <nav
        ref={navRef}
        className={`fixed top-0 left-0 right-0 z-50 flex justify-center pointer-events-none ${isNavAnimated ? 'nav-slide-down' : ''}`}
      >
        <div
          className={`flex items-center justify-between pointer-events-auto transition-all duration-500 cubic-bezier(0.16, 1, 0.3, 1) backdrop-blur-md bg-white/70 dark:bg-slate-950/60 ${isScrolled
            ? 'w-full max-w-full rounded-none px-6 py-2 border-0 border-b border-border/20 shadow-md mt-0'
            : 'w-[calc(100%-2rem)] max-w-7xl rounded-2xl px-6 py-2.5 border border-border/10 mt-4'
            }`}
        >
          <div className="flex items-center gap-3">
            <Image src="/logo.svg" alt="CosmoShare Logo" width={120} height={40} className="block dark:hidden h-8 sm:h-10 w-auto" priority />
            <Image src="/logoDark.svg" alt="CosmoShare Logo" width={120} height={40} className="hidden dark:block h-8 sm:h-10 w-auto" priority />
            <span className="text-xl font-bold gradient-text">CosmoShare</span>
          </div>

          <div className="hidden md:flex items-center gap-8">
            <a href="#portal" onClick={(e) => scrollToSection(e, 'portal')} className="text-muted-foreground hover:text-foreground transition-colors text-sm font-medium">Get Started</a>
            <a href="#how-it-works" onClick={(e) => scrollToSection(e, 'how-it-works')} className="text-muted-foreground hover:text-foreground transition-colors text-sm font-medium">How It Works</a>
            <a href="#features" onClick={(e) => scrollToSection(e, 'features')} className="text-muted-foreground hover:text-foreground transition-colors text-sm font-medium">Features</a>
          </div>

          <div className="flex items-center gap-3">
            {/* Desktop Download Dropdown */}
            {showDownloadButton && (
              <div className="hidden md:flex">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2 border-primary/30 text-primary hover:bg-primary/10 hover:text-primary hover:border-primary/50 transition-all"
                    >
                      <Download className="w-4 h-4" />
                      Download
                      <ChevronDown className="w-3 h-3 opacity-60" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuItem onClick={() => handleDownload('user')} className="gap-3 py-2.5">
                      <Download className="w-4 h-4 text-primary" />
                      <div>
                        <p className="font-medium text-sm">Download</p>
                        <p className="text-xs text-muted-foreground">Install CosmoShare app</p>
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleDownload('admin')} className="gap-3 py-2.5">
                      <Printer className="w-4 h-4 text-teal-500" />
                      <div>
                        <p className="font-medium text-sm">Download (LabShare Admin)</p>
                        <p className="text-xs text-muted-foreground">Install admin dashboard app</p>
                      </div>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}

            {/* Desktop ThemeToggle */}
            <div className="hidden md:flex">
              <ThemeToggle />
            </div>

            {/* Mobile Hamburger Menu Portal Target */}
            <div id="mobile-menu-trigger" className="md:hidden flex items-center" />

            <Button
              className="gradient-primary text-white hover:opacity-90 transition-opacity hidden sm:flex glow-button"
              onClick={() => document.getElementById('portal')?.scrollIntoView({ behavior: 'smooth' })}
            >
              <UserPlus className="w-4 h-4 mr-2" />
              Join Room
            </Button>
          </div>
        </div>
      </nav>

      {/* Mobile Staggered Menu Panel Overlay (controlled via Portal for trigger button) */}
      <StaggeredMenu
        isFixed={true}
        logoUrl={resolvedTheme === 'dark' ? '/logoDark.svg' : '/logo.svg'}
        menuButtonColor={resolvedTheme === 'dark' ? '#fff' : '#0f172a'}
        openMenuButtonColor={resolvedTheme === 'dark' ? '#fff' : '#0f172a'}
        accentColor="#14b8a6"
        colors={resolvedTheme === 'dark' ? ['#022c22', '#0f766e', '#115e59'] : ['#ccfbf1', '#2dd4bf', '#0d9488']}
        items={[
          { label: 'Get Started', ariaLabel: 'Get Started Section', link: '#portal' },
          { label: 'How It Works', ariaLabel: 'How It Works Section', link: '#how-it-works' },
          { label: 'Features', ariaLabel: 'Features Section', link: '#features' },
          ...(showDownloadButton ? [
            { label: 'Download', ariaLabel: 'Install CosmoShare App', link: '#download' },
            { label: 'Download Admin', ariaLabel: 'Install LabShare Admin App', link: '#download-admin' }
          ] : [])
        ]}
        onItemClick={(item, e) => {
          e.preventDefault();
          // Handle download items in mobile menu
          if (item.link === '#download') {
            handleDownload('user');
            return;
          }
          if (item.link === '#download-admin') {
            handleDownload('admin');
            return;
          }
          setIsMenuScrolling(true);
          const targetId = item.link.replace('#', '');
          const element = document.getElementById(targetId);
          if (element) {
            element.scrollIntoView({ behavior: 'smooth' });
            window.history.pushState(null, '', item.link);
          }
          setTimeout(() => {
            setIsMenuScrolling(false);
          }, 1200);
        }}
        displaySocials={false}
        displayItemNumbering={true}
      />

      {/* Hero Section */}
      <section ref={heroRef} className="relative pt-32 pb-20 px-4 min-h-screen flex items-center">
        <div className="max-w-7xl mx-auto w-full">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            {/* Left Content */}
            <div className="text-center lg:text-left">
              {/* Main Headline */}
              <h1 className="hero-title text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold mb-6 leading-tight tracking-tight">
                <span className="gradient-text-animated">Share Smarter. </span>
                <span className="text-foreground">Share </span>
                <span className="text-foreground">Anything, </span>
                <span className="text-primary">Anytime</span>
              </h1>

              {/* Subtitle */}
              <p className="hero-subtitle text-lg md:text-xl text-muted-foreground mb-10 max-w-xl mx-auto lg:mx-0 leading-relaxed">
                Peer-to-peer sharing for lab environments and beyond.
                Share files, links, and code, submit print requests,
                collaborate seamlessly, and do much more.
              </p>

              {/* CTA Buttons */}
              <div className="hero-cta flex flex-col max-sm:items-center sm:flex-row gap-4 justify-center lg:justify-start">
                <Button
                  size="lg"
                  className="gradient-primary text-white px-6 md:px-8 py-4 md:py-6 text-base md:text-lg rounded-xl glow-button hover:opacity-90 transition-all group magnetic-btn max-sm:w-64 max-sm:h-12 max-sm:py-0 max-sm:font-semibold"
                  onClick={() => document.getElementById('portal')?.scrollIntoView({ behavior: 'smooth' })}
                >
                  Get Started Free
                  <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="border-border hover:bg-secondary px-6 md:px-8 py-4 md:py-6 text-base md:text-lg rounded-xl transition-all max-sm:w-64 max-sm:h-12 max-sm:py-0 max-sm:font-semibold"
                  onClick={() => document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' })}
                >
                  <Layers className="w-5 h-5 mr-2" />
                  How It Works
                </Button>
              </div>

              {/* Benefits */}
              <div className="hero-cta mt-10 grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-md mx-auto lg:mx-0">
                {benefits.map((benefit, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm text-muted-foreground">
                    <CheckCircle2 className="w-4 h-4 text-primary flex-shrink-0" />
                    <span>{benefit}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Right Content - Floating Card */}
            <div className="relative hidden lg:block">
              <div className="relative">
                {/* Main floating card */}
                <motion.div
                  animate={{ y: [0, -10, 0] }}
                  transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
                  className="floating-card glass-card rounded-3xl p-8 shimmer-border"
                >
                  <div className="flex items-center gap-4 mb-6">
                    <div className="w-12 h-12 rounded-xl gradient-primary flex items-center justify-center">
                      <Upload className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground">File Transfer</h3>
                      <p className="text-sm text-muted-foreground">Sending to 3 peers...</p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">project_files.zip</span>
                      <span className="text-sm text-primary font-medium">78%</span>
                    </div>
                    <div className="h-2 bg-secondary rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: "78%" }}
                        transition={{ duration: 2, delay: 0.5 }}
                        className="h-full gradient-primary rounded-full"
                      />
                    </div>
                  </div>
                </motion.div>

                {/* Floating elements */}
                <motion.div
                  animate={{ y: [0, 15, 0] }}
                  transition={{ duration: 4, repeat: Infinity, ease: "easeInOut", delay: 1 }}
                  className="absolute -top-8 -right-8 glass-card p-4 rounded-2xl"
                >
                  <Shield className="w-8 h-8 text-primary" />
                </motion.div>

                <motion.div
                  animate={{ y: [0, -15, 0] }}
                  transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay: 2 }}
                  className="absolute -bottom-6 -left-6 glass-card p-4 rounded-2xl"
                >
                  <Zap className="w-8 h-8 text-amber-500" />
                </motion.div>
              </div>
            </div>
          </div>

          {/* Scroll indicator */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.5 }}
            className="absolute bottom-6 md:bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2"
          >
            <span className="text-xs text-muted-foreground">Scroll to explore</span>
            <motion.div
              animate={{ y: [0, 8, 0] }}
              transition={{ duration: 1.5, repeat: Infinity }}
            >
              <ChevronDown className="w-5 h-5 text-muted-foreground" />
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Portal Section */}
      <section ref={portalRef} id="portal" className="py-16 md:py-24 px-4 relative scroll-mt-20">
        <div className="max-w-5xl mx-auto">
          {/* Section Header */}
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: isMenuScrolling ? 0.2 : 0.8, margin: isMenuScrolling ? undefined : "-15% 0px -35% 0px" }}
            variants={fadeUp}
            className="text-center mb-8"
          >
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-4 leading-tight">
              <span className="gradient-text">Get Started</span>
            </h2>
            <p className="text-muted-foreground text-sm sm:text-base md:text-lg max-w-xl mx-auto leading-relaxed">
              Select OneShare for quick peer-to-peer transfers, or LabShare to collaborate 'within Lab rooms.
            </p>
          </motion.div>

          {/* Primary Toggle (OneShare vs LabShare) */}
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
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
                    layoutId="primary-tab-bg"
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
                            router.push('/oneshare')
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

                              {/* Secondary Admin CTA */}
                              <div className="flex justify-center pt-1">
                                <button
                                  type="button"
                                  onClick={() => router.push('/admin')}
                                  className="group inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors duration-300"
                                >
                                  <span className="border-b border-dashed border-muted-foreground/40 group-hover:border-primary/60 transition-colors pb-px">Want to join as Lab Admin?</span>
                                  <span className="font-semibold text-primary/80 group-hover:text-primary transition-colors flex items-center gap-0.5">
                                    Click here
                                    <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                                  </span>
                                </button>
                              </div>
                            </form>
                      </motion.div>
                    </CardContent>
                  </Card>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
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
                    <CheckCircle2 className="h-4 w-4" />
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </CommandDialog>
      </section>

      {/* How It Works Section */}
      {VIDEO_PREVIEW_ENABLED ? (
        <section ref={howItWorksRef} id="how-it-works" className="py-12 md:py-20 px-4 relative scroll-mt-20">
          <div className="max-w-5xl mx-auto">
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: isMenuScrolling ? 0.2 : 0.8, margin: isMenuScrolling ? undefined : "-15% 0px -35% 0px" }}
              variants={fadeUp}
              className="text-center mb-10"
            >
              <div className="inline-flex items-center gap-2 glass px-4 py-2 rounded-full mb-6">
                <Play className="w-4 h-4 text-primary" />
                <span className="text-sm text-muted-foreground">See it in action</span>
              </div>
              <h2 className="text-3xl md:text-5xl font-bold mb-4">
                How It{' '}
                <span className="gradient-text">Works</span>
              </h2>
              <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
                Experience the seamless workflow of OneShare and LabShare
              </p>
            </motion.div>

            {/* Unified Video Preview Container — GSAP pins this */}
            <div className="video-preview-container relative w-full">
              <div className="video-preview-card relative w-full origin-center will-change-transform">
                <div className="glass-card rounded-[45px] shadow-2xl relative overflow-hidden group bg-background/80 backdrop-blur-xl border-primary/20">
                  <div className="relative aspect-[16/9] w-full overflow-hidden bg-black/5">
                    
                    {/* Base Thumbnail (OneShare) — Flies forward and fades out */}
                    <div className="oneshare-thumbnail absolute inset-0 origin-center will-change-[opacity,transform]">
                      <Image
                        src="/thumbnail_OneShare.jpg"
                        alt="OneShare Video Thumbnail"
                        fill
                        className="object-cover transition-transform duration-700 group-hover:scale-105"
                      />
                    </div>
                    
                    {/* Incoming Thumbnail (LabShare) — Faded in by GSAP */}
                    <div className="labshare-thumbnail absolute inset-0 opacity-0 will-change-[opacity,transform]">
                      <Image
                        src="/thumbnail_LabShare.jpg"
                        alt="LabShare Video Thumbnail"
                        fill
                        className="object-cover transition-transform duration-700 group-hover:scale-105"
                      />
                    </div>
                    
                    {/* Overlay and Dynamic Play Button */}
                    <div className="absolute inset-0 bg-black/20 group-hover:bg-black/30 transition-colors duration-500 flex items-center justify-center">
                      <motion.button
                        onClick={() => setActiveVideo(VIDEO_CONFIG[videoIndexRef.current])}
                        className="relative w-16 h-16 md:w-20 md:h-20 rounded-full bg-black/10 backdrop-blur-md border border-white/30 flex items-center justify-center cursor-pointer z-10 transition-colors duration-300 hover:bg-white/20 shadow-2xl"
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        aria-label="Play Video"
                      >
                        <Play className="w-6 h-6 md:w-8 md:h-8 text-white ml-1.5 cursor-pointer pointer-events-none" strokeWidth={1.5} />
                        <motion.div
                          className="absolute inset-0 rounded-full border border-white/40 pointer-events-none"
                          animate={{ scale: [1, 1.3, 1], opacity: [0.5, 0, 0.5] }}
                          transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
                        />
                      </motion.button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      ) : (
        <section ref={howItWorksRef} id="how-it-works" className="py-16 md:py-24 px-4 relative scroll-mt-20">
          <div className="max-w-6xl mx-auto">
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: isMenuScrolling ? 0.2 : 0.8, margin: isMenuScrolling ? undefined : "-15% 0px -35% 0px" }}
              variants={fadeUp}
              className="text-center mb-16"
            >
              <div className="inline-flex items-center gap-2 glass px-4 py-2 rounded-full mb-6">
                <Layers className="w-4 h-4 text-primary" />
                <span className="text-sm text-muted-foreground">Simple Process</span>
              </div>
              <h2 className="text-3xl md:text-5xl font-bold mb-4">
                How It{' '}
                <span className="gradient-text">Works</span>
              </h2>
              <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
                Share files in three simple steps - no account required
              </p>
            </motion.div>

            {/* Steps Grid — staggered reveal */}
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.2 }}
              variants={staggerGrid}
              className="grid md:grid-cols-3 gap-8"
            >
              {howItWorksSteps.map((item, index) => (
                <motion.div
                  key={item.step}
                  variants={scaleUp}
                  className="relative"
                >
                  <div className="glass-card rounded-[45px] p-6 md:p-9 text-center relative overflow-hidden group">
                    {/* Step Number */}
                    <div className="absolute -top-3 -right-3 w-16 h-16 gradient-primary rounded-[1.75rem] flex items-center justify-center text-2xl font-bold text-white rotate-12 group-hover:rotate-0 transition-transform duration-300">
                      <span className="translate-x-[-3px] translate-y-[3px]">{item.step}</span>
                    </div>

                    {/* Icon */}
                    <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                      <item.icon className="w-10 h-10 text-primary" />
                    </div>

                    <h3 className="text-xl font-semibold text-foreground mb-3">{item.title}</h3>
                    <p className="text-muted-foreground leading-relaxed text-sm md:text-base">{item.description}</p>
                  </div>

                  {/* Connector Line */}
                  {index < howItWorksSteps.length - 1 && (
                    <div className="hidden md:block absolute top-1/2 -right-4 w-8 h-0.5 bg-gradient-to-r from-primary/50 to-transparent" />
                  )}
                </motion.div>
              ))}
            </motion.div>
          </div>
        </section>
      )}

      {/* Features Section - Horizontal Scroll Carousel */}
      <section ref={featuresRef} id="features" className="relative py-20 scroll-mt-20">
        {/* Section heading */}
        <div className="features-heading text-center px-4 mb-12">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: isMenuScrolling ? 0.2 : 0.8, margin: isMenuScrolling ? undefined : "-15% 0px -35% 0px" }}
            variants={fadeUp}
          >
            <div className="inline-flex items-center gap-2 glass px-4 py-2 rounded-full mb-6">
              <Star className="w-4 h-4 text-amber-500" />
              <span className="text-sm text-muted-foreground">Premium Features</span>
            </div>
            <h2 className="text-3xl md:text-5xl font-bold mb-4">
              Everything You Need to{' '}
              <span className="gradient-text">Share Faster</span>
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Built for lab environments with security, speed, and simplicity in mind
            </p>
          </motion.div>
        </div>

        {/* Horizontal Scroll - works on all devices */}
        <div className="horizontal-scroll-wrapper overflow-hidden">
          <div
            className="horizontal-cards-container flex gap-4 md:gap-8 py-6"
            style={{
              paddingLeft: 'calc(50vw - clamp(140px, 42.5vw, 200px))',
              paddingRight: 'calc(50vw - clamp(140px, 42.5vw, 200px))',
              width: 'fit-content'
            }}
          >
            {features.map((feature, index) => (
              <div
                key={feature.title}
                className="feature-scroll-card bg-card border border-border rounded-[45px] p-6 md:p-8 group relative overflow-hidden flex-shrink-0 cursor-pointer hover:shadow-xl hover:shadow-primary/10 transition-all duration-300"
                style={{
                  width: 'clamp(280px, 85vw, 400px)',
                  minHeight: '240px',
                  boxShadow: '0 10px 40px rgba(0, 0, 0, 0.08)'
                }}
              >
                {/* Background gradient on hover */}
                <div className={`absolute inset-0 bg-gradient-to-br ${feature.color} opacity-0 group-hover:opacity-5 transition-opacity duration-500 pointer-events-none`} />

                <div className={`w-16 h-16 mb-6 rounded-2xl bg-gradient-to-br ${feature.color} flex items-center justify-center group-hover:scale-110 transition-transform duration-300 relative`}>
                  <feature.icon className="w-8 h-8 text-white" />
                </div>
                <h3 className="text-xl font-semibold text-foreground mb-3">{feature.title}</h3>
                <p className="text-muted-foreground leading-relaxed">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section — staggered entrance */}
      <section ref={ctaRef} className="py-16 md:py-24 px-4 relative">
        <div className="max-w-4xl mx-auto">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.2 }}
            variants={staggerContainer}
            className="cta-glow glass-card rounded-[45px] p-6 md:p-12 text-center relative overflow-hidden shimmer-border bg-gradient-to-br from-primary/5 via-transparent to-accent/5"
          >
            {/* Decorative elements */}
            <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
              <div className="absolute -top-24 -left-24 w-48 h-48 bg-primary/10 rounded-full blur-3xl" />
              <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-accent/10 rounded-full blur-3xl" />
            </div>

            {/* Rocket Icon */}
            <motion.div variants={scaleIn} className="relative">
              <div className="w-12 h-12 md:w-16 md:h-16 mx-auto mb-6 md:mb-8 rounded-2xl gradient-primary flex items-center justify-center glow-md animate-pulse-glow">
                <Rocket className="w-6 h-6 md:w-8 md:h-8 text-white" />
              </div>
            </motion.div>

            <motion.h2 variants={fadeUp} className="text-xl sm:text-2xl md:text-4xl font-bold mb-3 md:mb-4 relative leading-tight">
              Ready to Transform Your <span className="gradient-text">Experience?</span>
            </motion.h2>

            <motion.p variants={fadeUp} className="text-muted-foreground text-sm sm:text-base md:text-lg mb-6 md:mb-8 max-w-xl mx-auto relative px-2">
              Join now and transform the way you share files, links, and code - smarter, faster, and easier than ever.
            </motion.p>

            <motion.div variants={fadeUp}>
              <Button
                size="lg"
                className="gradient-primary text-white px-6 md:px-8 py-4 md:py-6 text-base md:text-lg rounded-xl glow-button hover:opacity-90 transition-opacity group relative"
                onClick={() => document.getElementById('portal')?.scrollIntoView({ behavior: 'smooth' })}
              >
                <Share2 className="w-5 h-5 mr-2" />
                Start Sharing Now
                <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
              </Button>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Floating Support FAB */}
      <AnimatePresence>
        {showFab && (
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
        )}
      </AnimatePresence>

      {/* Footer */}
      <footer ref={footerRef} className="py-6 md:py-12 px-4 border-t border-border/50">
        <div className="max-w-6xl mx-auto">
          <div className={`flex flex-col md:flex-row items-center gap-4 md:gap-6 ${isStandalone ? 'justify-center' : 'justify-between'}`}>
            {!isStandalone && (
              <div className="flex items-center gap-2">
                <Image src="/logo.svg" alt="CosmoShare Logo" width={120} height={40} className="block dark:hidden w-auto h-8 md:h-10" />
                <Image src="/logoDark.svg" alt="CosmoShare Logo" width={120} height={40} className="hidden dark:block w-auto h-8 md:h-10" />
                <span className="text-base md:text-lg font-bold gradient-text">CosmoShare</span>
              </div>
            )}
            <p className="text-muted-foreground text-sm md:text-sm text-center" style={{ fontFamily: 'Consolas, monospace' }}>
              Made With <svg className="mx-1 inline-block" style={{ height: '18px', width: '18px' }} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <g id="SVGRepo_bgCarrier" strokeWidth="0"></g>
                <g id="SVGRepo_tracerCarrier" strokeLinecap="round" strokeLinejoin="round"></g>
                <g id="SVGRepo_iconCarrier">
                  <path d="M2 9.1371C2 14 6.01943 16.5914 8.96173 18.9109C10 19.7294 11 20.5 12 20.5C13 20.5 14 19.7294 15.0383 18.9109C17.9806 16.5914 22 14 22 9.1371C22 4.27416 16.4998 0.825464 12 5.50063C7.50016 0.825464 2 4.27416 2 9.1371Z" fill="#e24040"></path>
                </g>
              </svg> By ISK
            </p>
            <SupportDialog externalOpen={supportOpen} onExternalOpenChange={setSupportOpen} hideTrigger={isStandalone} />
          </div>
        </div >
      </footer >

      <VideoModal
        isOpen={!!activeVideo}
        onClose={() => setActiveVideo(null)}
        videoUrl={activeVideo}
      />

      {/* iOS PWA Install Instructions Modal */}
      <PWAInstallModal
        open={showIOSModal}
        onOpenChange={setShowIOSModal}
        variant={iosModalVariant}
      />

    </div >
  )
}