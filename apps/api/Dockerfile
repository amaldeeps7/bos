# Business OS API (NestJS + Prisma). Build from the repository root:
#   docker build -f apps/api/Dockerfile .
FROM node:22-bookworm-slim AS build
# Prisma reads the OpenSSL version to pick its query engine.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/* && corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @bos/api... --filter @bos/shared
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @bos/shared build \
 && pnpm --filter @bos/api exec prisma generate \
 && pnpm --filter @bos/api build

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app/apps/api
EXPOSE 4000
# Apply migrations, load the demo workspace into an empty database (SEED_DEMO=true), then start.
CMD ["sh", "-c", "npx prisma migrate deploy && node prisma/app-role.js && if [ \"$SEED_DEMO\" = \"true\" ]; then npx ts-node --transpile-only prisma/seed.ts --if-empty; fi && node dist/main.js"]
