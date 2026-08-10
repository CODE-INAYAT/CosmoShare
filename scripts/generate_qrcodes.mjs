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
const BASE_URL = "http://192.168.31.163:3000";
// We use a short URL approach: cosmoshare.com/r/312
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
    const qrSize = 1400;

    const qrCode = new QRCodeStyling({
        width: qrSize,
        height: qrSize,
        type: 'svg',
        data: url,
        margin: 0,
        qrOptions: {
            errorCorrectionLevel: 'M' // Optimized for speed of light scanning
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
            type: 'dot',
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

    // Apply dot scaling logic (same as OneShare)
    const circles = svgElement.querySelectorAll('circle');
    circles.forEach((circle) => {
        const r = circle.getAttribute('r');
        if (r) {
            const newRadius = parseFloat(r) * 0.7;
            circle.setAttribute('r', newRadius.toString());
        }
    });

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
    
    <!-- Embed the actual QR Code -->
    <g transform="translate(540, 600)">
        <svg width="1400" height="1400" viewBox="${viewBox}">
            ${qrSvgContent}
        </svg>
    </g>

    <!-- Text Below QR Code (matching FullPageLoader titles) -->
    <g transform="translate(1240, 2400)" text-anchor="middle">
        <text font-size="80" font-weight="500" fill="#6B7280">Scan to join</text>
        <!-- Offset by +110 to perfectly center the Text + Icon block -->
        <g transform="translate(110, 220)">
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
