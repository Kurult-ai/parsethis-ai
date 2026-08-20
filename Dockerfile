FROM node:22-slim

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY prisma/ ./prisma/
COPY prisma.config.ts ./
RUN npx prisma generate

COPY tsconfig.json ./
COPY content/ ./content/
# tsx runs the TS sources directly in production (Prisma 7 ESM); some source
# files carry host umask 600 from the dev tree and appuser cannot read them —
# normalize permissions for the runtime user before tsc.
COPY src/ ./src/
# Normalize: dev-tree umask leaves some files at 600, and COPY --chmod=644
# would strip the x bit from directories (non-traversable). go+rX = dirs
# get x, files get r, nothing gets executable that shouldn't.
RUN chmod -R go+rX src/ && npx tsc

# Keep tsx for runtime (Prisma 7.x ESM requires TypeScript imports)

RUN addgroup --system appgroup && adduser --system --ingroup appgroup appuser
USER appuser

ENV NODE_ENV=production

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "const port=process.env.PORT||3000; fetch('http://127.0.0.1:'+port+'/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["./node_modules/.bin/tsx", "src/index.ts"]
