# Стенд транспорта: один контейнер — страница, API, хранилище (SQLite на томе /data).
#   docker build -t stand .
#   docker run -p 8080:8080 -v stand-data:/data -e ANTHROPIC_API_KEY=... -e ADMIN_TOKEN=... -e IP_SALT=... stand
FROM node:22.14-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run typecheck && npm run build

FROM node:22.14-bookworm-slim
ENV NODE_ENV=production PORT=8080 DB_PATH=/data/stand.db TRUST_PROXY=1
WORKDIR /app
COPY package.json package-lock.json ./
# Сервер запускается из исходников TypeScript (node --experimental-strip-types), без сборщика.
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY src ./src
COPY data/research.md ./data/research.md
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--experimental-strip-types", "--no-warnings", "src/server/server.ts", "--static"]
