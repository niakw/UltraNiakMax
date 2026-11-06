FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .
RUN mkdir -p /app/data /app/images/quick \
    && chown -R node:node /app

USER node
EXPOSE 7000
CMD ["node", "index.js"]
