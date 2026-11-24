# A TravStats suggestion plugin: node:alpine, no dependencies, non-root, read-only.
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY data ./data
USER node
ENV PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q -O /dev/null http://127.0.0.1:8080/health || exit 1
CMD ["node", "src/server.js"]
