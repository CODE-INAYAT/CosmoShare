# Lightweight Node.js image for Socket.IO signaling server
FROM node:18-slim

# Set working directory
WORKDIR /app

# Copy dependency files
COPY package*.json ./

# Install production dependencies only
RUN npm install --omit=dev && npm cache clean --force

# Copy application code
COPY . .

# Hugging Face Spaces routes traffic to port 7860
EXPOSE 7860

# Start the signaling server
CMD ["npm", "start"]
