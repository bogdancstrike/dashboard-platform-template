# Nucleus SPA image: build with Vite, serve the static bundle with nginx.

FROM node:20-alpine AS build

WORKDIR /app

# Lockfile first, so the dependency layer is cached until dependencies change.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build


FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html

# The official entrypoint renders /etc/nginx/templates before nginx starts, so
# the upstream is a deployment concern rather than a rebuild. Compose points it
# at the `api` service; Kubernetes would inject its own Service DNS name.
ENV NUCLEUS_API_UPSTREAM=api:5101 \
    NUCLEUS_DNS_RESOLVER=127.0.0.11
COPY nginx.conf /etc/nginx/templates/default.conf.template

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -qO- http://localhost/ >/dev/null || exit 1
