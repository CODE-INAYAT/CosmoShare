import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'edge'

function arrayBufferToBase64(buffer: ArrayBuffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const files = formData.getAll('files') as File[]

    if (!files || files.length === 0) {
      return NextResponse.redirect(new URL('/share-target?error=no_files', request.url), 303)
    }

    const validFiles = files.filter(f => f.size > 0)
    if (validFiles.length === 0) {
      return NextResponse.redirect(new URL('/share-target?error=no_valid_files', request.url), 303)
    }

    // Convert files to base64 for HTML injection (Edge compatible, no fs used)
    const serializedFiles = await Promise.all(validFiles.map(async (f) => {
      const buffer = await f.arrayBuffer()
      const base64 = arrayBufferToBase64(buffer)
      return {
        name: f.name || 'shared_file',
        type: f.type || 'application/octet-stream',
        size: f.size,
        base64
      }
    }))

    // Inject base64 into a self-executing HTML page that writes to IndexedDB and redirects
    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Processing Shared Files...</title>
        <style>
          body { background: #000; color: #fff; font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
          .loader { border: 4px solid #333; border-top: 4px solid #fff; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 0 auto; }
          @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        </style>
      </head>
      <body>
        <div style="text-align: center;">
          <div class="loader"></div>
          <p style="margin-top: 1.5rem; font-weight: 500;">Securing Shared Files...</p>
        </div>
        <script>
          const filesData = ${JSON.stringify(serializedFiles)};
          
          function base64ToBlob(base64, type) {
            const binStr = atob(base64);
            const len = binStr.length;
            const arr = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
              arr[i] = binStr.charCodeAt(i);
            }
            return new Blob([arr], { type: type });
          }

          async function saveFiles() {
            try {
              const files = filesData.map(f => {
                const blob = base64ToBlob(f.base64, f.type);
                return new File([blob], f.name, { type: f.type });
              });

              await new Promise((resolve, reject) => {
                const req = indexedDB.open('cosmoshare-share-db', 1);
                req.onupgradeneeded = (e) => {
                  const db = e.target.result;
                  if (!db.objectStoreNames.contains('shared-files')) {
                    db.createObjectStore('shared-files', { autoIncrement: true });
                  }
                };
                req.onsuccess = (e) => {
                  const db = e.target.result;
                  const tx = db.transaction('shared-files', 'readwrite');
                  const store = tx.objectStore('shared-files');
                  
                  let completed = 0;
                  const CHUNK_SIZE = 5 * 1024 * 1024;
                  let expectedPuts = 0;

                  const checkDone = () => {
                    completed++;
                    if (completed === expectedPuts) resolve();
                  };

                  tx.oncomplete = () => resolve();
                  tx.onerror = () => reject(tx.error);

                  for (let f of files) {
                    expectedPuts++;
                    expectedPuts += Math.ceil(f.size / CHUNK_SIZE);
                  }

                  for (let f of files) {
                    const fileId = Date.now().toString() + Math.random().toString();
                    const totalChunks = Math.ceil(f.size / CHUNK_SIZE);
                    
                    const metaReq = store.put({ type: 'metadata', fileId, name: f.name, fileType: f.type, size: f.size, totalChunks, timestamp: Date.now() });
                    metaReq.onsuccess = checkDone;
                    metaReq.onerror = () => reject(metaReq.error);
                    
                    for (let i = 0; i < totalChunks; i++) {
                      const start = i * CHUNK_SIZE;
                      const end = Math.min(start + CHUNK_SIZE, f.size);
                      const chunkReq = store.put({ type: 'chunk', fileId, chunkIndex: i, data: f.slice(start, end) });
                      chunkReq.onsuccess = checkDone;
                      chunkReq.onerror = () => reject(chunkReq.error);
                    }
                  }
                };
                req.onerror = () => reject(req.error);
              });
              
              window.location.replace('/share-target');
            } catch (err) {
              console.error(err);
              window.location.replace('/share-target?error=server_fallback_failed');
            }
          }

          saveFiles();
        </script>
      </body>
      </html>
    `

    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8'
      }
    })
  } catch (err) {
    console.error('[API Fallback] Web Share Target POST error:', err)
    return NextResponse.redirect(new URL('/share-target?error=server_fallback_failed', request.url), 303)
  }
}
