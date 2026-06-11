// ============================================
// CosmoShare WA-Bot Bridge — Cloudflare Worker
// ============================================

export interface Env {
  FILE_STORE: KVNamespace;
  BOT_API_SECRET: string;
  SIGNALING_URLS?: string; // comma-separated signaling worker WebSocket URLs
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Bot-Secret, Authorization',
  'Access-Control-Max-Age': '86400',
};

function corsHeaders(extra?: Record<string, string>): Headers {
  const h = new Headers({ ...CORS_HEADERS, ...extra });
  return h;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders({ 'Content-Type': 'application/json' }),
  });
}

function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

function handleCors(): Response {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

function isAuthorized(request: Request, env: Env): boolean {
  const secret = request.headers.get('X-Bot-Secret');
  return secret === env.BOT_API_SECRET;
}

function generateCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}

// ---------------------------------------------------------------------------
// Multipart form-data parser (works in Workers runtime)
// ---------------------------------------------------------------------------

interface ParsedFile {
  name: string;
  type: string;
  data: ArrayBuffer;
  size: number;
}

async function parseMultipartFormData(request: Request): Promise<{ files: ParsedFile[]; fields: Record<string, string> }> {
  const formData = await request.formData();
  const files: ParsedFile[] = [];
  const fields: Record<string, string> = {};

  for (const [key, value] of formData.entries()) {
    if (value instanceof File) {
      const arrayBuffer = await value.arrayBuffer();
      files.push({
        name: value.name,
        type: value.type || 'application/octet-stream',
        data: arrayBuffer,
        size: arrayBuffer.byteLength,
      });
    } else {
      fields[key] = value;
    }
  }

  return { files, fields };
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

async function handleUpload(request: Request, env: Env): Promise<Response> {
  try {
    const { files } = await parseMultipartFormData(request);

    if (files.length === 0) {
      return errorResponse('No files provided', 400);
    }

    const uploadId = crypto.randomUUID();
    const filesMeta: { key: string; fileName: string; fileSize: number; fileType: string }[] = [];

    for (const file of files) {
      const key = `file:${uploadId}:${file.name}`;
      // Store file data in KV with 15-minute TTL
      await env.FILE_STORE.put(key, file.data, {
        expirationTtl: 15 * 60,
        metadata: {
          fileName: file.name,
          fileType: file.type,
          fileSize: file.size,
          uploadedAt: new Date().toISOString(),
        },
      });

      filesMeta.push({
        key,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
      });
    }

    // Also store an upload manifest for easy retrieval
    await env.FILE_STORE.put(
      `upload:${uploadId}`,
      JSON.stringify(filesMeta),
      { expirationTtl: 15 * 60 },
    );

    return jsonResponse({ uploadId, files: filesMeta });
  } catch (err: any) {
    return errorResponse(`Upload failed: ${err.message}`, 500);
  }
}

async function handleOneShare(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json() as {
      uploadId: string;
      metadata?: { totalFiles?: number; links?: number; codeSnippets?: number; totalSize?: number };
    };

    if (!body.uploadId) {
      return errorResponse('uploadId is required', 400);
    }

    // Verify the upload exists
    const manifestRaw = await env.FILE_STORE.get(`upload:${body.uploadId}`);
    if (!manifestRaw) {
      return errorResponse('Upload not found or expired', 404);
    }

    const filesMeta = JSON.parse(manifestRaw) as { key: string; fileName: string; fileSize: number; fileType: string }[];
    const code = generateCode();
    const totalFiles = body.metadata?.totalFiles ?? filesMeta.length;
    const totalSize = body.metadata?.totalSize ?? filesMeta.reduce((sum, f) => sum + f.fileSize, 0);

    // Store share session in KV — 10 minute TTL for OneShare
    const shareData = {
      code,
      type: 'oneshare',
      uploadId: body.uploadId,
      files: filesMeta,
      totalFiles,
      totalSize,
      links: body.metadata?.links ?? 0,
      codeSnippets: body.metadata?.codeSnippets ?? 0,
      createdAt: new Date().toISOString(),
      multiShare: false,
    };

    await env.FILE_STORE.put(`share:${code}`, JSON.stringify(shareData), {
      expirationTtl: 10 * 60,
    });

    return jsonResponse({
      code,
      validFor: '10 Minutes',
      totalFiles,
      links: 0,
      codeSnippets: 0,
      size: formatBytes(totalSize),
    });
  } catch (err: any) {
    return errorResponse(`OneShare failed: ${err.message}`, 500);
  }
}

async function handleMultiShare(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json() as {
      uploadId: string;
      metadata?: { totalFiles?: number; links?: number; codeSnippets?: number; totalSize?: number };
    };

    if (!body.uploadId) {
      return errorResponse('uploadId is required', 400);
    }

    const manifestRaw = await env.FILE_STORE.get(`upload:${body.uploadId}`);
    if (!manifestRaw) {
      return errorResponse('Upload not found or expired', 404);
    }

    const filesMeta = JSON.parse(manifestRaw) as { key: string; fileName: string; fileSize: number; fileType: string }[];
    const code = generateCode();
    const totalFiles = body.metadata?.totalFiles ?? filesMeta.length;
    const totalSize = body.metadata?.totalSize ?? filesMeta.reduce((sum, f) => sum + f.fileSize, 0);

    // Store share session in KV — 5 minute TTL for MultiShare
    const shareData = {
      code,
      type: 'multishare',
      uploadId: body.uploadId,
      files: filesMeta,
      totalFiles,
      totalSize,
      links: body.metadata?.links ?? 0,
      codeSnippets: body.metadata?.codeSnippets ?? 0,
      createdAt: new Date().toISOString(),
      multiShare: true,
    };

    await env.FILE_STORE.put(`share:${code}`, JSON.stringify(shareData), {
      expirationTtl: 5 * 60,
    });

    return jsonResponse({
      code,
      validFor: '5 Minutes',
      totalFiles,
      links: 0,
      codeSnippets: 0,
      size: formatBytes(totalSize),
    });
  } catch (err: any) {
    return errorResponse(`MultiShare failed: ${err.message}`, 500);
  }
}

async function handleLabShare(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json() as {
      uploadId: string;
      roomNumber: string;
      recipientType: 'print' | 'all';
      senderName: string;
      senderId: string;
      metadata?: { totalFiles?: number; links?: number; codeSnippets?: number; totalSize?: number };
    };

    if (!body.uploadId || !body.roomNumber || !body.recipientType || !body.senderName || !body.senderId) {
      return errorResponse('uploadId, roomNumber, recipientType, senderName, and senderId are required', 400);
    }

    const manifestRaw = await env.FILE_STORE.get(`upload:${body.uploadId}`);
    if (!manifestRaw) {
      return errorResponse('Upload not found or expired', 404);
    }

    const filesMeta = JSON.parse(manifestRaw) as { key: string; fileName: string; fileSize: number; fileType: string }[];
    const totalFiles = body.metadata?.totalFiles ?? filesMeta.length;
    const totalSize = body.metadata?.totalSize ?? filesMeta.reduce((sum, f) => sum + f.fileSize, 0);

    // Store the lab-share session in KV — 10 minute TTL
    const labShareData = {
      type: 'labshare',
      uploadId: body.uploadId,
      roomNumber: body.roomNumber,
      recipientType: body.recipientType,
      senderName: body.senderName,
      senderId: body.senderId,
      files: filesMeta,
      totalFiles,
      totalSize,
      isPrintRequest: body.recipientType === 'print',
      createdAt: new Date().toISOString(),
    };

    const labShareKey = `labshare:${body.roomNumber}:${body.uploadId}`;
    await env.FILE_STORE.put(labShareKey, JSON.stringify(labShareData), {
      expirationTtl: 10 * 60,
    });

    return jsonResponse({
      name: body.senderName,
      id: body.senderId,
      room: body.roomNumber,
      to: body.recipientType === 'print' ? 'admin (print)' : 'all',
      totalFiles,
      links: 0,
      codeSnippets: 0,
      size: formatBytes(totalSize),
    });
  } catch (err: any) {
    return errorResponse(`LabShare failed: ${err.message}`, 500);
  }
}

async function handleHealth(): Promise<Response> {
  return jsonResponse({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
}

async function handleGetFiles(code: string, env: Env): Promise<Response> {
  try {
    const shareRaw = await env.FILE_STORE.get(`share:${code}`);
    if (!shareRaw) {
      return errorResponse('Share code not found or expired', 404);
    }

    const shareData = JSON.parse(shareRaw) as {
      code: string;
      type: string;
      uploadId: string;
      files: { key: string; fileName: string; fileSize: number; fileType: string }[];
      totalFiles: number;
      totalSize: number;
      multiShare: boolean;
      createdAt: string;
    };

    // Retrieve actual file data for each file
    const filesWithData: {
      fileName: string;
      fileSize: number;
      fileType: string;
      data: string; // base64 encoded
    }[] = [];

    for (const fileMeta of shareData.files) {
      const fileBuffer = await env.FILE_STORE.get(fileMeta.key, { type: 'arrayBuffer' });
      if (fileBuffer) {
        // Convert ArrayBuffer to base64 string for JSON transport
        const bytes = new Uint8Array(fileBuffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64 = btoa(binary);

        filesWithData.push({
          fileName: fileMeta.fileName,
          fileSize: fileMeta.fileSize,
          fileType: fileMeta.fileType,
          data: base64,
        });
      }
    }

    // For OneShare, delete the share after retrieval
    if (!shareData.multiShare) {
      await env.FILE_STORE.delete(`share:${code}`);
      // Also clean up the individual file keys
      for (const fileMeta of shareData.files) {
        await env.FILE_STORE.delete(fileMeta.key);
      }
      await env.FILE_STORE.delete(`upload:${shareData.uploadId}`);
    }

    return jsonResponse({
      code: shareData.code,
      type: shareData.type,
      totalFiles: shareData.totalFiles,
      totalSize: shareData.totalSize,
      createdAt: shareData.createdAt,
      files: filesWithData,
    });
  } catch (err: any) {
    return errorResponse(`Failed to retrieve files: ${err.message}`, 500);
  }
}

// ---------------------------------------------------------------------------
// Download Page — served at /share/:code
// ---------------------------------------------------------------------------

function renderDownloadPage(code: string): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CosmoShare — Download Files (Code: ${code})</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background: #0a0a0f;
      color: #e4e4e7;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
    }
    .bg-glow {
      position: fixed; inset: 0; pointer-events: none; overflow: hidden;
    }
    .bg-glow::before {
      content: '';
      position: absolute;
      top: -30%; left: -20%;
      width: 600px; height: 600px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(16,185,129,0.15), transparent 70%);
      filter: blur(80px);
    }
    .bg-glow::after {
      content: '';
      position: absolute;
      bottom: -20%; right: -15%;
      width: 500px; height: 500px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(20,184,166,0.12), transparent 70%);
      filter: blur(60px);
    }
    .card {
      position: relative;
      max-width: 480px;
      width: 100%;
      background: rgba(24,24,32,0.85);
      backdrop-filter: blur(24px);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 1.5rem;
      padding: 2.5rem 2rem;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    }
    .logo { text-align: center; margin-bottom: 1.5rem; }
    .logo-icon {
      display: inline-flex; align-items: center; justify-content: center;
      width: 56px; height: 56px; border-radius: 16px;
      background: linear-gradient(135deg, #10b981, #14b8a6);
      box-shadow: 0 0 20px rgba(16,185,129,0.3);
      margin-bottom: 0.75rem;
    }
    .logo-icon svg { width: 28px; height: 28px; color: #fff; }
    h1 {
      font-size: 1.5rem; font-weight: 700; text-align: center;
      background: linear-gradient(135deg, #10b981, #14b8a6);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
      margin-bottom: 0.25rem;
    }
    .subtitle { text-align: center; color: #a1a1aa; font-size: 0.9rem; margin-bottom: 2rem; }
    .code-display {
      text-align: center; font-size: 2.5rem; font-weight: 700;
      letter-spacing: 0.5em; color: #fff;
      padding: 1rem; margin-bottom: 1.5rem;
      background: rgba(16,185,129,0.08);
      border: 1px solid rgba(16,185,129,0.2);
      border-radius: 1rem;
    }
    #status {
      text-align: center; padding: 1rem;
      background: rgba(255,255,255,0.03);
      border-radius: 0.75rem;
      color: #a1a1aa; font-size: 0.9rem;
    }
    .spinner {
      display: inline-block; width: 20px; height: 20px;
      border: 2px solid rgba(255,255,255,0.15);
      border-top-color: #10b981;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      vertical-align: middle;
      margin-right: 0.5rem;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .file-list { list-style: none; margin-top: 1rem; }
    .file-item {
      display: flex; align-items: center; justify-content: space-between;
      padding: 0.75rem 1rem;
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: 0.75rem;
      margin-bottom: 0.5rem;
      transition: background 0.2s;
    }
    .file-item:hover { background: rgba(255,255,255,0.06); }
    .file-info { flex: 1; min-width: 0; }
    .file-name { font-weight: 500; font-size: 0.9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .file-size { font-size: 0.75rem; color: #71717a; margin-top: 2px; }
    .btn-download {
      display: inline-flex; align-items: center; gap: 0.4rem;
      padding: 0.4rem 0.8rem;
      background: linear-gradient(135deg, #10b981, #14b8a6);
      color: #fff; border: none; border-radius: 0.5rem;
      font-size: 0.8rem; font-weight: 500; cursor: pointer;
      transition: opacity 0.2s; flex-shrink: 0; margin-left: 0.75rem;
    }
    .btn-download:hover { opacity: 0.85; }
    .btn-download svg { width: 14px; height: 14px; }
    .btn-all {
      display: block; width: 100%;
      padding: 0.75rem;
      background: linear-gradient(135deg, #10b981, #14b8a6);
      color: #fff; border: none; border-radius: 0.75rem;
      font-size: 0.95rem; font-weight: 600; cursor: pointer;
      margin-top: 1rem; transition: opacity 0.2s;
    }
    .btn-all:hover { opacity: 0.9; }
    .error-msg {
      text-align: center; padding: 1rem;
      background: rgba(239,68,68,0.1);
      border: 1px solid rgba(239,68,68,0.2);
      border-radius: 0.75rem;
      color: #fca5a5; font-size: 0.9rem;
    }
    .meta-row {
      display: flex; justify-content: space-between;
      font-size: 0.8rem; color: #71717a;
      padding: 0 0.5rem; margin-bottom: 1rem;
    }
    .expired-badge {
      display: inline-block; padding: 0.15rem 0.5rem;
      background: rgba(239,68,68,0.15); color: #fca5a5;
      border-radius: 0.5rem; font-size: 0.75rem; font-weight: 500;
    }
  </style>
</head>
<body>
  <div class="bg-glow"></div>
  <div class="card">
    <div class="logo">
      <div class="logo-icon">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.935 2.186 2.25 2.25 0 0 0-3.935-2.186Zm0-12.814a2.25 2.25 0 1 0 3.933-2.185 2.25 2.25 0 0 0-3.933 2.185Z"/>
        </svg>
      </div>
      <h1>CosmoShare</h1>
      <p class="subtitle">WhatsApp Bot — File Download</p>
    </div>
    <div class="code-display">${code}</div>
    <div id="status"><span class="spinner"></span>Loading files…</div>
    <div id="files-container"></div>
  </div>

  <script>
    const CODE = '${code}';
    const API_BASE = '';

    async function loadFiles() {
      const statusEl = document.getElementById('status');
      const filesEl = document.getElementById('files-container');

      try {
        const res = await fetch(API_BASE + '/api/files/' + CODE);
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Unknown error' }));
          if (res.status === 404) {
            statusEl.innerHTML = '<div class="error-msg">This code has expired or already been used.</div>';
          } else {
            statusEl.innerHTML = '<div class="error-msg">' + (err.error || 'Failed to load files') + '</div>';
          }
          return;
        }

        const data = await res.json();
        if (!data.files || data.files.length === 0) {
          statusEl.innerHTML = '<div class="error-msg">No files found for this code.</div>';
          return;
        }

        const fmtBytes = (b) => {
          if (b === 0) return '0 B';
          const u = ['B', 'KB', 'MB', 'GB'];
          const i = Math.floor(Math.log(b) / Math.log(1024));
          return (b / Math.pow(1024, i)).toFixed(1) + ' ' + u[i];
        };

        const typeLabel = data.type === 'multishare' ? 'MultiShare' : 'OneShare';
        statusEl.innerHTML = '<div class="meta-row"><span>' + typeLabel + ' · ' + data.files.length + ' file(s)</span><span>' + fmtBytes(data.totalSize) + '</span></div>';

        let html = '<ul class="file-list">';
        data.files.forEach((f, i) => {
          html += '<li class="file-item">' +
            '<div class="file-info"><div class="file-name">' + escHtml(f.fileName) + '</div>' +
            '<div class="file-size">' + fmtBytes(f.fileSize) + '</div></div>' +
            '<button class="btn-download" onclick="downloadFile(' + i + ')">' +
            '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"/></svg>' +
            'Download</button></li>';
        });
        html += '</ul>';

        if (data.files.length > 1) {
          html += '<button class="btn-all" onclick="downloadAll()">Download All (' + data.files.length + ' files)</button>';
        }

        filesEl.innerHTML = html;
        window._filesData = data.files;
      } catch (err) {
        statusEl.innerHTML = '<div class="error-msg">Network error. Please try again.</div>';
      }
    }

    function escHtml(s) {
      const d = document.createElement('div');
      d.textContent = s;
      return d.innerHTML;
    }

    function b64ToBlob(b64, type) {
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return new Blob([arr], { type: type || 'application/octet-stream' });
    }

    function downloadFile(idx) {
      const f = window._filesData[idx];
      const blob = b64ToBlob(f.data, f.fileType);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = f.fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }

    function downloadAll() {
      (window._filesData || []).forEach((_, i) => {
        setTimeout(() => downloadFile(i), i * 300);
      });
    }

    loadFiles();
  </script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: new Headers({
      'Content-Type': 'text/html; charset=utf-8',
      ...CORS_HEADERS,
    }),
  });
}

// ---------------------------------------------------------------------------
// Single file download — /download/:code/:filename
// ---------------------------------------------------------------------------

async function handleSingleFileDownload(code: string, fileName: string, env: Env): Promise<Response> {
  try {
    const shareRaw = await env.FILE_STORE.get(`share:${code}`);
    if (!shareRaw) {
      return errorResponse('Share code not found or expired', 404);
    }

    const shareData = JSON.parse(shareRaw) as {
      files: { key: string; fileName: string; fileSize: number; fileType: string }[];
    };

    const fileMeta = shareData.files.find(f => f.fileName === decodeURIComponent(fileName));
    if (!fileMeta) {
      return errorResponse('File not found', 404);
    }

    const fileBuffer = await env.FILE_STORE.get(fileMeta.key, { type: 'arrayBuffer' });
    if (!fileBuffer) {
      return errorResponse('File data not found or expired', 404);
    }

    return new Response(fileBuffer, {
      status: 200,
      headers: new Headers({
        'Content-Type': fileMeta.fileType || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${fileMeta.fileName}"`,
        'Content-Length': String(fileMeta.fileSize),
        ...CORS_HEADERS,
      }),
    });
  } catch (err: any) {
    return errorResponse(`Download failed: ${err.message}`, 500);
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

function matchRoute(method: string, pathname: string): { handler: string; params?: Record<string, string> } | null {
  if (method === 'GET' && pathname === '/api/health') return { handler: 'health' };
  if (method === 'POST' && pathname === '/api/upload') return { handler: 'upload' };
  if (method === 'POST' && pathname === '/api/share/oneshare') return { handler: 'oneshare' };
  if (method === 'POST' && pathname === '/api/share/multishare') return { handler: 'multishare' };
  if (method === 'POST' && pathname === '/api/share/labshare') return { handler: 'labshare' };

  // GET /api/files/:code (JSON API)
  const filesMatch = pathname.match(/^\/api\/files\/(\d{4})$/);
  if (method === 'GET' && filesMatch) {
    return { handler: 'getFiles', params: { code: filesMatch[1] } };
  }

  // GET /share/:code (download page)
  const sharePageMatch = pathname.match(/^\/share\/(\d{4})$/);
  if (method === 'GET' && sharePageMatch) {
    return { handler: 'sharePage', params: { code: sharePageMatch[1] } };
  }

  // GET /download/:code/:filename (direct file download)
  const downloadMatch = pathname.match(/^\/download\/(\d{4})\/(.+)$/);
  if (method === 'GET' && downloadMatch) {
    return { handler: 'download', params: { code: downloadMatch[1], fileName: downloadMatch[2] } };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main fetch handler
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return handleCors();
    }

    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    const route = matchRoute(method, pathname);

    if (!route) {
      return errorResponse('Not found', 404);
    }

    // Public endpoints: health, sharePage, download
    // Authenticated endpoints: upload, oneshare, multishare, labshare, getFiles
    const publicHandlers = ['health', 'sharePage', 'download'];
    if (!publicHandlers.includes(route.handler)) {
      if (!isAuthorized(request, env)) {
        return errorResponse('Unauthorized', 401);
      }
    }

    switch (route.handler) {
      case 'health':
        return handleHealth();
      case 'upload':
        return handleUpload(request, env);
      case 'oneshare':
        return handleOneShare(request, env);
      case 'multishare':
        return handleMultiShare(request, env);
      case 'labshare':
        return handleLabShare(request, env);
      case 'getFiles':
        return handleGetFiles(route.params!.code, env);
      case 'sharePage':
        return renderDownloadPage(route.params!.code);
      case 'download':
        return handleSingleFileDownload(route.params!.code, route.params!.fileName, env);
      default:
        return errorResponse('Not found', 404);
    }
  },
};
