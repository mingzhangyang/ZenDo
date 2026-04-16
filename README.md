<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

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
3. Set your Worker name in [wrangler.jsonc](./wrangler.jsonc) (`name` field)
4. Deploy:
   `npm run deploy`

### Useful commands

- Local Worker preview:
  `npm run cf:dev`
- Production deploy:
  `npm run deploy`
