FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY shared ./shared
COPY client ./client
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server/index.js"]
