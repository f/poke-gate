FROM node:20-slim

WORKDIR /app

COPY . .

RUN npm install -g .

LABEL org.opencontainers.image.source="https://github.com/f/poke-gate"
LABEL org.opencontainers.image.description="Expose your machine to your Poke AI assistant via MCP tunnel"
LABEL org.opencontainers.image.licenses="MIT"

ENTRYPOINT ["poke-gate"]
