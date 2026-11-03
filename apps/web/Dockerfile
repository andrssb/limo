FROM node:20-alpine AS builder
WORKDIR /app

# Install deps
COPY package*.json ./
COPY apps/web/package.json       ./apps/web/
COPY packages/types/package.json ./packages/types/
RUN npm ci --workspace=apps/web --workspace=packages/types

# Copy source (Vite resolves TS types directly at build time)
COPY tsconfig.base.json ./
COPY apps/web      ./apps/web
COPY packages/types ./packages/types

ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build --workspace=apps/web

# Serve with nginx
FROM nginx:alpine AS runner
# Remove default config; template will be loaded from /etc/nginx/templates/
RUN rm -f /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
# nginx entrypoint runs envsubst on *.template files automatically
COPY apps/web/nginx.conf /etc/nginx/templates/default.conf.template

EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
