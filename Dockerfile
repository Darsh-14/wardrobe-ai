# One image for the whole app: the API (backend/) also serves the built web app (frontend/).
FROM node:22-slim AS web
WORKDIR /web
RUN npm install -g pnpm@10
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm exec vite build

FROM node:22-slim AS api
WORKDIR /api
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production STATIC_DIR=/app/public
COPY --from=api /api/node_modules ./node_modules
COPY --from=api /api/dist ./dist
COPY backend/package.json ./
COPY --from=web /web/dist ./public
EXPOSE 8787
CMD ["node", "dist/server.js"]
