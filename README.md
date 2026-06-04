<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1tlRidWHl7-sCtwPqxSOcLYLYCgfsU_bd

## Run Locally (Mac host)

**Prerequisites:** Node.js 18+ (ships with global `fetch`).

1. Install dependencies: `npm install`
2. Copy `.env.example` → `.env.local` and fill in:
   - `SHOPIFY_STORE_DOMAIN` (e.g. `holidayprint.myshopify.com`)
   - Optional `SHOPIFY_STOREFRONT_TOKEN` (required only when you want the app to create Shopify carts or query tags via GraphQL)
   - Optional `HOST=0.0.0.0` so other devices can hit your Mac’s IP.
3. To re-enable the Shopify cart or tag lookup flows, also add the following Vite flags to `.env.local` and set them to `true`:
   - `VITE_ENABLE_SHOPIFY_CART`
   - `VITE_ENABLE_SHOPIFY_TAG_LOOKUP`
   Leave them unset/false to stay in token-free mode.
4. Build the production bundle: `npm run build`
5. Serve it with the Express layer: `npm run start`
6. Visit `http://localhost:3000` or `http://<YOUR_MAC_IP>:3000` from Shopify/theme previews.

### Token-free mode (default)

- Leave the Storefront token and Vite flags unset to run in “manual handoff” mode. Guests can still customize cards, download proofs, and send the reference to your print team—no Shopify app privileges required.
- Without the token/flags the Express layer automatically disables `/api/shopify-products-by-tags` and `/cart/add.js`, so Cloudways never attempts Storefront API calls it cannot authenticate.
- When you later gain Storefront API access, add the token plus flip both Vite flags to `true`, rebuild, and the cart + tag lookup flows reactivate automatically.

### Provide handles instead of tags

- Tags are optional. Point the Vault CTA directly at the app using `?product={{ product.handle }}` or store a handle per layout inside `constants.ts`. The designer will call the public `/products/<handle>.js` endpoint to pull variants.
- If you eventually enable tag lookup, keep the CTA as-is; the designer will fall back to tags only when the feature flag is on.

With the Shopify features enabled, the Express server proxies both `GET /products/:handle.js` and `POST /cart/add.js` to Shopify. When disabled, only the public product endpoint stays active and the checkout step becomes a manual approval + email workflow.

## Deploy on Cloudways (PM2)

1. `npm run bootstrap`
   - Runs the full clean + install sequence so `vite` (and every other CLI) exists before you build.
2. `npm run build` (produces `dist/`)
3. `pm2 start ecosystem.config.cjs` (note the `.cjs` extension—`pm2 start ecosystem.config.js` will fail)
4. Tail logs with `pm2 logs card-app` and test `https://cardify.holidayprint.com`
5. Confirm the health check: `curl https://cardify.holidayprint.com/healthz`

> `clean:modules` completely removes `node_modules`.
> `npm start` now bootstraps `server.js` and will exit early if `dist/index.html` is missing—watch PM2 logs for that guard message.

## Verify the app is live
```bash
pm2 status card-app          # should show online + uptime
curl http://127.0.0.1:3000/  # confirm the Node layer responds
curl -I https://cardify.holidayprint.com/  # confirm Apache is proxying through
```

## Troubleshoot Apache 500 errors (Cloudways)

1. Tail Apache’s error log to see why the proxy failed:
   ```bash
   tail -n 100 /home/1316548.cloudwaysapps.com/jfkaeqbfmn/logs/apache_error.log
   ```
2. Confirm the Node app is healthy (already works via PM2):
   ```bash
   curl -I http://127.0.0.1:3000/ && curl -I http://127.0.0.1:3000/healthz
   ```
3. Compare the public proxy response:
   ```bash
   curl -I https://cardify.holidayprint.com/
   ```
4. Ensure the `.htaccess` proxy file still matches the repo version (Cloudways disallows `ProxyPassReverse` inside `.htaccess`, so keep only the rewrite block):
   ```bash
   ls -alh /home/1316548.cloudwaysapps.com/jfkaeqbfmn/public_html/.htaccess
   cat   /home/1316548.cloudwaysapps.com/jfkaeqbfmn/public_html/.htaccess
   ```
5. If Apache reports “proxy module disabled,” open a Cloudways ticket to re-enable `mod_proxy` for the application (the Node process is already healthy per step 2).

## MIME error: “Expected a JavaScript module”
If you see `index.tsx` in the browser console, Apache is serving the source HTML. Run:
```bash
npm run build
```
Then ensure the updated `.htaccess` (in this repo) is deployed so Apache serves `dist/index.html` and `dist/assets/*`.

## Shopify tag-triggered CTA

Add this to your Vault theme’s product template (e.g., `main-product.liquid`). When a product carries the tag `card-designer`, customers see a button that deep-links into the standalone app. If you can’t use tags, drop the `{% if %}` guard and render the button wherever you need it—the crucial part is passing `?product={{ product.handle }}` so the designer knows which public JSON endpoint to call.

```liquid
{% if product.tags contains 'card-designer' %}
  <div class="cardify-entry">
      <a class="btn btn--primary" href="https://bcard-creator.onrender.com?product={{ product.handle }}">
         Customize Business Cards
      </a>
  </div>
{% endif %}
```

That URL points directly at the live Render deployment. Locksmith can continue to gate the tagged products the same way because the app entry still lives on the protected product page.
