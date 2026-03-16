# ══════════════════════════════════════════════
# ConfigRefine — Multi-stage Docker Build
# Stage 1: Build React/Vite frontend
# Stage 2: Production image (nginx + Python API)
# ══════════════════════════════════════════════

# ── Stage 1: Build frontend ──
FROM node:20-alpine AS frontend-build

WORKDIR /app

# Install dependencies first (layer caching)
COPY package.json package-lock.json ./
RUN npm ci --production=false

# Copy source and build
COPY index.html vite.config.js ./
COPY src/ ./src/
RUN npm run build

# ── Stage 2: Production image ──
FROM python:3.12-slim

# Install nginx
RUN apt-get update && \
    apt-get install -y --no-install-recommends nginx supervisor && \
    rm -rf /var/lib/apt/lists/*

# Python dependencies
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# Copy backend
COPY backend/ /app/backend/
COPY pull_configs.py /app/pull_configs.py

# Copy built frontend from stage 1
COPY --from=frontend-build /app/dist /usr/share/nginx/html

# Nginx config — serves frontend + proxies /api to Python backend
COPY docker/nginx.conf /etc/nginx/sites-available/default

# Supervisor config — runs both nginx and Python API
COPY docker/supervisord.conf /etc/supervisor/conf.d/configrefine.conf

WORKDIR /app

EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost/api/status || exit 1

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/configrefine.conf"]
