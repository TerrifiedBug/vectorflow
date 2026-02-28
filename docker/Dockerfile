# syntax=docker/dockerfile:1

# ---- Stage 1: Install deps ----
FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# ---- Stage 2: Download Vector binary (cached unless VECTOR_VERSION changes) ----
FROM alpine:3.21 AS vector
ARG VECTOR_VERSION=0.44.0
RUN apk add --no-cache curl && \
    curl -sSfL -o /tmp/vector.tar.gz \
      "https://packages.timber.io/vector/${VECTOR_VERSION}/vector-${VECTOR_VERSION}-x86_64-unknown-linux-musl.tar.gz" && \
    tar xzf /tmp/vector.tar.gz -C /tmp && \
    cp /tmp/vector-x86_64-unknown-linux-musl/bin/vector /usr/local/bin/vector && \
    rm -rf /tmp/vector*

# ---- Stage 3: Build app ----
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml tsconfig.json next.config.ts postcss.config.mjs components.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts
RUN npx prisma generate
COPY src ./src
COPY public ./public
RUN --mount=type=cache,target=/app/.next/cache \
    pnpm build

# ---- Stage 4: Production runner ----
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN apk add --no-cache su-exec git openssh-client && \
    addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 vectorflow

# Copy Vector binary from dedicated stage
COPY --from=vector /usr/local/bin/vector /usr/local/bin/vector

# Copy Next.js standalone output
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

# Copy Prisma schema, config, and migrations for runtime migration
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts

# Copy full node_modules for prisma migrate deploy
COPY --from=build /app/node_modules ./node_modules

# Copy entrypoint script
COPY docker/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

RUN chown -R vectorflow:nodejs /app

EXPOSE 3000

ENTRYPOINT ["./entrypoint.sh"]
