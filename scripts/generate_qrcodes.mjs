/**
 * ============================================================================
 * CosmoShare QR Code Generator
 * ============================================================================
 * Usage:
 * To generate high-resolution JPG images and a highly-optimized Vector PDF
 * containing the QR codes for all LabShare rooms, simply run:
 * 
 *    node scripts/generate_qrcodes.mjs
 * 
 * Output:
 * The images and the \`LabShare_QRCodes.pdf\` will be created in the \`./QRcode/\` directory.
 * ============================================================================
 */
import fs from 'fs';
import path from 'path';
import { JSDOM } from 'jsdom';
import sharp from 'sharp';
import puppeteer from 'puppeteer';

// ─── CONFIGURATION ──────────────────────────────────────────────────
// Edit this URL to match your production domain.
const BASE_URL = "https://cosmoshare.pages.dev";
// I use a short URL approach: cosmoshare.com/r/312
// ────────────────────────────────────────────────────────────────────

const __dirname = path.resolve();
const OUTPUT_DIR = path.join(__dirname, 'QRcode');

// 1. Setup JSDOM to polyfill browser environment for qr-code-styling
const dom = new JSDOM(`<!DOCTYPE html><p>Hello world</p>`, {
    url: "http://localhost",
    pretendToBeVisual: true
});
global.window = dom.window;
global.document = dom.window.document;

// Now we can require qr-code-styling safely
import QRCodeStyling from 'qr-code-styling';

// 2. Extract room numbers from src/config/rooms.ts using regex
const roomsFilePath = path.join(__dirname, 'src', 'config', 'rooms.ts');
const roomsFileContent = fs.readFileSync(roomsFilePath, 'utf-8');
const roomNumbersMatch = roomsFileContent.match(/export const roomNumbers:\s*string\[\]\s*=\s*\[([\s\S]*?)\]/);

if (!roomNumbersMatch) {
    console.error("Could not find roomNumbers array in src/config/rooms.ts");
    process.exit(1);
}

const roomNumbers = roomNumbersMatch[1]
    .split(',')
    .map(r => r.trim().replace(/"/g, '').replace(/'/g, ''))
    .filter(r => r.length > 0 && !r.startsWith('//'));

if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// 3. SVG Template Generator
async function generateQRCodeSVG(room) {
    const url = `${BASE_URL}/r/${room}`;
    const qrSize = 1200; // Reduced from 1400 to provide a massive mathematically compliant Quiet Zone

    const qrCode = new QRCodeStyling({
        width: qrSize,
        height: qrSize,
        type: 'svg',
        data: url,
        margin: 0,
        qrOptions: {
            errorCorrectionLevel: 'Q' // Bumped from M (15%) to Q (25%) for maximum physical scanning robustness
        },
        dotsOptions: {
            type: 'dots',
            color: '#000000',
            roundSize: true
        },
        cornersSquareOptions: {
            type: 'extra-rounded',
            color: '#000000'
        },
        cornersDotOptions: {
            type: 'square', // Using 'square' instead of 'dot' guarantees absolute structural anchor detection by Google Lens
            color: '#000000'
        },
        backgroundOptions: {
            color: '#FFFFFF'
        }
    });

    const container = document.createElement('div');
    qrCode.append(container);

    // Wait slightly for SVG to render in jsdom
    await new Promise(resolve => setTimeout(resolve, 100));

    const svgElement = container.querySelector('svg');
    if (!svgElement) {
        throw new Error("SVG generation failed");
    }



    // Extract the raw SVG string without the outermost svg tag, or just grab innerHTML
    const qrSvgContent = svgElement.innerHTML;
    const viewBox = svgElement.getAttribute('viewBox') || `0 0 ${qrSize} ${qrSize}`;

    // A4 Portrait Size: 2480 x 3508
    // Layout matched perfectly to FullPageLoader.tsx
    const template = `
<svg width="2480" height="3508" viewBox="0 0 2480 3508" xmlns="http://www.w3.org/2000/svg">
    <defs>
        <!-- Ambient Glow (bg-primary/5 blur) -->
        <radialGradient id="glow_${room}" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#00867c" stop-opacity="0.10" />
            <stop offset="100%" stop-color="#00867c" stop-opacity="0" />
        </radialGradient>
        
        <!-- Gradient Text (gradient-primary) -->
        <linearGradient id="textGradient_${room}" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#00867c" />
            <stop offset="50%" stop-color="#14B8A6" />
            <stop offset="100%" stop-color="#06B6D4" />
        </linearGradient>
    </defs>

    <style>
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&amp;display=swap');
        text {
            font-family: 'Plus Jakarta Sans', sans-serif;
        }
    </style>

    <!-- Background (bg-background #FAFBFC) -->
    <rect width="2480" height="3508" fill="#FAFBFC" />
    
    <!-- Ambient Glow Centered -->
    <circle cx="1240" cy="1500" r="1600" fill="url(#glow_${room})" />

    <!-- QR Code White Card (Shadow matching shadow-lg shadow-primary/25) -->
    <rect x="440" y="500" width="1600" height="1600" rx="120" fill="#ffffff" filter="drop-shadow(0 60px 120px rgba(0,134,124,0.25))" />
    
    <!-- Embed the actual QR Code (Centered with mathematically compliant 4+ module Quiet Zone) -->
    <g transform="translate(640, 700)">
        <svg width="1200" height="1200" viewBox="${viewBox}">
            ${qrSvgContent}
        </svg>
    </g>

    <!-- Text Below QR Code (matching FullPageLoader titles) -->
    <g transform="translate(1240, 2250)" text-anchor="middle">
        <text font-size="80" font-weight="500" fill="#6B7280">Scan to join</text>
        
        <!-- Offset by +110 to perfectly center the Text + Icon block -->
        <g transform="translate(110, 200)">
            <text x="0" y="0" font-size="220" font-weight="700" fill="#111827" letter-spacing="-4">Lab ${room}</text>
            <!-- Printer icon perfectly sized and aligned to the left -->
            <g transform="translate(-620, -165) scale(7)">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#00867c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
                    <path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6"/>
                    <rect x="6" y="14" width="12" height="8" rx="1"/>
                </svg>
            </g>
        </g>

        <!-- "OR" Separator -->
        <text y="370" font-size="65" font-weight="700" fill="#111827">OR</text>

        <!-- Google Search Pill -->
        <g transform="translate(-650, 450)">
            <!-- Pill Shadow and Background -->
            <rect x="0" y="0" width="1300" height="180" rx="90" fill="#ffffff" filter="drop-shadow(0 15px 35px rgba(0,0,0,0.1))" stroke="#E5E7EB" stroke-width="2" />
            
            <!-- Google G Logo -->
            <g transform="translate(60, 47) scale(1.8)">
                <svg width="48" height="48" viewBox="0 0 48 48">
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.7 17.74 9.5 24 9.5z"/>
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                </svg>
            </g>
            
            <!-- Vertical Divider -->
            <line x1="180" y1="45" x2="180" y2="135" stroke="#E5E7EB" stroke-width="3" />
            
            <!-- Search Query Text -->
            <text x="240" y="125" font-size="95" font-weight="600" fill="#374151" text-anchor="start" letter-spacing="-2">CosmoShare</text>
            
            <!-- Google Mic Logo -->
            <g transform="translate(1140, 42) scale(4)">
                <svg width="24" height="24" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M12 15c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v7c0 1.66 1.34 3 3 3z"/>
                  <path fill="#34A853" d="M11 18.92h2V22h-2z"/>
                  <path fill="#F4B400" d="M7 12H5c0 1.93.78 3.68 2.05 4.95l1.41-1.41C7.56 14.63 7 13.38 7 12z"/>
                  <path fill="#EA4335" d="M12 17c-1.38 0-2.63-.56-3.54-1.47l-1.41 1.41C8.32 18.22 10.07 19 12 19c3.87 0 7-3.13 7-7h-2c0 2.76-2.24 5-5 5z"/>
                </svg>
            </g>
        </g>
        
        <!-- Text below the pill -->
        <text y="740" font-size="80" font-weight="500" fill="#6B7280">Search</text>
    </g>

    <!-- Bottom Branding (Absolute bottom-8 equivalent) -->
    <!-- Centered block -->
    <g transform="translate(1240, 3300)">
        <!-- Logo -->
        <g transform="translate(-496, -76) scale(0.3)">
            <g transform="rotate(-30, 256, 256)">
                <path d="M 11,256 A 245,70 0 0,0 501,256 L 469,256 A 213,56 0 0,1 43,256 Z" fill="#00867c" fill-opacity="0.6" />
            </g>
            <circle cx="256" cy="256" r="150" fill="#00867c" />
            <g transform="rotate(-30, 256, 256)">
                <path d="M 501,256 A 245,70 0 0,0 11,256 L 43,256 A 213,56 0 0,1 469,256 Z" fill="#00867c" fill-opacity="0.6" />
            </g>
            <g transform="translate(172, 172) scale(7)">
                <path d="M16.19 2H7.81C4.17 2 2 4.17 2 7.81V16.18C2 19.83 4.17 22 7.81 22H16.18C19.82 22 21.99 19.83 21.99 16.19V7.81C22 4.17 19.83 2 16.19 2ZM8.47 8.98L11.47 5.98C11.54 5.91 11.62 5.86 11.71 5.82C11.89 5.74 12.1 5.74 12.28 5.82C12.37 5.86 12.45 5.91 12.52 5.98L15.52 8.98C15.81 9.27 15.81 9.75 15.52 10.04C15.37 10.19 15.18 10.26 14.99 10.26C14.8 10.26 14.61 10.19 14.46 10.04L12.74 8.32V14.51C12.74 14.92 12.4 15.26 11.99 15.26C11.58 15.26 11.24 14.92 11.24 14.51V8.32L9.52 10.04C9.23 10.33 8.75 10.33 8.46 10.04C8.17 9.75 8.18 9.28 8.47 8.98ZM18.24 17.22C16.23 17.89 14.12 18.23 12 18.23C9.88 18.23 7.77 17.89 5.76 17.22C5.37 17.09 5.16 16.66 5.29 16.27C5.42 15.88 5.85 15.66 6.24 15.8C9.96 17.04 14.05 17.04 17.77 15.8C18.16 15.67 18.59 15.88 18.72 16.27C18.84 16.67 18.63 17.09 18.24 17.22Z" fill="#ffffff" />
            </g>
        </g>
        
        <!-- text-sm font-bold tracking-widest uppercase gradient-text -->
        <text x="-303" y="25" font-size="80" font-weight="700" fill="url(#textGradient_${room})" letter-spacing="24" text-anchor="start">COSMOSHARE</text>
    </g>
</svg>
    `;

    return template.trim();
}

async function main() {
    console.log("Generating QR Codes...");

    // Create a sample SVG for Room 312
    const sampleRoom = "312";
    const sampleSvg = await generateQRCodeSVG(sampleRoom);
    fs.writeFileSync(path.join(OUTPUT_DIR, 'sample.svg'), sampleSvg);
    console.log(`✅ Created sample SVG for Room ${sampleRoom}`);

    const allSvgs = [];

    // Generate JPGs for all rooms
    for (const room of roomNumbers) {
        console.log(`Processing Room ${room}...`);
        const svgString = await generateQRCodeSVG(room);
        allSvgs.push(svgString);

        const outputPath = path.join(OUTPUT_DIR, `${room}_QRcode.jpg`);
        await sharp(Buffer.from(svgString))
            .jpeg({ quality: 100, progressive: true })
            .toFile(outputPath);

        console.log(`✅ Generated ${room}_QRcode.jpg`);
    }

    console.log("Generating highly-optimized vector PDF (LabShare_QRCodes.pdf)...");
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
<style>
  @page { size: A4 portrait; margin: 0; }
  body { margin: 0; padding: 0; background: #FAFBFC; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page {
    width: 210mm;
    height: 297mm;
    page-break-after: always;
    display: flex;
    justify-content: center;
    align-items: center;
    overflow: hidden;
  }
  .page:last-child {
    page-break-after: auto;
  }
  svg {
    width: 100%;
    height: 100%;
  }
</style>
</head>
<body>
  ${allSvgs.map(svg => `<div class="page">${svg}</div>`).join('\n')}
</body>
</html>`;

    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    // Wait until networkidle0 to ensure the Google Font "Plus Jakarta Sans" loads and renders accurately
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

    await page.pdf({
        path: path.join(OUTPUT_DIR, 'LabShare_QRCodes.pdf'),
        format: 'A4',
        printBackground: true
    });

    await browser.close();
    console.log(`✅ Generated LabShare_QRCodes.pdf`);

    console.log("🎉 All QR codes generated successfully in ./QRcode/");
    process.exit(0);
}

main().catch(console.error);
