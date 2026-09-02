FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/protocol/package.json packages/protocol/package.json
COPY services/gateway/package.json services/gateway/package.json
RUN npm ci --ignore-scripts --workspace @nova-chat/protocol --workspace @nova-chat/gateway --include-workspace-root
COPY packages/protocol packages/protocol
COPY services/gateway services/gateway
RUN npm run build -w @nova-chat/protocol && npm run build -w @nova-chat/gateway

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/protocol/package.json packages/protocol/package.json
COPY services/gateway/package.json services/gateway/package.json
RUN npm ci --omit=dev --ignore-scripts --workspace @nova-chat/protocol --workspace @nova-chat/gateway --include-workspace-root
COPY --from=build /app/packages/protocol/dist packages/protocol/dist
COPY --from=build /app/services/gateway/dist services/gateway/dist
RUN mkdir -p /app/data && chown -R node:node /app/data
VOLUME ["/app/data"]
USER node
EXPOSE 8787
CMD ["node", "services/gateway/dist/index.js"]

