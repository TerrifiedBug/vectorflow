# syntax=docker/dockerfile:1

# ---- Stage 1: Install deps ----
FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# ---- Stage 2: Download Vector binary (cached unless VECTOR_VERSION changes) ----
FROM alpine:3.21 AS vector
ARG VECTOR_VERSION=0.53.0
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
RUN pnpm exec prisma generate
COPY src ./src
COPY public ./public
COPY server.ts ./server.ts
RUN --mount=type=cache,target=/app/.next/cache \
    pnpm build
# Bundle custom server.ts → server.js (replaces Next.js default standalone server.js)
# --packages=external keeps npm deps external (resolved from node_modules at runtime)
RUN pnpm exec esbuild server.ts --bundle --platform=node --target=node22 \
    --outfile=.next/standalone/server.js \
    --packages=external
# Save Prisma client version for the runner stage (standalone strips node_modules)
RUN node -e "console.log(require('./node_modules/@prisma/client/package.json').version)" > /tmp/prisma-version

# ---- Stage 4: Production runner ----
FROM node:22-alpine AS runner
WORKDIR /app

ARG VF_VERSION=dev
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV VF_VERSION=${VF_VERSION}

RUN apk add --no-cache git openssh-client postgresql-client && \
    addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 vectorflow

# Copy Vector binary
COPY --from=vector /usr/local/bin/vector /usr/local/bin/vector

# Copy Next.js standalone output (--chown avoids separate chown -R)
COPY --from=build --chown=vectorflow:nodejs /app/.next/standalone ./
COPY --from=build --chown=vectorflow:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=vectorflow:nodejs /app/public ./public

# Copy Prisma schema, config, and migrations for runtime migration
COPY --from=build --chown=vectorflow:nodejs /app/prisma ./prisma
COPY --from=build --chown=vectorflow:nodejs /app/prisma.config.ts ./prisma.config.ts

# Install Prisma CLI globally for `prisma migrate deploy` at startup.
# Version-locked to match the @prisma/client bundled by Next.js standalone.
# Also symlink into local node_modules so prisma.config.ts can `import from 'prisma/config'`.
COPY --from=build /tmp/prisma-version /tmp/prisma-version
RUN npm install --global prisma@$(cat /tmp/prisma-version) && \
    rm /tmp/prisma-version && \
    ln -s "$(npm root -g)/prisma" node_modules/prisma

# Create runtime data directory for system vector config and audit logs
RUN mkdir -p /app/.vectorflow && chown vectorflow:nodejs /app/.vectorflow

# Create backup directory
RUN mkdir -p /backups && chown vectorflow:nodejs /backups

# Copy entrypoint script
COPY --chown=vectorflow:nodejs docker/server/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

USER vectorflow
EXPOSE 3000

ENTRYPOINT ["./entrypoint.sh"]
