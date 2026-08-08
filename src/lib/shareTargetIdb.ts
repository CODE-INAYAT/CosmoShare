// Utility to interact with IndexedDB for Web Share Target

export async function getSharedFiles(): Promise<File[]> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('cosmoshare-share-db', 1)

    request.onerror = () => reject(request.error)
    
    request.onupgradeneeded = (e) => {
      // If the db didn't exist, it means there are no files.
      // But we still create the store to be safe.
      const db = (e.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains('shared-files')) {
        db.createObjectStore('shared-files', { autoIncrement: true })
      }
    }

    request.onsuccess = (e) => {
      const db = (e.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains('shared-files')) {
        resolve([])
        return
      }

      const tx = db.transaction('shared-files', 'readonly')
      const store = tx.objectStore('shared-files')
      const getAllRequest = store.getAll()

      getAllRequest.onerror = () => reject(getAllRequest.error)
      getAllRequest.onsuccess = async () => {
        const records = getAllRequest.result || []
        const files: File[] = []
        
        // Handle New Zero-RAM Raw Multipart Payload
        const rawMultipart = records.find(r => r.type === 'raw-multipart')
        if (rawMultipart) {
          try {
            const { blob, contentType } = rawMultipart
            const response = new Response(blob, {
              headers: { 'Content-Type': contentType }
            })
            const formData = await response.formData()
            const formDataFiles = formData.getAll('files') as File[]
            for (const f of formDataFiles) {
              if (f.size > 0) files.push(f)
            }
          } catch (err) {
            console.error('[ShareTarget] Failed to parse raw-multipart blob:', err)
          }
        }
        
        // Handle Old Chunked Metadata Payload (for backward compatibility if anything is stuck)
        const metadatas = records.filter(r => r.type === 'metadata')
        const chunks = records.filter(r => r.type === 'chunk')
        
        for (const meta of metadatas) {
          const fileChunks = chunks
            .filter(c => c.fileId === meta.fileId)
            .sort((a, b) => a.chunkIndex - b.chunkIndex)
            .map(c => c.data)
            
          if (fileChunks.length === meta.totalChunks) {
            files.push(new File(fileChunks, meta.name, { type: meta.fileType }))
          } else {
            console.warn(`[ShareTarget] Missing chunks for file ${meta.name}`)
          }
        }
        
        resolve(files)
      }
    }
  })
}

export async function clearSharedFiles(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('cosmoshare-share-db', 1)

    request.onerror = () => reject(request.error)
    
    request.onsuccess = (e) => {
      const db = (e.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains('shared-files')) {
        resolve()
        return
      }

      const tx = db.transaction('shared-files', 'readwrite')
      const store = tx.objectStore('shared-files')
      const clearRequest = store.clear()

      clearRequest.onerror = () => reject(clearRequest.error)
      clearRequest.onsuccess = () => resolve()
    }
  })
}

export async function saveSharedFiles(files: File[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('cosmoshare-share-db', 1)

    request.onerror = () => reject(request.error)
    
    request.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains('shared-files')) {
        db.createObjectStore('shared-files', { autoIncrement: true })
      }
    }

    request.onsuccess = (e) => {
      const db = (e.target as IDBOpenDBRequest).result
      const tx = db.transaction('shared-files', 'readwrite')
      const store = tx.objectStore('shared-files')
      
      const CHUNK_SIZE = 5 * 1024 * 1024
      let expectedPuts = 0
      let completed = 0

      const checkDone = () => {
        completed++
        if (completed === expectedPuts) resolve()
      }

      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)

      for (let f of files) {
        expectedPuts++
        expectedPuts += Math.ceil(f.size / CHUNK_SIZE)
      }

      for (let f of files) {
        const fileId = Date.now().toString() + Math.random().toString()
        const totalChunks = Math.ceil(f.size / CHUNK_SIZE)
        
        const metaReq = store.put({
          type: 'metadata',
          fileId,
          name: f.name,
          fileType: f.type,
          size: f.size,
          totalChunks,
          timestamp: Date.now()
        })
        metaReq.onsuccess = checkDone
        metaReq.onerror = () => reject(metaReq.error)
        
        for (let i = 0; i < totalChunks; i++) {
          const start = i * CHUNK_SIZE
          const end = Math.min(start + CHUNK_SIZE, f.size)
          const chunkReq = store.put({
            type: 'chunk',
            fileId,
            chunkIndex: i,
            data: f.slice(start, end)
          })
          chunkReq.onsuccess = checkDone
          chunkReq.onerror = () => reject(chunkReq.error)
        }
      }
    }
  })
}
