<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Theme Vault Designer

Business-card designer for branded hotel products. Customers enter card details, preview the approved layout, download proofs, and optionally continue into Shopify checkout with the selected card quantity variant.

## What this repo does

- Serves a React/Vite card designer and admin dashboard.
- Generates a public layout manifest from `constants.ts` during build.
- Exposes Shopify helper routes through the Express server:
  - `GET /products/:handle.js`
  - `GET /api/shopify-products`
  - `GET /api/shopify-products-by-tags`
  - `POST /cart/add.js`
- Stores admin-saved layouts separately from the static seed layouts.
- Stores approved proof PDFs on the server and can email them when SMTP is configured.

## Requirements

- Node.js 18+
- npm
- Shopify store domain for product lookup
- Optional Shopify Storefront API token for cart checkout
- Optional Shopify Admin API token for Locksmith-protected product lookup

## Available scripts

The current repo exposes only these npm scripts:

- `npm run build`
- `npm start`

There is no active `bootstrap` script in the current `package.json`.

## Local run

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env.local`.
3. Set the environment values you need:
   - `SHOPIFY_STORE_DOMAIN`
   - Optional `SHOPIFY_STOREFRONT_TOKEN`
   - Optional `SHOPIFY_ADMIN_ACCESS_TOKEN`
   - Optional `SHOPIFY_API_VERSION`
   - Optional `HOST`
   - Optional `PORT`
   - Optional SMTP values for proof email:
     - `SMTP_HOST`
     - `SMTP_PORT`
     - `SMTP_SECURE`
     - `SMTP_USER`
     - `SMTP_PASS`
     - `SMTP_FROM_EMAIL`
     - `PROOF_NOTIFICATION_EMAIL`
4. If you want the browser UI to enable the live Shopify flows, also add these Vite flags to `.env.local`:
   ```bash
   VITE_ENABLE_SHOPIFY_CART=true
   VITE_ENABLE_SHOPIFY_TAG_LOOKUP=true
   ```
5. Build the app:
   ```bash
   npm run build
   ```
6. Start the Express server:
   ```bash
   npm start
   ```
7. Open `http://localhost:3000`.

## Feature switches

### Product lookup

- `GET /products/:handle.js` works when `SHOPIFY_STORE_DOMAIN` is configured.
- If `SHOPIFY_ADMIN_ACCESS_TOKEN` is present, the server tries Shopify Admin first and falls back to storefront product JSON when needed.

### Tag lookup

- The server route `/api/shopify-products-by-tags` is available when `SHOPIFY_STORE_DOMAIN` is set.
- The React app only uses the tag lookup flow when `VITE_ENABLE_SHOPIFY_TAG_LOOKUP=true`.

### Cart checkout

- The checkout step requires both:
  - `SHOPIFY_STOREFRONT_TOKEN`
  - `VITE_ENABLE_SHOPIFY_CART=true`
- Without them, the app stays in manual proof / handoff mode.

### Proof email

- `POST /api/proofs` always stores the PDF in `proofs/`.
- Email delivery happens only when SMTP settings are configured.

## Build outputs and saved data

- `npm run build` runs `node ./scripts/build-layout-index.mjs && vite build`.
- `scripts/build-layout-index.mjs` reads `constants.ts` and writes `public/layout-index.json`.
- Vite then copies that file into `dist/` for production serving.
- Admin-saved layouts are stored separately in `data/brand-configs.json` through `PUT /api/layouts`.
- The public CTA manifest merges build-time layouts with saved server layouts at runtime.

## Deploy with PM2

This repo is configured to run with:

```bash
pm2 start ecosystem.config.cjs
```

Recommended deploy sequence:

1. `npm install`
2. `npm run build`
3. `pm2 start ecosystem.config.cjs`
4. `pm2 logs card-app`

Useful checks:

```bash
pm2 status card-app
curl http://127.0.0.1:3000/
curl http://127.0.0.1:3000/healthz
```

If the server exits immediately, the first thing to verify is that `dist/index.html` exists. `server.js` will refuse to start without a built bundle.

## Apache / Cloudways note

This repo includes `.htaccess` for serving the built app from `dist/`. If Apache serves source files or returns a module MIME error, rebuild and redeploy the updated `dist/` output plus `.htaccess`.

## Shopify CTA

The hosted CTA script is served from:

```text
/designer-shopify-cta.js
```

The current script in `public/designer-shopify-cta.js` is hardcoded to use:

```text
https://bcard-creator.onrender.com
```

If you want the Shopify product-page button to point at a different host, update that constant before deploying.

Add this mount to Shopify product templates that should show the CTA:

```liquid
<div
   id="designer-entry-{{ product.id }}"
   data-designer-product-handle="{{ product.handle | escape }}"
   data-designer-product-tags="{{ product.tags | join: ',' | escape }}"
></div>

<script src="https://bcard-creator.onrender.com/designer-shopify-cta.js" defer></script>
```

The CTA script:

- loads the layout manifest
- compares product tags and optional product-handle matches
- links into the app with `product`, `tags`, `layoutId`, and `returnTo`
- allows the user to choose Shopify variants for quantity when available

## Return flow

- The app preserves the originating Shopify product URL through `returnTo`.
- In cart-enabled mode, the user is redirected to Shopify checkout.
- In manual mode, the app stores the proof and supports the approval / handoff workflow without Shopify checkout.

## Reset saved layouts

Clear the saved server-side admin layouts with:

```bash
curl -X DELETE https://bcard-creator.onrender.com/api/layouts
```

Deleting `data/brand-configs.json` has the same effect if you have shell access.
