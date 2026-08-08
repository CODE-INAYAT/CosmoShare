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
      getAllRequest.onsuccess = () => {
        const records = getAllRequest.result || []
        
        // Group by fileId
        const metadatas = records.filter(r => r.type === 'metadata')
        const chunks = records.filter(r => r.type === 'chunk')
        
        const files: File[] = []
        
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
