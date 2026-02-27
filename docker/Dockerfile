# ---- Stage 1: Install dependencies ----
FROM node:22-alpine AS deps
WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml ./

RUN pnpm install --frozen-lockfile

# ---- Stage 2: Build the application ----
FROM node:22-alpine AS build
WORKDIR /app

RUN corepack enable

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npx prisma generate
RUN pnpm build

# Install prisma CLI into an isolated directory so we can copy
# a clean, self-contained tree into the runner stage.
RUN mkdir -p /prisma-cli && cd /prisma-cli && \
    npm init -y && \
    npm install prisma@7.4.2 dotenv@17

# ---- Stage 3: Production runner ----
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 vectorflow

# Copy Next.js standalone output
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

# Copy Prisma schema, config, and migrations for runtime migration
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts

# Copy isolated prisma CLI with all dependencies
COPY --from=build /prisma-cli/node_modules ./node_modules_prisma

# Copy entrypoint script
COPY docker/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

RUN chown -R vectorflow:nodejs /app

USER vectorflow

EXPOSE 3000

ENTRYPOINT ["./entrypoint.sh"]
