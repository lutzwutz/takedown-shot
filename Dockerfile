# Playwright base image ships Chromium + all OS deps.
FROM mcr.microsoft.com/playwright:v1.48.0-noble
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "server.js"]
