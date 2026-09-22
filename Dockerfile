# ---------- build ----------
FROM node:22-alpine AS build
# Dependências de compilação nativa (better-sqlite3 usa node-gyp quando não há pré-compilado)
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---------- runtime ----------
FROM node:22-alpine
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PONTO_DB_PATH=/app/data/ponto.sqlite
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.mjs ./next.config.mjs
COPY --from=build /app/ponto.json ./ponto.json
RUN mkdir -p /app/data
# Monte um volume em /app/data para o banco sobreviver a redeploys
VOLUME /app/data
EXPOSE 3000
CMD ["npm", "run", "start"]