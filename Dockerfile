FROM node:16-bullseye
WORKDIR /app
COPY . /app
RUN chown -R node /app
USER node
RUN npm install
RUN npm run build
ENV NODE_ENV=production
VOLUME ["/app/db", "/app/config"]
EXPOSE 8184
CMD node index.js
