FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY scripts/daily.js ./scripts/daily.js
COPY config ./config
CMD ["npm", "start"]
