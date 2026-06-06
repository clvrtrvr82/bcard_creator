App Instructions for CoPilot AI

I want you to examine all files in the open directory and look for any errors in the code and/or duplicated code and/or code that might conflict with other code within the app.

The overall functionality is what I want but cant seem to get it to function on my Cloudways VPS.

This app runs by its self and I want it to integrate with my shopify website that uses the latest shopify technology and the theme it uses is Vault. I do use locksmith so keep that in mind as I can't have that messed up.

My shopify website supplies branded hotels with various printed products that they require. OI use locksmith because branded material cant be seen by the public.

Currently everytime I run it on my CLoudways VPS it throws errors. Things to keep in mind for my cloudways vps;
- no sudo access
- I will upload any modified files and run commands through SSH.
- I use PM2 to run the app.
- I need detailed steps on making sure I am operating it correctly.


I will add any more information to this file as needed.

## Next steps for analysis
- Share the complete `/Users/trevorharding/bcard` tree (code, configs, env samples) so errors, duplication, and conflicts can be reviewed holistically.
- Include any PM2 ecosystem files, `.env` templates, and Shopify/Vault integration points (including Locksmith config fragments) that influence runtime behavior.

1. `cd /applications/jfkaeqbfmn/public_html && npm run bootstrap` (this runs the clean + install combo in one shot—skipping it leaves you without `node_modules`, causing `vite: not found`).
2. Confirm `.env` mirrors Shopify/Locksmith credentials while keeping secrets private.
3. Run `npm run build` to refresh `/dist`, then launch via `pm2 start ecosystem.config.cjs` (the `.cjs` extension is required) and inspect `pm2 logs card-app` for stack traces to relay back here. Ensure the uploaded bundle includes both `server.js` and `/scripts/ensure-build.mjs`.
4. After changes, hit your deployed app domain to validate Shopify endpoints and confirm Locksmith-protected sections behave as expected.
5. If Apache still returns 500 while `curl http://127.0.0.1:3000/healthz` is OK:
   - `tail -n 100 /home/1316548.cloudwaysapps.com/jfkaeqbfmn/logs/apache_error.log`
   - `curl -I https://<your-app-domain>/` and compare with `curl -I http://127.0.0.1:3000/`
   - Verify `/home/1316548.cloudwaysapps.com/jfkaeqbfmn/public_html/.htaccess` matches the repo (no `ProxyPassReverse`—Apache blocks it in this context).
   - Escalate to Cloudways if the log mentions missing `mod_proxy`, since that must be enabled at the platform level.
6. To confirm the service is ## Cloudways + PM2 checklist
actually running: `pm2 status card-app`, `curl http://127.0.0.1:3000/`, and `curl -I https://<your-app-domain>/`.
7. If the browser shows `index.tsx` MIME errors, rebuild and verify Apache serves `/dist`:
   - `npm run build`
   - Deploy the repo’s `.htaccess` so it routes `/` to `dist/index.html` and `/assets/*` to `dist/assets/*`.

## Shopify trigger integration
- Tag each Shopify product with the layout-specific tag that should unlock it in the designer.
- Embed the Liquid snippet from the README into `main-product.liquid` so tagged products deep-link to your current host (use `http://<your-mac-ip>:3000` while developing locally, then switch back to the production domain).
- Keep Locksmith rules aligned so only authenticated partners see tagged products and the CTA.
- Tag assignment still happens in Shopify Admin—the designer UI cannot write Shopify product tags, so keep adding/removing the exact layout-specific tags directly on each product before deploying theme changes.

## Local Mac hosting fallback
- Copy `.env.example` to `.env.local` and set `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_STOREFRONT_TOKEN`, and optional `HOST=0.0.0.0`.
- Run `npm install && npm run build && npm run start` on your MacBook Pro; the Express server now proxies Shopify product data and creates carts via the Storefront API.
- Point the Vault theme CTA to `http://<your-mac-ip>:3000?product={{ product.handle }}` so partners can reach the designer while you’re off Cloudways.
- When a guest approves a card, the server returns `checkoutUrl` from Shopify—clients are redirected straight to Shopify Checkout even though the designer is running locally.