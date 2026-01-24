'use client'

import { useState } from 'react'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Bug, Lightbulb, Monitor, Mail, ArrowRight, ArrowLeft, Upload, Loader2, CheckCircle2 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'
import { roomNumbers } from '@/config/rooms'
import { useIsMobile } from "@/hooks/use-mobile"
import {
    Drawer,
    DrawerContent,
    DrawerDescription,
    DrawerHeader,
    DrawerTitle,
    DrawerTrigger,
} from "@/components/ui/drawer"

const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwoSajl1NzWwoPIqGOsUofQoSuwu0yUo06ajR4dUI0Kvvdy3NNwKDV_JRLHLQwiEYmLBA/exec';

export function SupportDialog() {
    const [open, setOpen] = useState(false)
    const [view, setView] = useState<'menu' | 'form' | 'success'>('menu')
    const [selectedCategory, setSelectedCategory] = useState<any>(null)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [formData, setFormData] = useState({
        name: '',
        contact: '',
        message: '',
        roomNumber: '',
        file: null as File | null
    })
    const [currentRequestId, setCurrentRequestId] = useState<string>("")
    const isMobile = useIsMobile()

    const resetForm = () => {
        setFormData({ name: '', contact: '', message: '', roomNumber: '', file: null })
        setView('menu')
        setSelectedCategory(null)
        setCurrentRequestId("")
    }

    const handleCategoryClick = (category: any) => {
        setSelectedCategory(category)
        setView('form')
    }

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            if (file.size > 1024 * 1024) {
                toast.error("File Too Large", {
                    description: "Attachment must be less than 1MB."
                });
                e.target.value = '';
                return;
            }
            setFormData({ ...formData, file })
        }
    }

    const getBase64 = (file: File): Promise<string> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = error => reject(error);
        });
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setIsSubmitting(true)

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(formData.contact)) {
            toast.error("Invalid Email", { description: "Please enter a valid email address." });
            setIsSubmitting(false);
            return;
        }

        if (formData.name.length < 3 || formData.name.length > 30) {
            toast.error("Invalid Name", { description: "Name must be between 3 and 30 characters." });
            setIsSubmitting(false);
            return;
        }

        if (selectedCategory.title !== 'Lab Add Request' && (formData.message.length < 3 || formData.message.length > 1500)) {
            toast.error("Invalid Message", { description: "Message must be between 3 and 1500 characters." });
            setIsSubmitting(false);
            return;
        }

        if (selectedCategory.title === 'Lab Add Request') {
            if (formData.roomNumber.length > 3) {
                toast.error("Invalid Room Number", { description: "Room number cannot exceed 3 digits." });
                setIsSubmitting(false);
                return;
            }
            if (roomNumbers.includes(formData.roomNumber)) {
                toast.error("Room Already Exists", { description: `Room ${formData.roomNumber} is already available in the list.` });
                setIsSubmitting(false);
                return;
            }
        }

        try {
            const now = new Date()
            const day = String(now.getDate()).padStart(2, '0')
            const month = String(now.getMonth() + 1).padStart(2, '0')
            const year = String(now.getFullYear()).slice(-2)
            const random = Math.floor(1000 + Math.random() * 9000)
            const requestId = `REQ-${day}${month}${year}-${random}`

            let fileData = "";
            if (formData.file) {
                fileData = await getBase64(formData.file);
            }

            const payload = {
                requestId,
                type: selectedCategory.title,
                name: formData.name,
                contact: formData.contact,
                message: selectedCategory.title === 'Lab Add Request' ? '' : formData.message,
                roomNumber: selectedCategory.title === 'Lab Add Request' ? formData.roomNumber : '',
                fileName: formData.file ? formData.file.name : "",
                mimeType: formData.file ? formData.file.type : "",
                fileData: fileData
            };

            await fetch(GOOGLE_SCRIPT_URL, {
                method: "POST",
                body: JSON.stringify(payload),
                mode: "no-cors"
            });

            setCurrentRequestId(requestId);
            setView('success');

        } catch (error) {
            console.error(error);
            toast.error("Submission Failed", { description: "Please try again later." });
        } finally {
            setIsSubmitting(false)
        }
    }

    const options = [
        { icon: Bug, title: 'Report Bug', description: 'Something not working properly?', color: 'text-red-500 bg-red-500/10 hover:bg-red-500/20' },
        { icon: Lightbulb, title: 'Feedback / Suggestion', description: 'Help me improve ShareMe', color: 'text-amber-500 bg-amber-500/10 hover:bg-amber-500/20' },
        { icon: Monitor, title: 'Lab Add Request', description: 'Want to add your lab room?', color: 'text-emerald-500 bg-emerald-500/10 hover:bg-emerald-500/20' },
        { icon: Mail, title: 'Contact Support', description: 'Get in touch with me directly', color: 'text-blue-500 bg-blue-500/10 hover:bg-blue-500/20' }
    ]

    const supportFormContent = (
        <AnimatePresence mode="wait">
            {view === 'menu' && (
                <motion.div
                    key="menu"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                >
                    <DialogHeader className="mb-4">
                        <DialogTitle className="text-lg sm:text-xl font-bold text-center">How can I help?</DialogTitle>
                        <DialogDescription className="text-center text-xs sm:text-sm">
                            Choose an option below to get started
                        </DialogDescription>
                    </DialogHeader>

                    <div className="grid gap-3">
                        {options.map((option, index) => (
                            <motion.button
                                key={index}
                                whileHover={{ scale: 1.02 }}
                                whileTap={{ scale: 0.98 }}
                                onClick={() => handleCategoryClick(option)}
                                className={`flex items-center gap-4 p-4 rounded-xl transition-all w-full text-left group border border-transparent hover:border-border/50 ${option.color.replace('text-', 'hover:bg-opacity-30 ')}`}
                            >
                                <div className={`p-3 rounded-lg ${option.color}`}>
                                    <option.icon className="w-5 h-5" />
                                </div>
                                <div className="flex-1 text-left">
                                    <h3 className="font-semibold text-sm sm:text-base text-foreground">{option.title}</h3>
                                    <p className="text-[10px] sm:text-xs text-muted-foreground">{option.description}</p>
                                </div>
                                <ArrowRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
                            </motion.button>
                        ))}
                    </div>
                </motion.div>
            )}

            {view === 'form' && selectedCategory && (
                <motion.form
                    key="form"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    onSubmit={handleSubmit}
                    className="space-y-4"
                >
                    <div className="flex items-center gap-2 mb-2">
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="p-0 h-8 w-8 rounded-full"
                            onClick={() => setView('menu')}
                        >
                            <ArrowLeft className="w-4 h-4" />
                        </Button>
                        <DialogTitle className="text-lg font-bold flex items-center gap-2">
                            <selectedCategory.icon className={`w-5 h-5 ${selectedCategory.color.split(' ')[0]}`} />
                            <span className="text-base sm:text-lg">{selectedCategory.title}</span>
                        </DialogTitle>
                    </div>

                    <div className="space-y-3">
                        <div className="space-y-1">
                            <Label htmlFor="name" className="text-xs">Name</Label>
                            <Input
                                id="name"
                                required
                                placeholder="Your Name"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                className="bg-secondary/50"
                                minLength={3}
                                maxLength={30}
                            />
                            <p className="text-[10px] text-muted-foreground text-right">{formData.name.length}/30</p>
                        </div>
                        <div className="space-y-1">
                            <Label htmlFor="contact" className="text-xs">Email Address</Label>
                            <Input
                                id="contact"
                                type="email"
                                required
                                placeholder="your@email.com"
                                value={formData.contact}
                                onChange={(e) => setFormData({ ...formData, contact: e.target.value })}
                                className="bg-secondary/50"
                            />
                        </div>

                        {selectedCategory.title === 'Lab Add Request' ? (
                            <div className="space-y-1">
                                <Label htmlFor="roomNumber" className="text-xs">Lab Room Number</Label>
                                <Input
                                    id="roomNumber"
                                    type="number"
                                    required
                                    placeholder="e.g. 505"
                                    value={formData.roomNumber}
                                    onChange={(e) => setFormData({ ...formData, roomNumber: e.target.value })}
                                    className="bg-secondary/50"
                                    maxLength={3}
                                    max={999}
                                />
                                <p className="text-[10px] text-muted-foreground">Max 3 digits (e.g. 101, 205)</p>
                            </div>
                        ) : (
                            <div className="space-y-1">
                                <Label htmlFor="message" className="text-xs">Message</Label>
                                <Textarea
                                    id="message"
                                    required
                                    placeholder="Describe your request..."
                                    rows={4}
                                    value={formData.message}
                                    onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                                    className="bg-secondary/50 resize-none"
                                    minLength={3}
                                    maxLength={1500}
                                />
                                <p className="text-[10px] text-muted-foreground text-right">{formData.message.length}/1500</p>
                            </div>
                        )}

                        {selectedCategory.title !== 'Lab Add Request' && (
                            <div className="space-y-1">
                                <div className="flex justify-between items-center">
                                    <Label htmlFor="file" className="text-xs">Attachment (Optional)</Label>
                                    <span className="text-[10px] text-muted-foreground">Max size: 1MB</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Input
                                        id="file"
                                        type="file"
                                        onChange={handleFileChange}
                                        className="hidden"
                                    />
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={() => document.getElementById('file')?.click()}
                                        className="w-full justify-start text-muted-foreground bg-secondary/50"
                                    >
                                        <Upload className="w-4 h-4 mr-2" />
                                        {formData.file ? formData.file.name : "Upload screenshot or document"}
                                    </Button>
                                </div>
                            </div>
                        )}
                    </div>

                    <Button
                        type="submit"
                        className="w-full gradient-primary text-white mt-2 mb-4"
                        disabled={isSubmitting}
                    >
                        {isSubmitting ? (
                            <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                Submitting...
                            </>
                        ) : (
                            "Submit Request"
                        )}
                    </Button>
                    {/* Spacer for mobile scrolling */}
                    <div className="h-4 sm:hidden" />
                </motion.form>
            )}

            {view === 'success' && (
                <motion.div
                    key="success"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="text-center py-8"
                >
                    <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-emerald-500/10 flex items-center justify-center">
                        <CheckCircle2 className="w-8 h-8 text-emerald-500" />
                    </div>
                    <h3 className="text-lg sm:text-xl font-bold mb-2">
                        {selectedCategory?.title === 'Report Bug' && 'Bug Reported!'}
                        {selectedCategory?.title === 'Feedback / Suggestion' && 'Thanks for Feedback!'}
                        {selectedCategory?.title === 'Lab Add Request' && 'Request Sent!'}
                        {selectedCategory?.title === 'Contact Support' && 'Message Sent!'}
                        {!['Report Bug', 'Feedback / Suggestion', 'Lab Add Request', 'Contact Support'].includes(selectedCategory?.title) && 'Request Received!'}
                    </h3>
                    <p className="text-muted-foreground text-sm mb-4 max-w-[260px] mx-auto">
                        {selectedCategory?.title === 'Report Bug' && "Thanks for helping me keep things running smoothly. I'll check it out."}
                        {selectedCategory?.title === 'Feedback / Suggestion' && "I appreciate your input! I'll review your suggestions shortly."}
                        {selectedCategory?.title === 'Lab Add Request' && "Your request to add the lab room has been submitted for review."}
                        {selectedCategory?.title === 'Contact Support' && "I've received your message and will get back to you soon."}
                        {!['Report Bug', 'Feedback / Suggestion', 'Lab Add Request', 'Contact Support'].includes(selectedCategory?.title) && "Thank you for your feedback. I'll get back to you shortly."}
                    </p>

                    <div className="mb-6 bg-secondary/50 p-2 rounded-md inline-block">
                        <p className="text-xs text-muted-foreground">Ticket ID</p>
                        <p className="text-sm font-mono font-bold select-all">{currentRequestId}</p>
                    </div>

                    <div className="block">
                        <Button onClick={resetForm} variant="outline" className="min-w-[120px]">Close</Button>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    )

    if (isMobile) {
        return (
            <Drawer
                open={open}
                onOpenChange={(val) => {
                    if (!val) resetForm();
                    setOpen(val);
                }}
            >
                <div className="flex items-center justify-center gap-2 text-xs md:text-sm text-muted-foreground">
                    <span>Looking For Anything Else ?</span>
                    <DrawerTrigger asChild>
                        <button className="text-primary hover:underline font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20 rounded-sm">
                            Click Here
                        </button>
                    </DrawerTrigger>
                </div>
                <DrawerContent className="p-4 !mt-0 !max-h-[100dvh] h-[100dvh] !rounded-none">
                    <div className="overflow-y-auto flex-1">
                        {supportFormContent}
                    </div>
                </DrawerContent>
            </Drawer>
        )
    }

    return (
        <Dialog open={open} onOpenChange={(val) => {
            if (!val) resetForm();
            setOpen(val);
        }}>
            <div className="flex items-center justify-center gap-2 text-xs md:text-sm text-muted-foreground">
                <span>Looking For Anything Else ?</span>
                <DialogTrigger asChild>
                    <button className="text-primary hover:underline font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20 rounded-sm">
                        Click Here
                    </button>
                </DialogTrigger>
            </div>
            <DialogContent className="sm:max-w-md border-0 bg-background/95 backdrop-blur-xl max-h-[85vh] overflow-y-auto p-6 rounded-2xl scrollbar-hide">
                {supportFormContent}
            </DialogContent>
        </Dialog>
    )
}
