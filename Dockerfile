FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps ./apps
COPY packages ./packages
COPY promptfoo ./promptfoo
COPY tsconfig.base.json eslint.config.mjs ./
RUN pnpm install --frozen-lockfile=false
RUN pnpm build

FROM node:22-alpine AS runner
RUN corepack enable
WORKDIR /app
COPY --from=build /app ./
ENV NODE_ENV=production
