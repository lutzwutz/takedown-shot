FROM node:20
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npx playwright install --with-deps chromium
ENV NODE_ENV=production
CMD ["node", "server.js"]
