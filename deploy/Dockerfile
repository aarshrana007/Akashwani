FROM node:22-alpine
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY backend/ ./
ENV NODE_ENV=production PORT=4000 DB_FILE=/data/data.db RECORDINGS_DIR=/data/recordings FILES_DIR=/data/files
EXPOSE 4000
CMD ["node", "server.js"]
