# Zen Do

Minimalist TODO app built with React + Vite, prepared for Cloudflare Workers deployment.

## PWA support

- Web app manifest: [`public/manifest.webmanifest`](./public/manifest.webmanifest)
- Service worker (offline shell + asset caching): [`public/sw.js`](./public/sw.js)
- Install icons: [`public/icon-192.svg`](./public/icon-192.svg), [`public/icon-512.svg`](./public/icon-512.svg)

## Run locally

**Prerequisites:** Node.js


1. Install dependencies:
   `npm install`
2. Run the app:
   `npm run dev`

## Deploy to Cloudflare Workers

1. Install dependencies:
   `npm install`
2. Authenticate with Cloudflare:
   `npx wrangler login`
3. Configure deployment targets in [wrangler.jsonc](./wrangler.jsonc):
   - `env.staging`: preview/staging Worker (`workers_dev: true`)
   - `env.production`: production Worker (`workers_dev: false`; ensure your route/domain is configured in Cloudflare)
4. Deploy to staging:
   `npm run deploy:staging`
5. Deploy to production:
   `npm run deploy:production`

### Useful commands

- Local Worker preview:
  `npm run cf:dev`
- Local Worker preview (staging config):
  `npm run cf:dev:staging`
- Production deploy:
  `npm run deploy:production`
