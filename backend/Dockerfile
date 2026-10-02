# Serbian Transcriber — API image
# Node 20 slim + ffmpeg, so MOV files and videos larger than the Groq limit
# can be converted to compact mono 16 kHz audio server-side.

FROM node:20-bookworm-slim

# ffmpeg: audio extraction for .mov and oversized uploads
# ca-certificates: TLS for the Groq API
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first for better layer caching
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# Temp upload dir must be writable by the unprivileged user
RUN mkdir -p uploads && chown -R node:node /app
USER node

ENV NODE_ENV=production \
    PORT=3000 \
    FFMPEG_PATH=/usr/bin/ffmpeg

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]