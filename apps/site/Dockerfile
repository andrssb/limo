FROM node:20-alpine AS builder
WORKDIR /app

# Build root = apps/site (deploy com `railway up apps/site --path-as-root`, e o
# apps/site/railway.json aponta dockerfilePath "Dockerfile"). Isso desacopla o
# site do railway.json da RAIZ (que é da API) — era o que fazia o @limo/site
# buildar/subir a API no lugar do site estático. Site é autossuficiente.
COPY package.json ./
RUN npm install --no-audit --no-fund

COPY . ./
RUN npm run build

# Serve o build estático com nginx
FROM nginx:alpine AS runner
RUN rm -f /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/templates/default.conf.template

EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
