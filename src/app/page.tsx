'use client'
export const runtime = 'edge'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTheme } from 'next-themes'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Loader2,
  Users,
  Printer,
  Wifi,
  FileText,
  Share2,
  Zap,
  Shield,
  Globe,
  ArrowRight,
  Sparkles,
  MonitorSmartphone,
  Upload,
  Download,
  Sun,
  Moon,
  ChevronDown,
  Lock,
  Clock,
  CheckCircle2,
  Star
} from 'lucide-react'
import { useRouter } from 'next/navigation'

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
  const router = useRouter()

  useEffect(() => setMounted(true), [])

  const roomNumbers = Array.from({ length: 11 }, (_, i) => (300 + i).toString())

  const generateUniqueId = (name: string) => {
    const firstChar = name.charAt(0).toUpperCase()
    const randomNum = Math.floor(Math.random() * 1000)
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
      description: 'Lightning-fast peer-to-peer transfers using WebRTC technology. No server upload required.',
      color: 'from-emerald-500 to-teal-500'
    },
    {
      icon: Printer,
      title: 'Smart Print Queue',
      description: 'Submit files for printing with custom settings, messages, and priority levels.',
      color: 'from-teal-500 to-cyan-500'
    },
    {
      icon: Globe,
      title: 'Link Sharing',
      description: 'Share and preview links like Google Docs, Sheets, and more with instant previews.',
      color: 'from-cyan-500 to-emerald-500'
    }
  ]

  const stats = [
    { value: '50K+', label: 'Files Shared', icon: Upload },
    { value: '10K+', label: 'Active Users', icon: Users },
    { value: '99.9%', label: 'Uptime', icon: Clock },
    { value: '256-bit', label: 'Encryption', icon: Shield }
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
      {/* Animated Background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        {/* Gradient Mesh */}
        <div className="absolute inset-0 bg-mesh opacity-60" />

        {/* Animated Orbs */}
        <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] rounded-full bg-gradient-to-br from-emerald-500/20 to-teal-500/10 blur-[100px] animate-orb-1" />
        <div className="absolute top-[40%] right-[-15%] w-[500px] h-[500px] rounded-full bg-gradient-to-br from-teal-500/15 to-cyan-500/10 blur-[80px] animate-orb-2" />
        <div className="absolute bottom-[-10%] left-[30%] w-[700px] h-[700px] rounded-full bg-gradient-to-br from-cyan-500/10 to-emerald-500/15 blur-[120px] animate-orb-3" />

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
              <a href="#features" className="text-muted-foreground hover:text-foreground transition-colors text-sm font-medium">Features</a>
              <a href="#stats" className="text-muted-foreground hover:text-foreground transition-colors text-sm font-medium">Stats</a>
              <a href="#portal" className="text-muted-foreground hover:text-foreground transition-colors text-sm font-medium">Get Started</a>
            </div>

            <div className="flex items-center gap-3">
              <ThemeToggle />
              <Button
                className="gradient-primary text-white hover:opacity-90 transition-opacity hidden sm:flex glow-button"
                onClick={() => document.getElementById('portal')?.scrollIntoView({ behavior: 'smooth' })}
              >
                <Sparkles className="w-4 h-4 mr-2" />
                Join Room
              </Button>
            </div>
          </div>
        </div>
      </motion.nav>

      {/* Hero Section */}
      <section className="relative pt-32 pb-20 px-4 min-h-screen flex items-center">
        <div className="max-w-7xl mx-auto w-full">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            {/* Left Content */}
            <motion.div
              initial="hidden"
              animate="visible"
              variants={staggerContainer}
              className="text-center lg:text-left"
            >
              {/* Badge */}
              <motion.div variants={fadeUp} className="inline-flex items-center gap-2 glass px-4 py-2 rounded-full mb-8">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <span className="text-sm text-muted-foreground">Powered by WebRTC Technology</span>
              </motion.div>

              {/* Main Headline */}
              <motion.h1
                variants={fadeUp}
                className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold mb-6 leading-tight tracking-tight"
              >
                <span className="text-foreground">Share Files </span>
                <span className="gradient-text-animated">Instantly</span>
                <br />
                <span className="text-foreground">In Your </span>
                <span className="text-primary">Lab Room</span>
              </motion.h1>

              {/* Subtitle */}
              <motion.p
                variants={fadeUp}
                className="text-lg md:text-xl text-muted-foreground mb-10 max-w-xl mx-auto lg:mx-0 leading-relaxed"
              >
                Peer-to-peer file sharing designed for lab environments.
                Share documents, submit print requests, and collaborate
                seamlessly with your peers.
              </motion.p>

              {/* CTA Buttons */}
              <motion.div variants={fadeUp} className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
                <Button
                  size="lg"
                  className="gradient-primary text-white px-8 py-6 text-lg rounded-xl glow-button hover:opacity-90 transition-all group"
                  onClick={() => document.getElementById('portal')?.scrollIntoView({ behavior: 'smooth' })}
                >
                  Get Started Free
                  <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="border-border hover:bg-secondary px-8 py-6 text-lg rounded-xl transition-all"
                >
                  <MonitorSmartphone className="w-5 h-5 mr-2" />
                  Watch Demo
                </Button>
              </motion.div>

              {/* Benefits */}
              <motion.div variants={fadeUp} className="mt-10 grid grid-cols-2 gap-3 max-w-md mx-auto lg:mx-0">
                {benefits.map((benefit, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm text-muted-foreground">
                    <CheckCircle2 className="w-4 h-4 text-primary flex-shrink-0" />
                    <span>{benefit}</span>
                  </div>
                ))}
              </motion.div>
            </motion.div>

            {/* Right Content - Floating Card */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.3 }}
              className="relative hidden lg:block"
            >
              <div className="relative">
                {/* Main floating card */}
                <motion.div
                  animate={{ y: [0, -10, 0] }}
                  transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
                  className="glass-card rounded-3xl p-8 shimmer-border"
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
            </motion.div>
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

      {/* Stats Section */}
      <section id="stats" className="py-24 px-4 relative">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={staggerContainer}
            className="grid grid-cols-2 md:grid-cols-4 gap-6"
          >
            {stats.map((stat, index) => (
              <motion.div
                key={stat.label}
                variants={scaleIn}
                whileHover={{ scale: 1.05 }}
                className="glass-card rounded-2xl p-6 text-center hover-shine"
              >
                <div className="w-14 h-14 mx-auto mb-4 rounded-xl bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center">
                  <stat.icon className="w-7 h-7 text-primary" />
                </div>
                <div className="text-3xl md:text-4xl font-bold gradient-text mb-2">{stat.value}</div>
                <div className="text-sm text-muted-foreground">{stat.label}</div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-24 px-4 relative">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={fadeUp}
            className="text-center mb-16"
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

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={staggerContainer}
            className="grid md:grid-cols-3 gap-8"
          >
            {features.map((feature, index) => (
              <motion.div
                key={feature.title}
                variants={fadeUp}
                whileHover={{ y: -8 }}
                className="glass-card rounded-3xl p-8 group hover-shine relative overflow-hidden"
              >
                {/* Background gradient on hover */}
                <div className={`absolute inset-0 bg-gradient-to-br ${feature.color} opacity-0 group-hover:opacity-5 transition-opacity duration-500`} />

                <div className={`w-16 h-16 mb-6 rounded-2xl bg-gradient-to-br ${feature.color} flex items-center justify-center group-hover:scale-110 transition-transform duration-300 glow-sm relative`}>
                  <feature.icon className="w-8 h-8 text-white" />
                </div>
                <h3 className="text-xl font-semibold text-foreground mb-3">{feature.title}</h3>
                <p className="text-muted-foreground leading-relaxed">{feature.description}</p>

                <motion.div
                  className="mt-6 flex items-center text-primary font-medium opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  Learn more <ArrowRight className="w-4 h-4 ml-2" />
                </motion.div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Portal Section */}
      <section id="portal" className="py-24 px-4 relative">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
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

          {/* Role Selection */}
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={staggerContainer}
            className="grid md:grid-cols-2 gap-6 mb-10 max-w-2xl mx-auto"
          >
            <motion.div variants={fadeUp}>
              <button
                className={`w-full glass-card rounded-2xl p-6 text-left transition-all duration-300 ${userType === 'student'
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
            </motion.div>

            <motion.div variants={fadeUp}>
              <button
                className={`w-full glass-card rounded-2xl p-6 text-left transition-all duration-300 ${userType === 'admin'
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
            </motion.div>
          </motion.div>

          {/* Login Form */}
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={scaleIn}
          >
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

              <CardContent className="p-8 pt-4">
                <form onSubmit={userType === 'student' ? handleStudentSubmit : handleAdminSubmit} className="space-y-5">
                  {/* Room Selection */}
                  <div className="space-y-2">
                    <Label htmlFor="room" className="text-muted-foreground text-sm">Lab Room Number</Label>
                    <Select value={roomNumber} onValueChange={setRoomNumber}>
                      <SelectTrigger className="bg-secondary/50 border-border text-foreground rounded-xl h-12 focus:ring-primary focus:ring-offset-0">
                        <SelectValue placeholder="Select your lab room" />
                      </SelectTrigger>
                      <SelectContent className="bg-card border-border rounded-xl">
                        {roomNumbers.map((room) => (
                          <SelectItem
                            key={room}
                            value={room}
                            className="text-foreground hover:bg-secondary focus:bg-secondary rounded-lg"
                          >
                            <div className="flex items-center gap-2">
                              <Wifi className="w-4 h-4 text-primary" />
                              Room {room}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
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
                          onChange={(e) => setName(e.target.value)}
                          className="bg-secondary/50 border-border text-foreground rounded-xl h-12 placeholder:text-muted-foreground focus-visible:ring-primary focus-visible:ring-offset-0"
                        />
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
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-4 border-t border-border/50">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center">
                <Share2 className="w-5 h-5 text-white" />
              </div>
              <span className="text-lg font-bold gradient-text">ShareMe</span>
            </div>
            <p className="text-muted-foreground text-sm">
              © {new Date().getFullYear()} ShareMe. Built for lab environments.
            </p>
            <div className="flex items-center gap-6">
              <a href="#" className="text-muted-foreground hover:text-foreground transition-colors text-sm">Privacy</a>
              <a href="#" className="text-muted-foreground hover:text-foreground transition-colors text-sm">Terms</a>
              <a href="#" className="text-muted-foreground hover:text-foreground transition-colors text-sm">Support</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}