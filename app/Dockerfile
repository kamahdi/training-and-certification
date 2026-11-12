# Clinic Waiting Room: one image for the API server (default) and the background worker.
#   docker build -t clinic-waiting-room .
#   docker run ... clinic-waiting-room                                       (server, port 3000)
#   docker run ... clinic-waiting-room node dist/server/server/worker/index.js   (worker)

# --- build: install everything, build the web app and compile the server
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- runtime dependencies only
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# --- runtime
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
# Shared outbox folder for the fake text provider (a named volume copies this ownership on first use).
RUN mkdir /outbox && chown node:node /outbox
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/server/server/index.js"]
