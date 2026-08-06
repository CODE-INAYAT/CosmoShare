const DB_NAME = 'CosmoShareAdminDB'
const DB_VERSION = 1

export interface PrintRequestData {
  id: string
  fileName: string
  fileSize: number
  fileType: string
  isLink: boolean
  linkUrl?: string
  message?: string
  senderId: string
  senderName: string
  senderUniqueId: string
  timestamp: string // Store as ISO string
  isPrinted: boolean
  printCopies?: number
  fileId?: string
  location?: { latitude: number; longitude: number; name: string; address: string }
  contact?: { name: string; phone: string }
  blob?: Blob
}

export interface DailyAnalytics {
  date: string // YYYY-MM-DD format
  totalRequests: number
  pending: number
  printed: number
  links: number
  files: number
  totalBytes: number
}

const getDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains('requests')) {
        db.createObjectStore('requests', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('analytics')) {
        db.createObjectStore('analytics', { keyPath: 'date' })
      }
    }

    request.onsuccess = () => {
      resolve(request.result)
    }

    request.onerror = () => {
      reject(request.error)
    }
  })
}

// ----------------- Requests -----------------

export const saveRequestToDB = async (req: PrintRequestData): Promise<void> => {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('requests', 'readwrite')
    const store = tx.objectStore('requests')
    store.put(req)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export const loadRequestsFromDB = async (): Promise<PrintRequestData[]> => {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('requests', 'readonly')
    const store = tx.objectStore('requests')
    const request = store.getAll()
    request.onsuccess = () => {
      const data = request.result || []
      // Sort newest first
      data.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      resolve(data)
    }
    request.onerror = () => reject(request.error)
  })
}

export const updateRequestPrintedStatusInDB = async (id: string, isPrinted: boolean): Promise<void> => {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('requests', 'readwrite')
    const store = tx.objectStore('requests')
    const getReq = store.get(id)
    getReq.onsuccess = () => {
      const data = getReq.result
      if (data) {
        data.isPrinted = isPrinted
        store.put(data)
      }
      resolve()
    }
    getReq.onerror = () => reject(getReq.error)
  })
}

export const deleteRequestFromDB = async (id: string): Promise<void> => {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('requests', 'readwrite')
    const store = tx.objectStore('requests')
    store.delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export const clearAllRequestsFromDB = async (): Promise<void> => {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('requests', 'readwrite')
    const store = tx.objectStore('requests')
    store.clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

// ----------------- Analytics -----------------

const getLocalDateString = (): string => {
  let date = new Date()
  const offset = date.getTimezoneOffset()
  date = new Date(date.getTime() - (offset * 60 * 1000))
  return date.toISOString().split('T')[0]
}

export const updateDailyAnalyticsInDB = async (updates: Partial<DailyAnalytics>): Promise<void> => {
  const db = await getDB()
  const today = getLocalDateString()

  return new Promise((resolve, reject) => {
    const tx = db.transaction('analytics', 'readwrite')
    const store = tx.objectStore('analytics')
    const getReq = store.get(today)

    getReq.onsuccess = () => {
      let data: DailyAnalytics = getReq.result
      if (!data) {
        data = {
          date: today,
          totalRequests: 0,
          pending: 0,
          printed: 0,
          links: 0,
          files: 0,
          totalBytes: 0,
        }
      }

      if (updates.totalRequests) data.totalRequests += updates.totalRequests
      if (updates.pending) data.pending += updates.pending
      if (updates.printed) data.printed += updates.printed
      if (updates.links) data.links += updates.links
      if (updates.files) data.files += updates.files
      if (updates.totalBytes) data.totalBytes += updates.totalBytes

      store.put(data)
      resolve()
    }
    getReq.onerror = () => reject(getReq.error)
  })
}

export const getDailyAnalyticsFromDB = async (dateStr: string): Promise<DailyAnalytics | null> => {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('analytics', 'readonly')
    const store = tx.objectStore('analytics')
    const getReq = store.get(dateStr)
    getReq.onsuccess = () => {
      resolve(getReq.result || null)
    }
    getReq.onerror = () => reject(getReq.error)
  })
}

export const getAnalyticsForLastNDays = async (days: number): Promise<DailyAnalytics[]> => {
  const result: DailyAnalytics[] = []
  
  const today = new Date()
  const offset = today.getTimezoneOffset()
  // Adjust for local timezone to get accurate YYYY-MM-DD
  
  for (let i = 0; i < days; i++) {
    const d = new Date(today.getTime() - i * 24 * 60 * 60 * 1000 - (offset * 60 * 1000))
    const dateStr = d.toISOString().split('T')[0]
    const data = await getDailyAnalyticsFromDB(dateStr)
    if (data) {
      result.push(data)
    } else {
      result.push({
        date: dateStr,
        totalRequests: 0,
        pending: 0,
        printed: 0,
        links: 0,
        files: 0,
        totalBytes: 0,
      })
    }
  }
  
  // Return oldest first (for charts)
  return result.reverse()
}
