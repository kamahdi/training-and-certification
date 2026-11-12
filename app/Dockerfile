# Clinic Waiting Room (ADR-006): one image, one container for the whole app. By default (ROLE=all)
# the container runs the web server, serves the web pages and runs the background worker.
#   docker build -t clinic-waiting-room .
#   docker run -e DATABASE_URL=... -e FIELD_ENCRYPTION_KEY=... -e LINK_SECRET=... -p 3000:3000 clinic-waiting-room
# To scale, run more copies of the same container. ROLE=web or ROLE=worker splits the roles if ever needed
# (a ROLE=worker container serves no HTTP, so its health check fails by design: disable it there).

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
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/server/server/index.js"]
