'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, Users, Printer, Wifi, FileText, Share2 } from 'lucide-react'
import { useRouter } from 'next/navigation'

export default function Home() {
  const [userType, setUserType] = useState<'student' | 'admin'>('student')
  const [roomNumber, setRoomNumber] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [suggestedNames, setSuggestedNames] = useState<string[]>([])
  const router = useRouter()

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
      // Check if name already exists in room (simulated)
      const existingNames = ['John', 'Alice', 'Bob'] // This would come from API
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
      
      // Build user data and pass via URL (no browser storage)
      const userData = {
        id: Date.now().toString(),
        name,
        uniqueId,
        roomNumber,
        userType: 'student'
      }

      // Redirect to student dashboard
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

      const userData = {
        id: 'admin_' + Date.now(),
        name: 'Lab Admin',
        uniqueId: 'ADMIN',
        roomNumber,
        userType: 'admin'
      }

      // Redirect to admin dashboard
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="flex justify-center items-center gap-3 mb-4">
            <div className="p-3 bg-blue-600 rounded-xl">
              <Share2 className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              LabShare
            </h1>
          </div>
          <p className="text-gray-600 text-lg max-w-2xl mx-auto">
            Peer-to-peer file sharing system for lab environments. Share files instantly with friends and submit print requests to lab admin.
          </p>
        </div>

        {/* User Type Selection */}
        <div className="max-w-4xl mx-auto mb-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card 
              className={`cursor-pointer transition-all duration-300 hover:shadow-lg ${
                userType === 'student' ? 'ring-2 ring-blue-500 bg-blue-50' : 'hover:bg-gray-50'
              }`}
              onClick={() => setUserType('student')}
            >
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-blue-100 rounded-lg">
                    <Users className="w-6 h-6 text-blue-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg">Student</h3>
                    <p className="text-sm text-gray-600">Share files with friends and submit print requests</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card 
              className={`cursor-pointer transition-all duration-300 hover:shadow-lg ${
                userType === 'admin' ? 'ring-2 ring-purple-500 bg-purple-50' : 'hover:bg-gray-50'
              }`}
              onClick={() => setUserType('admin')}
            >
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-purple-100 rounded-lg">
                    <Printer className="w-6 h-6 text-purple-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg">Lab Admin</h3>
                    <p className="text-sm text-gray-600">Manage print requests and file sharing</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Registration Form */}
        <div className="max-w-md mx-auto">
          <Card className="shadow-xl">
            <CardHeader className="text-center">
              <CardTitle className="text-2xl flex items-center justify-center gap-2">
                {userType === 'student' ? (
                  <>
                    <Users className="w-6 h-6 text-blue-600" />
                    Student Portal
                  </>
                ) : (
                  <>
                    <Printer className="w-6 h-6 text-purple-600" />
                    Admin Portal
                  </>
                )}
              </CardTitle>
              <CardDescription>
                {userType === 'student' 
                  ? 'Join your lab room to start sharing files'
                  : 'Access admin dashboard for print management'
                }
              </CardDescription>
            </CardHeader>
            
            <CardContent>
              <form onSubmit={userType === 'student' ? handleStudentSubmit : handleAdminSubmit} className="space-y-4">
                {/* Room Selection */}
                <div className="space-y-2">
                  <Label htmlFor="room">Lab Room Number</Label>
                  <Select value={roomNumber} onValueChange={setRoomNumber}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select your lab room" />
                    </SelectTrigger>
                    <SelectContent>
                      {roomNumbers.map((room) => (
                        <SelectItem key={room} value={room}>
                          <div className="flex items-center gap-2">
                            <Wifi className="w-4 h-4" />
                            Room {room}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Name Input (Student only) */}
                {userType === 'student' && (
                  <div className="space-y-2">
                    <Label htmlFor="name">Your Name</Label>
                    <Input
                      id="name"
                      type="text"
                      placeholder="Enter your name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full"
                    />
                  </div>
                )}

                {/* Password Input (Admin only) */}
                {userType === 'admin' && (
                  <div className="space-y-2">
                    <Label htmlFor="password">Admin Password</Label>
                    <Input
                      id="password"
                      type="password"
                      placeholder="Enter admin password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full"
                    />
                  </div>
                )}

                {/* Error Message */}
                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                {/* Suggested Names */}
                {suggestedNames.length > 0 && (
                  <div className="space-y-2">
                    <Label>Suggested Names:</Label>
                    <div className="flex flex-wrap gap-2">
                      {suggestedNames.map((suggestedName, index) => (
                        <Badge 
                          key={index}
                          variant="secondary" 
                          className="cursor-pointer hover:bg-blue-100"
                          onClick={() => handleSuggestedNameClick(suggestedName)}
                        >
                          {suggestedName}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Submit Button */}
                <Button 
                  type="submit" 
                  className="w-full"
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      {userType === 'student' ? 'Joining Room...' : 'Authenticating...'}
                    </>
                  ) : (
                    <>
                      {userType === 'student' ? (
                        <>
                          <Users className="w-4 h-4 mr-2" />
                          Join Lab Room
                        </>
                      ) : (
                        <>
                          <Printer className="w-4 h-4 mr-2" />
                          Access Admin Panel
                        </>
                      )}
                    </>
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>

        {/* Features */}
        <div className="max-w-4xl mx-auto mt-12">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="text-center p-6">
              <div className="flex justify-center mb-4">
                <div className="p-3 bg-green-100 rounded-lg">
                  <Share2 className="w-6 h-6 text-green-600" />
                </div>
              </div>
              <h3 className="font-semibold mb-2">P2P File Sharing</h3>
              <p className="text-sm text-gray-600">Share files directly with peers using WebRTC technology</p>
            </Card>

            <Card className="text-center p-6">
              <div className="flex justify-center mb-4">
                <div className="p-3 bg-blue-100 rounded-lg">
                  <Printer className="w-6 h-6 text-blue-600" />
                </div>
              </div>
              <h3 className="font-semibold mb-2">Print Requests</h3>
              <p className="text-sm text-gray-600">Submit files for printing with custom messages</p>
            </Card>

            <Card className="text-center p-6">
              <div className="flex justify-center mb-4">
                <div className="p-3 bg-purple-100 rounded-lg">
                  <FileText className="w-6 h-6 text-purple-600" />
                </div>
              </div>
              <h3 className="font-semibold mb-2">Link Support</h3>
              <p className="text-sm text-gray-600">Share and preview links like Google Docs</p>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}