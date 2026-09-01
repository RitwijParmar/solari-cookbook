FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
RUN pnpm build

FROM node:22-alpine
ENV NODE_ENV=production PORT=8080
WORKDIR /app
RUN addgroup -S ghostack && adduser -S ghostack -G ghostack
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && pnpm install --prod --frozen-lockfile
COPY --from=build /app/dist ./dist
COPY public ./public
USER ghostack
EXPOSE 8080
CMD ["node", "dist/server.js"]
