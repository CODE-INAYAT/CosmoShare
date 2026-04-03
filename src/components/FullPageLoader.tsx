'use client'

import { motion } from 'framer-motion'
import { Share2, Users, Printer } from 'lucide-react'

interface FullPageLoaderProps {
    variant?: 'oneshare' | 'labroom' | 'admin'
}

const variantConfig = {
    oneshare: {
        icon: Share2,
        title: 'OneShare',
        tagline: 'Instant sharing'
    },
    labroom: {
        icon: Users,
        title: 'Lab Room',
        tagline: 'Connect & share'
    },
    admin: {
        icon: Printer,
        title: 'Admin Panel',
        tagline: 'Manage your lab'
    }
}

export default function FullPageLoader({ variant = 'oneshare' }: FullPageLoaderProps) {
    const config = variantConfig[variant]
    const Icon = config.icon

    return (
        <div className="min-h-screen bg-background flex items-center justify-center relative overflow-hidden">
            {/* Ambient glow */}
            <div className="absolute inset-0 pointer-events-none">
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 1.5 }}
                    className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] bg-primary/5 rounded-full blur-[100px]"
                />
            </div>

            {/* Center content */}
            <motion.div
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                className="relative flex flex-col items-center px-6"
            >
                {/* Logo mark */}
                <div className="relative mb-10">
                    {/* Icon container */}
                    <motion.div
                        initial={{ scale: 0.5, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ delay: 0.15, duration: 0.5, ease: "backOut" }}
                        className="relative w-16 h-16 rounded-full gradient-primary flex items-center justify-center shadow-lg shadow-primary/25"
                    >
                        <Icon className="w-7 h-7 text-primary-foreground" strokeWidth={1.5} />
                    </motion.div>
                </div>

                {/* Text content */}
                <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.25, duration: 0.5 }}
                    className="text-center"
                >
                    <h1 className="text-2xl font-semibold text-foreground tracking-tight">
                        {config.title}
                    </h1>
                    <p className="mt-1.5 text-sm text-muted-foreground">
                        {config.tagline}
                    </p>
                </motion.div>

                {/* Progress indicator */}
                <motion.div
                    initial={{ opacity: 0, scaleX: 0 }}
                    animate={{ opacity: 1, scaleX: 1 }}
                    transition={{ delay: 0.4, duration: 0.4 }}
                    className="mt-10 w-32 h-1 bg-border rounded-full overflow-hidden origin-center"
                >
                    <motion.div
                        initial={{ x: '-100%' }}
                        animate={{ x: '200%' }}
                        transition={{
                            duration: 1.5,
                            repeat: Infinity,
                            ease: [0.4, 0, 0.2, 1]
                        }}
                        className="w-1/2 h-full gradient-primary rounded-full"
                    />
                </motion.div>

                {/* Made With Love */}
                <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.6, duration: 0.5 }}
                    className="mt-6 text-sm text-muted-foreground"
                    style={{ fontFamily: 'Consolas, monospace' }}
                >
                    Made With{' '}
                    <svg className="mx-1 inline-block" style={{ height: '18px', width: '18px' }} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <g id="SVGRepo_bgCarrier" strokeWidth="0"></g>
                        <g id="SVGRepo_tracerCarrier" strokeLinecap="round" strokeLinejoin="round"></g>
                        <g id="SVGRepo_iconCarrier">
                            <path d="M2 9.1371C2 14 6.01943 16.5914 8.96173 18.9109C10 19.7294 11 20.5 12 20.5C13 20.5 14 19.7294 15.0383 18.9109C17.9806 16.5914 22 14 22 9.1371C22 4.27416 16.4998 0.825464 12 5.50063C7.50016 0.825464 2 4.27416 2 9.1371Z" fill="#e24040"></path>
                        </g>
                    </svg>
                    {' '}By ISK
                </motion.p>
            </motion.div>

            {/* Bottom branding */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.8, duration: 0.6 }}
                className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-3"
            >
                <img src="/logo.svg" alt="CosmoShare Logo" className="block dark:hidden h-6 md:h-8 w-auto transition-transform hover:scale-105" />
                <img src="/logoDark.svg" alt="CosmoShare Logo" className="hidden dark:block h-6 md:h-8 w-auto transition-transform hover:scale-105" />
                <p className="text-sm md:text-base font-bold tracking-widest uppercase gradient-text">
                    CosmoShare
                </p>
            </motion.div>
        </div>
    )
}
