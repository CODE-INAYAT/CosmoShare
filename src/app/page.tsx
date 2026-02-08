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
  Lock,
  Clock,
  CheckCircle2,
  Star,
  Heart,
  Layers,
  Radio,
  Files,
  ShieldCheck,
  Rocket,
  QrCode
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { roomNumbers } from '@/config/rooms'
import { SupportDialog } from '@/components/SupportDialog'

// Register GSAP plugins
if (typeof window !== 'undefined') {
  gsap.registerPlugin(ScrollTrigger)
}

// Animation variants
const fadeUp = {
  hidden: { opacity: 0, y: 40 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, ease: [0.25, 0.46, 0.45, 0.94] as const }
  }
}

const fadeIn = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: 0.6 }
  }
}

const scaleIn = {
  hidden: { opacity: 0, scale: 0.9 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.5, ease: "easeOut" as const }
  }
}

const staggerContainer = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.12,
      delayChildren: 0.1
    }
  }
}

const slideIn = {
  hidden: { opacity: 0, x: -20 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.5 }
  }
}

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
  const [userType, setUserType] = useState<'student' | 'admin'>('student')
  const [roomNumber, setRoomNumber] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [suggestedNames, setSuggestedNames] = useState<string[]>([])
  const [mounted, setMounted] = useState(false)
  const [roomOpen, setRoomOpen] = useState(false)
  const router = useRouter()

  // Refs for GSAP animations
  const heroRef = useRef<HTMLDivElement>(null)
  const portalRef = useRef<HTMLDivElement>(null)
  const howItWorksRef = useRef<HTMLDivElement>(null)
  const featuresRef = useRef<HTMLDivElement>(null)
  const featuresContainerRef = useRef<HTMLDivElement>(null)
  const ctaRef = useRef<HTMLDivElement>(null)

  useEffect(() => setMounted(true), [])

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

      // ============================================
      // BACKGROUND ORBS - Multi-layer Parallax
      // ============================================

      gsap.to('.orb-1', {
        y: -200,
        x: 100,
        scale: 1.2,
        scrollTrigger: {
          trigger: 'body',
          start: 'top top',
          end: 'bottom bottom',
          scrub: 3
        }
      })

      gsap.to('.orb-2', {
        y: 250,
        x: -150,
        scale: 0.8,
        scrollTrigger: {
          trigger: 'body',
          start: 'top top',
          end: 'bottom bottom',
          scrub: 4
        }
      })

      gsap.to('.orb-3', {
        y: -150,
        x: 80,
        scrollTrigger: {
          trigger: 'body',
          start: 'top top',
          end: 'bottom bottom',
          scrub: 2
        }
      })

      // ============================================
      // PORTAL SECTION - Slide & Reveal
      // ============================================

      if (portalRef.current) {
        // Section heading text animation
        const portalHeading = portalRef.current.querySelector('h2')
        if (portalHeading) {
          gsap.fromTo(portalHeading,
            { opacity: 0, y: 80, scale: 0.9 },
            {
              opacity: 1, y: 0, scale: 1,
              duration: 0.8,
              ease: 'power3.out',
              scrollTrigger: {
                trigger: portalRef.current,
                start: 'top 85%',
                toggleActions: 'play none none reverse'
              }
            }
          )
        }

        // Portal cards with 3D slide effect
        gsap.fromTo(portalRef.current.querySelectorAll('.portal-card'),
          {
            opacity: 0,
            x: (i) => i % 2 === 0 ? -150 : 150,
            rotateY: (i) => i % 2 === 0 ? 25 : -25,
            scale: 0.8
          },
          {
            opacity: 1,
            x: 0,
            rotateY: 0,
            scale: 1,
            duration: 1,
            ease: 'power3.out',
            stagger: 0.2,
            scrollTrigger: {
              trigger: portalRef.current,
              start: 'top 75%',
              end: 'top 25%',
              toggleActions: 'play none none reverse'
            }
          }
        )

        // Parallax effect on portal section background
        gsap.to(portalRef.current, {
          backgroundPositionY: '30%',
          scrollTrigger: {
            trigger: portalRef.current,
            start: 'top bottom',
            end: 'bottom top',
            scrub: 1
          }
        })
      }

      // ============================================
      // HOW IT WORKS - Timeline Animation
      // ============================================

      if (howItWorksRef.current) {
        // Section heading with word reveal
        const howHeading = howItWorksRef.current.querySelector('h2')
        if (howHeading) {
          gsap.fromTo(howHeading,
            { opacity: 0, y: 60, clipPath: 'inset(100% 0% 0% 0%)' },
            {
              opacity: 1,
              y: 0,
              clipPath: 'inset(0% 0% 0% 0%)',
              duration: 1,
              ease: 'power4.out',
              scrollTrigger: {
                trigger: howItWorksRef.current,
                start: 'top 80%',
                toggleActions: 'play none none reverse'
              }
            }
          )
        }

        // Steps with staggered 3D reveal
        const stepItems = howItWorksRef.current.querySelectorAll('.step-item')
        gsap.fromTo(stepItems,
          {
            opacity: 0,
            y: 120,
            rotateX: 45,
            scale: 0.7,
            transformOrigin: 'bottom center'
          },
          {
            opacity: 1,
            y: 0,
            rotateX: 0,
            scale: 1,
            duration: 0.9,
            ease: 'back.out(1.4)',
            stagger: 0.25,
            scrollTrigger: {
              trigger: howItWorksRef.current,
              start: 'top 70%',
              toggleActions: 'play none none reverse'
            }
          }
        )

        // Step numbers with spin-in effect
        gsap.fromTo(howItWorksRef.current.querySelectorAll('.step-number'),
          { scale: 0, rotation: -360, opacity: 0 },
          {
            scale: 1,
            rotation: 12, // Final rotation angle
            opacity: 1,
            duration: 0.8,
            ease: 'elastic.out(1, 0.4)',
            stagger: 0.25,
            delay: 0.3,
            scrollTrigger: {
              trigger: howItWorksRef.current,
              start: 'top 70%',
              toggleActions: 'play none none reverse'
            }
          }
        )

        // Connector lines draw animation
        const connectors = howItWorksRef.current.querySelectorAll('.step-connector')
        connectors.forEach(connector => {
          gsap.fromTo(connector,
            { scaleX: 0, transformOrigin: 'left center' },
            {
              scaleX: 1,
              duration: 0.6,
              ease: 'power2.out',
              scrollTrigger: {
                trigger: connector,
                start: 'top 75%',
                toggleActions: 'play none none reverse'
              }
            }
          )
        })
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
          // ========================================
          // DYNAMIC CENTERING CALCULATION
          // ========================================

          // Card dimensions - responsive based on screen size
          const firstCard = cards[0]
          const cardWidth = firstCard ? firstCard.offsetWidth : (window.innerWidth < 768 ? 320 : 400)
          const cardGap = window.innerWidth < 768 ? 16 : 32
          const navbarHeight = 80
          const viewportHeight = window.innerHeight
          const viewportWidth = window.innerWidth

          // Get actual card height from DOM (or use fallback)
          const cardHeight = firstCard ? firstCard.offsetHeight : 280

          // Container has py-6 (24px top padding)
          const containerPaddingTop = 24

          // Total visible area = card height + container padding on top
          const totalCardsAreaHeight = cardHeight + containerPaddingTop

          // Calculate available space below navbar
          const availableHeight = viewportHeight - navbarHeight

          // Calculate the perfect gap (equal spacing above and below card area)
          // This centers the card area vertically in the available space
          const perfectGap = Math.max(0, (availableHeight - totalCardsAreaHeight) / 2)

          // Calculate the start position from viewport top
          // This is where the wrapper should be when pinned (navbar + gap)
          const perfectStartPosition = navbarHeight + perfectGap

          // Calculate total width of all cards
          const totalCardsWidth = (cardWidth + cardGap) * numCards - cardGap

          // Calculate scroll distance so last card ends up centered
          // Initial state: first card centered at viewport center
          // Final state: last card centered at viewport center
          // Distance = (total cards width) - (cardWidth) = distance from first card center to last card center
          const scrollDistance = Math.max(0, totalCardsWidth - cardWidth)

          // Horizontal scroll animation
          // START: When wrapper top reaches the perfect centered position
          // END: After scrolling through entire distance
          gsap.to(cardsContainer, {
            x: -scrollDistance,
            ease: 'none',
            scrollTrigger: {
              trigger: scrollWrapper,
              // Start when wrapper top reaches perfect center position
              start: `top ${perfectStartPosition}px`,
              // End after scrolling through all cards
              end: () => `+=${scrollDistance + 100}`,
              pin: true,
              pinSpacing: true,
              scrub: 1,
              anticipatePin: 1,
              invalidateOnRefresh: true
            }
          })

          // Subtle hover effects only
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

        // Section heading animation
        const featuresHeading = section.querySelector('.features-heading')
        if (featuresHeading) {
          gsap.fromTo(featuresHeading,
            { opacity: 0, y: 30 },
            {
              opacity: 1,
              y: 0,
              duration: 0.6,
              ease: 'power3.out',
              scrollTrigger: {
                trigger: section,
                start: 'top 80%',
                toggleActions: 'play none none reverse'
              }
            }
          )
        }
      }

      // ============================================
      // CTA SECTION - Entrance & Glow Animation
      // ============================================

      if (ctaRef.current) {
        // CTA card entrance with scale and fade
        gsap.fromTo(ctaRef.current,
          { opacity: 0, scale: 0.85, y: 80 },
          {
            opacity: 1,
            scale: 1,
            y: 0,
            duration: 1,
            ease: 'power3.out',
            scrollTrigger: {
              trigger: ctaRef.current,
              start: 'top 85%',
              toggleActions: 'play none none reverse'
            }
          }
        )

        // Pulsing glow effect intensifies on scroll proximity
        const ctaGlow = ctaRef.current.querySelector('.cta-glow')
        if (ctaGlow) {
          gsap.to(ctaGlow, {
            boxShadow: '0 0 80px rgba(0, 134, 124, 0.5), 0 0 120px rgba(0, 134, 124, 0.3)',
            duration: 2,
            repeat: -1,
            yoyo: true,
            ease: 'power1.inOut'
          })
        }

        // CTA decorative elements parallax
        gsap.to(ctaRef.current.querySelectorAll('.cta-decoration'), {
          y: -30,
          scale: 1.1,
          scrollTrigger: {
            trigger: ctaRef.current,
            start: 'top bottom',
            end: 'bottom top',
            scrub: 1
          }
        })
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

      router.push(`/student?room=${roomNumber}&user=${encodeURIComponent(JSON.stringify(userData))}`)
    } catch (error) {
      setError('Failed to join room. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleAdminSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!roomNumber || !password) {
      setError('Please fill in all fields')
      return
    }

    setIsLoading(true)
    setError('')

    try {
      if (password !== 'admin123') {
        setError('Invalid password')
        setIsLoading(false)
        return
      }

      router.push(`/admin?room=${roomNumber}`)
    } catch (error) {
      setError('Failed to authenticate. Please try again.')
    } finally {
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
      <motion.nav
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.6 }}
        className="fixed top-0 left-0 right-0 z-50 px-4 py-4"
      >
        <div className="max-w-7xl mx-auto">
          <div className="glass rounded-2xl px-6 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <motion.div
                whileHover={{ rotate: 180, scale: 1.1 }}
                transition={{ duration: 0.4 }}
                className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center glow-sm"
              >
                <Share2 className="w-5 h-5 text-white" />
              </motion.div>
              <span className="text-xl font-bold gradient-text">ShareMe</span>
            </div>

            <div className="hidden md:flex items-center gap-8">
              <a href="#portal" className="text-muted-foreground hover:text-foreground transition-colors text-sm font-medium">Get Started</a>
              <a href="#how-it-works" className="text-muted-foreground hover:text-foreground transition-colors text-sm font-medium">How It Works</a>
              <a href="#features" className="text-muted-foreground hover:text-foreground transition-colors text-sm font-medium">Features</a>
            </div>

            <div className="flex items-center gap-3">
              <ThemeToggle />
              <Button
                className="gradient-primary text-white hover:opacity-90 transition-opacity hidden sm:flex glow-button"
                onClick={() => document.getElementById('portal')?.scrollIntoView({ behavior: 'smooth' })}
              >
                <UserPlus className="w-4 h-4 mr-2" />
                Join Room
              </Button>
            </div>
          </div>
        </div>
      </motion.nav>

      {/* Hero Section */}
      <section ref={heroRef} className="relative pt-32 pb-20 px-4 min-h-screen flex items-center">
        <div className="max-w-7xl mx-auto w-full">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            {/* Left Content */}
            <div className="text-center lg:text-left">
              {/* Badge */}
              <div className="hero-cta inline-flex items-center gap-2 glass px-4 py-2 rounded-full mb-8">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <span className="text-sm text-muted-foreground">Seamless Real-Time Connectivity</span>
              </div>

              {/* Main Headline */}
              <h1 className="hero-title text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold mb-6 leading-tight tracking-tight">
                <span className="text-foreground">Share Files </span>
                <span className="gradient-text-animated">Instantly</span>
                <br />
                <span className="text-foreground">In Your </span>
                <span className="text-primary">Lab Room</span>
              </h1>

              {/* Subtitle */}
              <p className="hero-subtitle text-lg md:text-xl text-muted-foreground mb-10 max-w-xl mx-auto lg:mx-0 leading-relaxed">
                Peer-to-peer file sharing designed for lab environments.
                Share documents, submit print requests, and collaborate
                seamlessly with your peers.
              </p>

              {/* CTA Buttons */}
              <div className="hero-cta flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
                <Button
                  size="lg"
                  className="gradient-primary text-white px-6 md:px-8 py-4 md:py-6 text-base md:text-lg rounded-xl glow-button hover:opacity-90 transition-all group magnetic-btn"
                  onClick={() => document.getElementById('portal')?.scrollIntoView({ behavior: 'smooth' })}
                >
                  Get Started Free
                  <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="border-border hover:bg-secondary px-6 md:px-8 py-4 md:py-6 text-base md:text-lg rounded-xl transition-all"
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
            className="absolute bottom-10 left-1/2 -translate-x-1/2 hidden md:flex flex-col items-center gap-2"
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
      <section ref={portalRef} id="portal" className="py-16 md:py-24 px-4 relative">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.8, margin: "-15% 0px -35% 0px" }}
            variants={fadeUp}
            className="text-center mb-12"
          >
            <h2 className="text-3xl md:text-5xl font-bold mb-4">
              Ready to{' '}
              <span className="gradient-text">Get Started?</span>
            </h2>
            <p className="text-muted-foreground text-lg">
              Join your lab room and start sharing in seconds
            </p>
          </motion.div>

          {/* OneShare Quick Access */}
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={fadeUp}
            className="mb-10"
          >
            <button
              onClick={() => router.push('/oneshare')}
              className="portal-card w-full glass-card rounded-2xl p-4 md:p-6 text-center transition-all duration-300 hover:ring-2 hover:ring-primary hover:shadow-lg hover:shadow-primary/20 group"
            >
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <div className="w-16 h-16 rounded-2xl gradient-primary flex items-center justify-center glow-sm group-hover:scale-110 transition-transform">
                  <QrCode className="w-8 h-8 text-white" />
                </div>
                <div className="text-center sm:text-left">
                  <h3 className="text-xl font-bold text-foreground mb-1">OneShare</h3>
                  <p className="text-sm text-muted-foreground">Quick share without joining a room — just scan or enter a code</p>
                </div>
                <ArrowRight className="w-6 h-6 text-primary hidden sm:block group-hover:translate-x-1 transition-transform" />
              </div>
            </button>
          </motion.div>

          <div className="flex items-center gap-4 max-w-2xl mx-auto mb-6">
            <div className="flex-1 h-px bg-border" />
            <span className="text-sm text-muted-foreground">or join a lab room</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          {/* Role Selection */}
          <div className="grid md:grid-cols-2 gap-6 mb-10 max-w-2xl mx-auto">
            <button
              className={`portal-card w-full glass-card rounded-2xl p-4 md:p-6 text-left transition-all duration-300 ${userType === 'student'
                ? 'ring-2 ring-primary shadow-lg shadow-primary/20'
                : 'hover:shadow-lg'
                }`}
              onClick={() => setUserType('student')}
            >
              <div className="flex items-center gap-4">
                <div className={`w-14 h-14 rounded-xl flex items-center justify-center transition-all duration-300 ${userType === 'student'
                  ? 'gradient-primary glow-sm'
                  : 'bg-secondary'
                  }`}>
                  <Users className={`w-7 h-7 ${userType === 'student' ? 'text-white' : 'text-muted-foreground'}`} />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-foreground">Student</h3>
                  <p className="text-sm text-muted-foreground">Share files and print</p>
                </div>
              </div>
            </button>

            <button
              className={`portal-card w-full glass-card rounded-2xl p-4 md:p-6 text-left transition-all duration-300 ${userType === 'admin'
                ? 'ring-2 ring-primary shadow-lg shadow-primary/20'
                : 'hover:shadow-lg'
                }`}
              onClick={() => setUserType('admin')}
            >
              <div className="flex items-center gap-4">
                <div className={`w-14 h-14 rounded-xl flex items-center justify-center transition-all duration-300 ${userType === 'admin'
                  ? 'gradient-primary glow-sm'
                  : 'bg-secondary'
                  }`}>
                  <Lock className={`w-7 h-7 ${userType === 'admin' ? 'text-white' : 'text-muted-foreground'}`} />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-foreground">Lab Admin</h3>
                  <p className="text-sm text-muted-foreground">Manage print queue</p>
                </div>
              </div>
            </button>
          </div>

          {/* Login Form */}
          <div className="portal-card">
            <Card className="glass-card border-0 rounded-3xl max-w-md mx-auto overflow-hidden shimmer-border">
              <CardHeader className="text-center pt-8 pb-4">
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 200, delay: 0.2 }}
                  className="w-16 h-16 mx-auto mb-4 rounded-2xl gradient-primary flex items-center justify-center glow-md"
                >
                  <AnimatePresence mode="wait">
                    {userType === 'student' ? (
                      <motion.div
                        key="student"
                        initial={{ rotate: -90, opacity: 0 }}
                        animate={{ rotate: 0, opacity: 1 }}
                        exit={{ rotate: 90, opacity: 0 }}
                      >
                        <Users className="w-8 h-8 text-white" />
                      </motion.div>
                    ) : (
                      <motion.div
                        key="admin"
                        initial={{ rotate: -90, opacity: 0 }}
                        animate={{ rotate: 0, opacity: 1 }}
                        exit={{ rotate: 90, opacity: 0 }}
                      >
                        <Lock className="w-8 h-8 text-white" />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
                <CardTitle className="text-2xl text-foreground">
                  {userType === 'student' ? 'Student Portal' : 'Admin Portal'}
                </CardTitle>
                <CardDescription className="text-muted-foreground">
                  {userType === 'student'
                    ? 'Join your lab room to start sharing'
                    : 'Access the admin dashboard'
                  }
                </CardDescription>
              </CardHeader>

              <CardContent className="p-5 md:p-8 pt-4">
                <form onSubmit={userType === 'student' ? handleStudentSubmit : handleAdminSubmit} className="space-y-5">
                  {/* Room Selection - Searchable Modal */}
                  <div className="space-y-2">
                    <Label htmlFor="room" className="text-muted-foreground text-sm">Lab Room Number</Label>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setRoomOpen(true)}
                      className="w-full justify-between bg-secondary/50 border-border text-foreground rounded-xl h-12 focus:ring-primary focus:ring-offset-0 hover:bg-secondary/70 transition-colors"
                    >
                      {roomNumber ? (
                        <span className="flex items-center gap-2">
                          <Monitor className="w-4 h-4 text-primary" />
                          Room {roomNumber}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Select room...</span>
                      )}
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    </Button>

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
                  </div>

                  {/* Name Input (Student only) */}
                  <AnimatePresence mode="wait">
                    {userType === 'student' && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="space-y-2"
                      >
                        <Label htmlFor="name" className="text-muted-foreground text-sm">Your Name</Label>
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
                          className="bg-secondary/50 border-border text-foreground rounded-xl h-12 placeholder:text-muted-foreground focus-visible:ring-primary focus-visible:ring-offset-0 uppercase"
                        />
                        <div className="flex items-center justify-between mt-1.5">
                          <span className={`text-xs transition-colors duration-200 ${name.length === 0
                            ? 'text-muted-foreground'
                            : name.length < 3
                              ? 'text-red-500'
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
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Password Input (Admin only) */}
                  <AnimatePresence mode="wait">
                    {userType === 'admin' && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="space-y-2"
                      >
                        <Label htmlFor="password" className="text-muted-foreground text-sm">Admin Password</Label>
                        <Input
                          id="password"
                          type="password"
                          placeholder="Enter admin password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className="bg-secondary/50 border-border text-foreground rounded-xl h-12 placeholder:text-muted-foreground focus-visible:ring-primary focus-visible:ring-offset-0"
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Error Message */}
                  <AnimatePresence>
                    {error && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                      >
                        <Alert variant="destructive" className="bg-destructive/10 border-destructive/30 text-destructive rounded-xl">
                          <AlertDescription>{error}</AlertDescription>
                        </Alert>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Suggested Names */}
                  <AnimatePresence>
                    {suggestedNames.length > 0 && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="space-y-2"
                      >
                        <Label className="text-muted-foreground text-sm">Suggested Names:</Label>
                        <div className="flex flex-wrap gap-2">
                          {suggestedNames.map((suggestedName, index) => (
                            <Badge
                              key={index}
                              variant="secondary"
                              className="bg-secondary hover:bg-primary/20 hover:text-primary cursor-pointer transition-colors rounded-lg px-3 py-1"
                              onClick={() => handleSuggestedNameClick(suggestedName)}
                            >
                              {suggestedName}
                            </Badge>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Submit Button */}
                  <Button
                    type="submit"
                    className="w-full h-12 gradient-primary text-white rounded-xl glow-button mt-6 group"
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                        {userType === 'student' ? 'Joining Room...' : 'Authenticating...'}
                      </>
                    ) : (
                      <>
                        {userType === 'student' ? 'Join Lab Room' : 'Access Admin Panel'}
                        <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
                      </>
                    )}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section ref={howItWorksRef} id="how-it-works" className="py-16 md:py-24 px-4 relative">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.8, margin: "-15% 0px -35% 0px" }}
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

          <div className="grid md:grid-cols-3 gap-8">
            {howItWorksSteps.map((item, index) => (
              <div
                key={item.step}
                className="step-item relative"
              >
                <div className="glass-card rounded-3xl p-5 md:p-8 text-center relative overflow-hidden group">
                  {/* Step Number */}
                  <div className="step-number absolute -top-4 -right-4 w-16 h-16 gradient-primary rounded-2xl flex items-center justify-center text-2xl font-bold text-white glow-sm rotate-12 group-hover:rotate-0 transition-transform duration-300">
                    {item.step}
                  </div>

                  {/* Icon */}
                  <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                    <item.icon className="w-10 h-10 text-primary" />
                  </div>

                  <h3 className="text-xl font-semibold text-foreground mb-3">{item.title}</h3>
                  <p className="text-muted-foreground leading-relaxed">{item.description}</p>
                </div>

                {/* Connector Line */}
                {index < howItWorksSteps.length - 1 && (
                  <div className="hidden md:block absolute top-1/2 -right-4 w-8 h-0.5 bg-gradient-to-r from-primary/50 to-transparent" />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Section - Horizontal Scroll Carousel */}
      <section ref={featuresRef} id="features" className="relative py-20">
        {/* Section heading */}
        <div className="features-heading text-center px-4 mb-12">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.8, margin: "-15% 0px -35% 0px" }}
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
                className="feature-scroll-card bg-card border border-border rounded-3xl p-6 md:p-8 group relative overflow-hidden flex-shrink-0 cursor-pointer hover:shadow-xl hover:shadow-primary/10 transition-all duration-300"
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

      {/* CTA Section */}
      <section ref={ctaRef} className="py-16 md:py-24 px-4 relative">
        <div className="max-w-4xl mx-auto">
          <div className="cta-glow glass-card rounded-3xl p-6 md:p-12 text-center relative overflow-hidden shimmer-border bg-gradient-to-br from-primary/5 via-transparent to-accent/5">
            {/* Decorative elements */}
            <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
              <div className="absolute -top-24 -left-24 w-48 h-48 bg-primary/10 rounded-full blur-3xl" />
              <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-accent/10 rounded-full blur-3xl" />
            </div>

            {/* Rocket Icon */}
            <motion.div
              animate={{ scale: [1, 1.1, 1] }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
              className="w-12 h-12 md:w-16 md:h-16 mx-auto mb-6 md:mb-8 rounded-2xl gradient-primary flex items-center justify-center glow-md"
            >
              <Rocket className="w-6 h-6 md:w-8 md:h-8 text-white" />
            </motion.div>

            <h2 className="text-xl sm:text-2xl md:text-4xl font-bold mb-3 md:mb-4 relative leading-tight">
              Ready to Transform Your <span className="gradient-text">Lab Experience?</span>
            </h2>

            <p className="text-muted-foreground text-sm sm:text-base md:text-lg mb-6 md:mb-8 max-w-xl mx-auto relative px-2">
              Join thousands of students and lab admins who are already sharing files faster than ever.
            </p>

            <Button
              size="lg"
              className="gradient-primary text-white px-6 md:px-8 py-4 md:py-6 text-base md:text-lg rounded-xl glow-button hover:opacity-90 transition-all group relative"
              onClick={() => document.getElementById('portal')?.scrollIntoView({ behavior: 'smooth' })}
            >
              <Share2 className="w-5 h-5 mr-2" />
              Start Sharing Now
              <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-6 md:py-12 px-4 border-t border-border/50">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 md:gap-6">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 md:w-10 md:h-10 rounded-xl gradient-primary flex items-center justify-center">
                <Share2 className="w-4 h-4 md:w-5 md:h-5 text-white" />
              </div>
              <span className="text-base md:text-lg font-bold gradient-text">ShareMe</span>
            </div>
            <p className="text-muted-foreground text-sm md:text-sm text-center" style={{ fontFamily: 'Consolas, monospace' }}>
              Made With <svg className="mx-1 inline-block" style={{ height: '18px', width: '18px' }} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <g id="SVGRepo_bgCarrier" strokeWidth="0"></g>
                <g id="SVGRepo_tracerCarrier" strokeLinecap="round" strokeLinejoin="round"></g>
                <g id="SVGRepo_iconCarrier">
                  <path d="M2 9.1371C2 14 6.01943 16.5914 8.96173 18.9109C10 19.7294 11 20.5 12 20.5C13 20.5 14 19.7294 15.0383 18.9109C17.9806 16.5914 22 14 22 9.1371C22 4.27416 16.4998 0.825464 12 5.50063C7.50016 0.825464 2 4.27416 2 9.1371Z" fill="#e24040"></path>
                </g>
              </svg> By ISK
            </p>
            <SupportDialog />
          </div>
        </div >
      </footer >
    </div >
  )
}