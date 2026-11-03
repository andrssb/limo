FROM node:20-alpine
WORKDIR /app

# Install ALL dependencies (tsx is needed at runtime)
COPY package*.json ./
COPY apps/api/package.json        ./apps/api/
COPY packages/db/package.json     ./packages/db/
COPY packages/types/package.json  ./packages/types/
RUN npm ci --workspace=apps/api --workspace=packages/db --workspace=packages/types

# Copy source
COPY tsconfig.base.json ./
COPY apps/api  ./apps/api
COPY packages  ./packages

EXPOSE 3001
CMD ["node", "node_modules/tsx/dist/cli.mjs", "apps/api/src/index.ts"]
