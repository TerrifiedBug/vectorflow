# ---- Stage 1: Install dependencies ----
FROM node:22-alpine AS deps
WORKDIR /app

# Enable pnpm via corepack
RUN corepack enable

# Copy dependency manifests
COPY package.json pnpm-lock.yaml ./

# Install all dependencies (including devDependencies for build)
RUN pnpm install --frozen-lockfile

# ---- Stage 2: Build the application ----
FROM node:22-alpine AS build
WORKDIR /app

RUN corepack enable

# Copy dependencies from previous stage
COPY --from=deps /app/node_modules ./node_modules

# Copy source code
COPY . .

# Generate Prisma client (output: src/generated/prisma)
RUN npx prisma generate

# Build Next.js (standalone output)
RUN pnpm build

# ---- Stage 3: Production runner ----
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 vectorflow

# Copy Next.js standalone output
COPY --from=build /app/.next/standalone ./

# Copy static assets and public directory
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

# Copy Prisma schema, config, and migrations for runtime migration
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts

# Install prisma CLI with all its dependencies for migrate deploy.
# This is done as a separate npm install rather than cherry-picking
# packages, because prisma has deep transitive deps (@prisma/engines,
# @prisma/config, dotenv, etc.) that are hard to copy individually.
RUN npm install --no-save prisma@7.4.2

# Copy entrypoint script
COPY docker/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

# Set ownership to non-root user
RUN chown -R vectorflow:nodejs /app

USER vectorflow

EXPOSE 3000

ENTRYPOINT ["./entrypoint.sh"]
