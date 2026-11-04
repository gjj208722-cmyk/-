FROM node:22-alpine
WORKDIR /app
COPY . .
EXPOSE 4173
CMD ["node", "server.mjs"]
