# JSREE backend — infrastructure-only container image.
# Runs the EXISTING application unchanged:
#   same entry point (src/index.js), same start command (node src/index.js).
# Multi-arch base image (amd64/arm64) so it builds and runs on OCI Ampere A1 (ARM).

FROM node:22-bookworm-slim AS base

ENV NODE_ENV=production
WORKDIR /app

# Install production dependencies first (better layer caching).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# Copy the rest of the application source.
# (Excluded files are listed in .dockerignore; application code is unmodified.)
COPY . .

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
