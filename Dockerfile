# Marketing-site service (Railway). The explicit Dockerfile bypasses the Railpack
# auto-detect step that failed with "frontend grpc server closed unexpectedly".
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production
CMD ["node", "site-server/index.js"]
