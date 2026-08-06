FROM node:22-slim

# Chromium + system fonts for whatsapp-web.js/Puppeteer
# No bundled Chromium download — use system Chromium (smaller image)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ca-certificates \
    chromium \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    && rm -rf /var/lib/apt/lists/*

# Tell Puppeteer to use system Chromium, skip bundled download
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Force IPv4-first DNS (Docker containers often have broken IPv6 routing)
ENV NODE_OPTIONS="--dns-result-order=ipv4first"

WORKDIR /app

COPY package*.json ./

# Use npm install (not ci) since we don't ship a lockfile
RUN npm install --omit=dev && npm cache clean --force

COPY . .

# Create directories and set permissions (HF runs as UID 1000)
RUN rm -rf /app/sessions /app/logs /app/temp \
    && mkdir -p /data /app/logs /app/temp /app/sessions \
    && chmod -R 777 /data /app

# HF Spaces routes traffic to port 7860
EXPOSE 7860

CMD ["npm", "start"]
