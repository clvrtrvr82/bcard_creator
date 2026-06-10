import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

['.env.local', '.env'].forEach((envFile) => {
  const fullPath = path.join(__dirname, envFile);
  if (fs.existsSync(fullPath)) {
    dotenv.config({ path: fullPath, override: false });
  }
});

const HOST = process.env.HOST ?? '0.0.0.0';
const PORT = Number(process.env.PORT ?? process.env.APP_PORT ?? 3000);
const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION ?? '2024-01';
const SHOPIFY_STOREFRONT_TOKEN = process.env.SHOPIFY_STOREFRONT_TOKEN;
const SHOPIFY_ADMIN_ACCESS_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT ?? 587);
const SMTP_SECURE = String(process.env.SMTP_SECURE ?? '').toLowerCase() === 'true' || SMTP_PORT === 465;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM_EMAIL = process.env.SMTP_FROM_EMAIL ?? process.env.SMTP_USER ?? 'no-reply@example.com';
const PROOF_NOTIFICATION_EMAIL = process.env.PROOF_NOTIFICATION_EMAIL ?? '';
const normalizedShopDomain = SHOPIFY_STORE_DOMAIN?.replace(/^https?:\/\//i, '').replace(/\/+$/, '') || null;
const SHOPIFY_BASE_URL = normalizedShopDomain ? `https://${normalizedShopDomain}` : null;
const SHOPIFY_GRAPHQL_URL = SHOPIFY_BASE_URL ? `${SHOPIFY_BASE_URL}/api/${SHOPIFY_API_VERSION}/graphql.json` : null;
const SHOPIFY_ADMIN_GRAPHQL_URL = SHOPIFY_BASE_URL ? `${SHOPIFY_BASE_URL}/admin/api/${SHOPIFY_API_VERSION}/graphql.json` : null;
const SHOPIFY_CART_ENABLED = Boolean(SHOPIFY_GRAPHQL_URL && SHOPIFY_STOREFRONT_TOKEN);
const SHOPIFY_TAG_LOOKUP_ENABLED = Boolean(SHOPIFY_BASE_URL);
const PROOF_EMAIL_ENABLED = Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);
const distDir = path.resolve(__dirname, 'dist');
const publicDir = path.resolve(__dirname, 'public');
const dataDir = path.resolve(__dirname, 'data');
const layoutsFile = path.join(dataDir, 'brand-configs.json');
const builtLayoutIndexFile = path.join(distDir, 'layout-index.json');
const sourceLayoutIndexFile = path.join(publicDir, 'layout-index.json');

if (!fs.existsSync(path.join(distDir, 'index.html'))) {
  console.error(`Missing build output at ${path.join(distDir, 'index.html')}. Run "npm run build" before starting the server.`);
  process.exit(1);
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '25mb' }));

const proofsDir = path.join(__dirname, 'proofs');
if (!fs.existsSync(proofsDir)) {
  fs.mkdirSync(proofsDir, { recursive: true });
}
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const readJsonFile = (filePath) => {
  if (!fs.existsSync(filePath)) return null;

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    console.error(`Unable to parse JSON from ${filePath}`, error);
    return null;
  }
};

const proofMailer = PROOF_EMAIL_ENABLED
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS
      }
    })
  : null;

const formatProofSummary = ({ layoutId, layoutName, productHandle, returnUrl, selectedVariant, cardData }) => {
  const lines = [
    `Layout ID: ${layoutId || ''}`,
    `Layout Name: ${layoutName || ''}`,
    `Product Handle: ${productHandle || ''}`,
    `Shopify Product URL: ${returnUrl || ''}`,
    `Selected Variant: ${selectedVariant?.title || ''}`,
    `Selected Variant ID: ${selectedVariant?.id || ''}`,
    `Selected Variant Price: ${selectedVariant?.price != null ? `$${(Number(selectedVariant.price) / 100).toFixed(2)}` : ''}`,
    '',
    'Card Data:'
  ];

  if (cardData && typeof cardData === 'object') {
    Object.entries(cardData).forEach(([key, value]) => {
      if (value == null || value === '') return;
      lines.push(`${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
    });
  }

  return lines.join('\n');
};

const sendProofEmail = async ({
  notificationEmail,
  reference,
  filePath,
  layoutId,
  layoutName,
  productHandle,
  returnUrl,
  selectedVariant,
  cardData
}) => {
  if (!proofMailer) {
    return { emailed: false, reason: 'Proof email disabled.' };
  }

  const to = String(notificationEmail || PROOF_NOTIFICATION_EMAIL || '').trim();
  if (!to) {
    return { emailed: false, reason: 'No proof notification email configured.' };
  }

  await proofMailer.sendMail({
    from: SMTP_FROM_EMAIL,
    to,
    subject: `New print-ready proof ${reference}`,
    text: formatProofSummary({ layoutId, layoutName, productHandle, returnUrl, selectedVariant, cardData }),
    attachments: [
      {
        filename: reference,
        path: filePath,
        contentType: 'application/pdf'
      }
    ]
  });

  return { emailed: true, to };
};

const readStoredBrandConfigs = () => {
  const payload = readJsonFile(layoutsFile);
  if (!payload || typeof payload !== 'object') return null;

  const configs = payload.brandConfigs;
  if (!configs || typeof configs !== 'object' || Array.isArray(configs)) {
    return null;
  }

  return configs;
};

const mapLayoutsForPublicIndex = (brandConfigs) => {
  if (!brandConfigs || typeof brandConfigs !== 'object' || Array.isArray(brandConfigs)) {
    return [];
  }

  return Object.entries(brandConfigs).flatMap(([brandKey, config]) => {
    const layouts = Array.isArray(config?.layouts) ? config.layouts : [];
    return layouts.map((layout) => ({
      id: layout?.id,
      name: layout?.name,
      brand: layout?.brand ?? brandKey,
      shopifyTags: Array.isArray(layout?.shopifyTags) ? layout.shopifyTags : [],
      shopifyProductHandle: typeof layout?.shopifyProductHandle === 'string' ? layout.shopifyProductHandle : ''
    })).filter((layout) => layout.id && layout.name);
  });
};

const readStaticLayoutIndex = () => {
  const payload = readJsonFile(builtLayoutIndexFile) ?? readJsonFile(sourceLayoutIndexFile);
  const staticLayouts = Array.isArray(payload?.layouts) ? payload.layouts : [];
  const storedLayouts = mapLayoutsForPublicIndex(readStoredBrandConfigs());
  const mergedLayouts = new Map();

  staticLayouts.forEach((layout) => {
    if (layout?.id) {
      mergedLayouts.set(layout.id, layout);
    }
  });

  storedLayouts.forEach((layout) => {
    mergedLayouts.set(layout.id, layout);
  });

  return {
    updatedAt: new Date().toISOString(),
    layoutCount: mergedLayouts.size,
    layouts: Array.from(mergedLayouts.values())
  };
};

app.use((_, res, next) => {
  res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate');
  next();
});

app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.sendStatus(204);
  }

  if (req.method === 'GET' && (req.path === '/layout-index.json' || req.path.startsWith('/products/'))) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }

  return next();
});

const withShopifyConfig = (needsToken = false) => {
  if (!SHOPIFY_BASE_URL) {
    return { ok: false, message: 'Set SHOPIFY_STORE_DOMAIN in .env.local to enable Shopify proxy routes.' };
  }
  if (needsToken && !SHOPIFY_STOREFRONT_TOKEN) {
    return { ok: false, message: 'Set SHOPIFY_STOREFRONT_TOKEN to enable Shopify cart integration.' };
  }
  return { ok: true };
};

const mapProductVariants = (variants) => {
  const list = Array.isArray(variants) ? variants : [];
  return list
    .map((variant) => {
      const numericId = Number(variant?.id ?? 0);
      const rawPrice = typeof variant?.price === 'string' ? Number.parseFloat(variant.price) : Number(variant?.price ?? 0);
      return {
        id: Number.isFinite(numericId) ? numericId : 0,
        title: String(variant?.title || ''),
        price: Number.isFinite(rawPrice) ? Math.round(rawPrice * 100) : 0,
        available: Boolean(variant?.available)
      };
    })
    .filter((variant) => variant.id);
};

const mapAdminProduct = (product) => {
  const variants = Array.isArray(product?.variants?.edges)
    ? product.variants.edges.map((edge) => edge?.node).filter(Boolean)
    : [];

  return {
    title: String(product?.title || ''),
    handle: String(product?.handle || ''),
    tags: Array.isArray(product?.tags) ? product.tags.join(', ') : '',
    variants: mapProductVariants(variants.map((variant) => ({
      id: String(variant?.legacyResourceId || '').trim(),
      title: variant?.title,
      price: variant?.price,
      available: variant?.inventoryQuantity == null ? true : variant.inventoryQuantity > 0
    })))
  };
};

const mapProductSummary = (product) => ({
  title: String(product?.title || ''),
  handle: String(product?.handle || ''),
  tags: Array.isArray(product?.tags)
    ? product.tags.map((tag) => String(tag || '').trim()).filter(Boolean)
    : String(product?.tags || '')
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean)
});

const fetchShopifyAdminGraphQL = async (query, variables = {}) => {
  if (!SHOPIFY_ADMIN_GRAPHQL_URL || !SHOPIFY_ADMIN_ACCESS_TOKEN) {
    throw new Error('Shopify Admin API not configured.');
  }

  const upstream = await fetch(SHOPIFY_ADMIN_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Shopify-Access-Token': SHOPIFY_ADMIN_ACCESS_TOKEN
    },
    body: JSON.stringify({ query, variables })
  });

  const payload = await upstream.json();
  if (!upstream.ok || payload?.errors?.length) {
    const detail = payload?.errors?.length ? payload.errors : payload;
    throw new Error(`Shopify Admin GraphQL failed: ${JSON.stringify(detail)}`);
  }

  return payload?.data ?? null;
};

const fetchAdminProductByHandle = async (handle) => {
  const query = `query AdminProductByHandle($query: String!) {
    products(first: 1, query: $query) {
      edges {
        node {
          title
          handle
          tags
          variants(first: 100) {
            edges {
              node {
                legacyResourceId
                title
                price
                inventoryQuantity
              }
            }
          }
        }
      }
    }
  }`;

  const data = await fetchShopifyAdminGraphQL(query, { query: `handle:${handle}` });
  const product = data?.products?.edges?.[0]?.node;
  return product ? mapAdminProduct(product) : null;
};

const fetchAdminProductsByTags = async (tags) => {
  const query = `query AdminProductsByTags($query: String!) {
    products(first: 10, query: $query) {
      edges {
        node {
          title
          handle
          tags
          variants(first: 100) {
            edges {
              node {
                legacyResourceId
                title
                price
                inventoryQuantity
              }
            }
          }
        }
      }
    }
  }`;

  const search = tags.map((tag) => `tag:${JSON.stringify(tag)}`).join(' AND ');
  const data = await fetchShopifyAdminGraphQL(query, { query: search });
  return Array.isArray(data?.products?.edges)
    ? data.products.edges.map((edge) => mapAdminProduct(edge?.node)).filter((product) => product?.handle)
    : [];
};

const fetchAdminProducts = async ({ query = '', limit = 50, cursor = null } = {}) => {
  const normalizedLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const graphql = `query AdminProductsList($first: Int!, $query: String!, $after: String) {
    products(first: $first, after: $after, query: $query, sortKey: TITLE) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          title
          handle
          tags
        }
      }
    }
  }`;

  const data = await fetchShopifyAdminGraphQL(graphql, {
    first: normalizedLimit,
    query: String(query || '').trim(),
    after: cursor || null
  });
  const products = Array.isArray(data?.products?.edges)
    ? data.products.edges.map((edge) => mapProductSummary(edge?.node)).filter((product) => product.handle)
    : [];

  return {
    products,
    hasNextPage: Boolean(data?.products?.pageInfo?.hasNextPage),
    nextCursor: data?.products?.pageInfo?.endCursor || null
  };
};

app.get('/api/shopify-capabilities', (_req, res) => {
  return res.json({
    productProxyEnabled: Boolean(SHOPIFY_BASE_URL),
    tagLookupEnabled: SHOPIFY_TAG_LOOKUP_ENABLED,
    cartEnabled: SHOPIFY_CART_ENABLED
  });
});

app.get('/api/shopify-products', async (req, res) => {
  const check = withShopifyConfig(false);
  if (!check.ok || !SHOPIFY_BASE_URL) {
    return res.status(501).json({ message: check.message });
  }

  const query = String(req.query.query || '').trim();
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  const cursor = String(req.query.cursor || '').trim() || null;

  try {
    if (SHOPIFY_ADMIN_ACCESS_TOKEN) {
      try {
        const payload = await fetchAdminProducts({ query, limit, cursor });
        return res.json(payload);
      } catch (error) {
        console.error('Shopify Admin product list lookup failed', error);
        console.warn('Falling back to storefront product list lookup.');
      }
    }

    const upstream = await fetch(`${SHOPIFY_BASE_URL}/products.json?limit=250`, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'theme-vault-proxy'
      }
    });

    if (!upstream.ok) {
      const detail = await upstream.text();
      console.error('Shopify product list lookup failed', detail);
      return res.status(upstream.status).json({ message: 'Unable to query Shopify products.', detail });
    }

    const payload = await upstream.json();
    const products = Array.isArray(payload?.products) ? payload.products : [];
    const normalizedQuery = query.toLowerCase();
    const filtered = products
      .map((product) => mapProductSummary(product))
      .filter((product) => {
        if (!normalizedQuery) return true;
        return product.title.toLowerCase().includes(normalizedQuery)
          || product.handle.toLowerCase().includes(normalizedQuery)
          || product.tags.some((tag) => tag.toLowerCase().includes(normalizedQuery));
      });
    const offset = Math.max(Number.parseInt(cursor || '0', 10) || 0, 0);
    const page = filtered.slice(offset, offset + limit);
    const nextOffset = offset + page.length;

    return res.json({
      products: page,
      hasNextPage: nextOffset < filtered.length,
      nextCursor: nextOffset < filtered.length ? String(nextOffset) : null
    });
  } catch (error) {
    console.error('Shopify product list exception', error);
    return res.status(502).json({ message: 'Unable to query Shopify products.' });
  }
});

app.get('/api/layouts', (_req, res) => {
  const brandConfigs = readStoredBrandConfigs();
  if (!brandConfigs) {
    return res.status(404).json({ message: 'No stored layouts found.' });
  }

  return res.json({ brandConfigs });
});

app.put('/api/layouts', (req, res) => {
  const brandConfigs = req.body?.brandConfigs;
  if (!brandConfigs || typeof brandConfigs !== 'object' || Array.isArray(brandConfigs)) {
    return res.status(400).json({ message: 'Provide a brandConfigs object.' });
  }

  try {
    const payload = {
      updatedAt: new Date().toISOString(),
      brandConfigs
    };
    fs.writeFileSync(layoutsFile, JSON.stringify(payload, null, 2));
    return res.json({ ok: true, layoutCount: Object.values(brandConfigs).reduce((total, config) => total + (Array.isArray(config?.layouts) ? config.layouts.length : 0), 0) });
  } catch (error) {
    console.error('Unable to persist layouts file', error);
    return res.status(500).json({ message: 'Unable to persist layouts.' });
  }
});

app.delete('/api/layouts', (_req, res) => {
  try {
    if (fs.existsSync(layoutsFile)) {
      fs.unlinkSync(layoutsFile);
    }

    return res.json({ ok: true, message: 'Stored server layouts cleared.' });
  } catch (error) {
    console.error('Unable to clear layouts file', error);
    return res.status(500).json({ message: 'Unable to clear stored layouts.' });
  }
});

app.get('/layout-index.json', (_req, res) => {
  const payload = readStaticLayoutIndex();
  res.setHeader('Content-Type', 'application/json; charset=UTF-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  return res.send(JSON.stringify(payload));
});

app.get('/products/:handle.js', async (req, res) => {
  const check = withShopifyConfig(false);
  if (!check.ok || !SHOPIFY_BASE_URL) {
    return res.status(501).json({ message: check.message });
  }
  const handle = req.params.handle;
  if (SHOPIFY_ADMIN_ACCESS_TOKEN) {
    try {
      const product = await fetchAdminProductByHandle(handle);
      if (product) {
        res.setHeader('Content-Type', 'application/json; charset=UTF-8');
        return res.json(product);
      }

      console.warn(`Shopify Admin product lookup returned no match for handle "${handle}". Falling back to storefront product JSON.`);
    } catch (error) {
      console.error('Shopify Admin product lookup failed', error);
      console.warn(`Falling back to storefront product JSON for handle "${handle}".`);
    }
  }

  const targetUrl = `${SHOPIFY_BASE_URL}/products/${encodeURIComponent(handle)}.js`;
  try {
    const upstream = await fetch(targetUrl, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'theme-vault-proxy'
      }
    });
    const body = await upstream.text();
    const contentType = upstream.headers.get('content-type') || 'application/json';
    res.status(upstream.status);
    res.setHeader('Content-Type', contentType);
    return res.send(body);
  } catch (error) {
    console.error('Shopify product proxy failed', error);
    return res.status(502).json({ message: 'Unable to reach Shopify product endpoint.' });
  }
});

app.get('/api/shopify-products-by-tags', async (req, res) => {
  if (!SHOPIFY_TAG_LOOKUP_ENABLED) {
    return res.status(404).json({ message: 'Shopify tag lookup disabled on this host.' });
  }
  const check = withShopifyConfig(false);
  if (!check.ok || !SHOPIFY_BASE_URL) {
    return res.status(501).json({ message: check.message });
  }
  const tagsParam = String(req.query.tags || '').trim();
  if (!tagsParam) {
    return res.status(400).json({ message: 'Provide one or more Shopify tags.' });
  }
  const tags = tagsParam
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
  if (!tags.length) {
    return res.status(400).json({ message: 'Provide one or more Shopify tags.' });
  }

  try {
    if (SHOPIFY_ADMIN_ACCESS_TOKEN) {
      try {
        const matches = await fetchAdminProductsByTags(tags);
        if (!matches.length) {
          return res.status(404).json({ message: 'No Shopify products matched those tags.' });
        }

        if (matches.length > 1) {
          return res.status(409).json({
            message: 'Multiple Shopify products matched those tags.',
            handles: matches.map((product) => product.handle).filter(Boolean)
          });
        }

        const product = matches[0];
        return res.json({
          handle: product.handle || null,
          title: product.title || '',
          variants: product.variants || []
        });
      } catch (error) {
        console.error('Shopify Admin tag lookup failed', error);
        console.warn('Falling back to storefront tag lookup.');
      }
    }

    const upstream = await fetch(`${SHOPIFY_BASE_URL}/products.json?limit=250`, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'theme-vault-proxy'
      }
    });

    if (!upstream.ok) {
      const detail = await upstream.text();
      console.error('Shopify tag lookup failed', detail);
      return res.status(upstream.status).json({ message: 'Unable to query Shopify products.', detail });
    }

    const payload = await upstream.json();
    const products = Array.isArray(payload?.products) ? payload.products : [];
    const normalizedTags = tags.map((tag) => tag.toLowerCase());
    const matches = products.filter((product) => {
      const productTags = String(product?.tags || '')
        .split(',')
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean);
      return normalizedTags.every((tag) => productTags.includes(tag));
    });

    if (!matches.length) {
      return res.status(404).json({ message: 'No Shopify products matched those tags.' });
    }

    if (matches.length > 1) {
      return res.status(409).json({
        message: 'Multiple Shopify products matched those tags.',
        handles: matches.map((product) => product.handle).filter(Boolean)
      });
    }

    const product = matches[0];
    return res.json({
      handle: product.handle || null,
      title: product.title || '',
      variants: mapProductVariants(product.variants)
    });
  } catch (error) {
    console.error('Shopify tag lookup exception', error);
    return res.status(502).json({ message: 'Unable to query Shopify by tags.' });
  }
});

app.post('/cart/add.js', async (req, res) => {
  if (!SHOPIFY_CART_ENABLED) {
    return res.status(404).json({ message: 'Shopify cart integration is disabled on this host.' });
  }
  const check = withShopifyConfig(true);
  if (!check.ok || !SHOPIFY_GRAPHQL_URL || !SHOPIFY_STOREFRONT_TOKEN) {
    return res.status(501).json({ message: check.message });
  }

  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length) {
    return res.status(400).json({ message: 'Missing Shopify cart items.' });
  }

  const lines = items
    .map((item) => {
      const variantId = Number(item?.id ?? 0);
      if (!variantId) return null;
      const attributes = Object.entries(item?.properties ?? {}).map(([key, value]) => ({
        key: String(key).slice(0, 255),
        value: typeof value === 'string' ? value : JSON.stringify(value)
      }));
      return {
        quantity: Number(item?.quantity ?? 1) || 1,
        merchandiseId: `gid://shopify/ProductVariant/${variantId}`,
        attributes
      };
    })
    .filter(Boolean);

  if (!lines.length) {
    return res.status(400).json({ message: 'Invalid Shopify variant IDs.' });
  }

  const mutation = `mutation CartCreate($input: CartInput!) {
    cartCreate(input: $input) {
      cart { id checkoutUrl }
      userErrors { field message }
    }
  }`;

  try {
    const upstream = await fetch(SHOPIFY_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Shopify-Storefront-Access-Token': SHOPIFY_STOREFRONT_TOKEN
      },
      body: JSON.stringify({ query: mutation, variables: { input: { lines } } })
    });

    const payload = await upstream.json();
    if (!upstream.ok) {
      console.error('Shopify cart API error', payload);
      return res.status(502).json({ message: 'Shopify cart API unreachable.', detail: payload });
    }

    const userErrors = payload?.data?.cartCreate?.userErrors;
    if (userErrors?.length) {
      return res.status(400).json({ message: 'Shopify cart validation failed.', errors: userErrors });
    }

    const cart = payload?.data?.cartCreate?.cart;
    if (!cart?.checkoutUrl) {
      return res.status(502).json({ message: 'Shopify cart response missing checkout URL.', detail: payload });
    }

    return res.json({ checkoutUrl: cart.checkoutUrl, cartId: cart.id });
  } catch (error) {
    console.error('Shopify cart proxy failed', error);
    return res.status(502).json({ message: 'Unable to add items to Shopify cart.' });
  }
});

app.get('/designer-shopify-cta.js', (_req, res) => {
  const filePath = path.join(publicDir, 'designer-shopify-cta.js');
  res.setHeader('Content-Type', 'application/javascript; charset=UTF-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  return res.sendFile(filePath);
});

app.use(
  express.static(distDir, {
    extensions: ['html'],
    maxAge: process.env.NODE_ENV === 'production' ? '1y' : 0
  })
);

app.post('/api/proofs', (req, res) => {
  try {
    const {
      pdfData,
      layoutId,
      layoutName,
      productHandle,
      returnUrl,
      notificationEmail,
      selectedVariant,
      cardData
    } = req.body ?? {};
    if (!pdfData) {
      return res.status(400).json({ message: 'Missing pdfData payload' });
    }
    const reference = `proof-${Date.now()}-${layoutId || 'layout'}.pdf`;
    const filePath = path.join(proofsDir, reference);
    const buffer = Buffer.from(pdfData, 'base64');
    fs.writeFileSync(filePath, buffer);

    sendProofEmail({
      notificationEmail,
      reference,
      filePath,
      layoutId,
      layoutName,
      productHandle,
      returnUrl,
      selectedVariant,
      cardData
    }).then((emailResult) => {
      return res.json({ reference, ...emailResult });
    }).catch((error) => {
      console.error('Unable to send proof email', error);
      return res.json({ reference, emailed: false, reason: 'Unable to send proof email.' });
    });
    return;
  } catch (error) {
    console.error('Unable to persist proof pdf', error);
    return res.status(500).json({ message: 'Unable to store proof PDF' });
  }
});

app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/healthz')) {
    return next();
  }
  return res.sendFile(path.join(distDir, 'index.html'));
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ message: 'Internal server error' });
});

app.listen(PORT, HOST, () => {
  console.log(`Theme Vault Designer listening on http://${HOST}:${PORT}`);
});
