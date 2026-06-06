(function () {
  const APP_BASE_URL = 'https://bcard-creator.onrender.com';
  const fallbackLayouts = [
    { shopifyTags: ['holiday-inn-card', 'hi-green-field'] },
    { shopifyTags: ['holiday-inn-express-card', 'hie-impact'] }
  ];

  function normalizeTag(tag) {
    return String(tag || '').trim().toLowerCase();
  }

  function getMatchedTags(layouts, productTags) {
    const matchedTags = [];
    const seen = new Set();

    layouts.forEach((layout) => {
      const layoutTags = Array.isArray(layout && layout.shopifyTags) ? layout.shopifyTags : [];
      layoutTags.forEach((tag) => {
        const normalized = normalizeTag(tag);
        if (!normalized || !productTags.includes(normalized) || seen.has(normalized)) {
          return;
        }

        seen.add(normalized);
        matchedTags.push(normalized);
      });
    });

    return matchedTags;
  }

  function renderButton(mount, productHandle, matchedTags) {
    if (!matchedTags.length) return;

    const params = new URLSearchParams();
    params.set('product', productHandle);
    matchedTags.forEach((tag) => params.append('tags', tag));

    mount.innerHTML = [
      '<a href="' + APP_BASE_URL + '/?' + params.toString() + '"',
      'style="display:inline-block;padding:12px 18px;background:#111827;color:#ffffff;text-decoration:none;border-radius:10px;font-weight:600;"',
      '>',
      'Customize Business Cards',
      '</a>'
    ].join(' ');
  }

  function getShopOrigin() {
    if (typeof window === 'undefined' || !window.location || !window.location.origin) {
      return '';
    }

    return window.location.origin;
  }

  async function loadLayouts() {
    try {
      const response = await fetch(APP_BASE_URL + '/layout-index.json?source=shopify-cta-script', {
        cache: 'no-store',
        mode: 'cors',
        credentials: 'omit'
      });
      if (!response.ok) throw new Error('Unable to load designer layout index.');

      const payload = await response.json();
      const layouts = Array.isArray(payload && payload.layouts) ? payload.layouts : [];
      return layouts.length ? layouts : fallbackLayouts;
    } catch (error) {
      console.error('Designer CTA manifest fallback:', error);
      return fallbackLayouts;
    }
  }

  async function loadProductTags(productHandle) {
    try {
      const shopOrigin = getShopOrigin();
      if (!shopOrigin) throw new Error('Missing storefront origin.');

      const response = await fetch(shopOrigin + '/products/' + encodeURIComponent(productHandle) + '.js', {
        cache: 'no-store',
        credentials: 'same-origin'
      });
      if (!response.ok) throw new Error('Unable to load Shopify product tags.');

      const payload = await response.json();
      return String(payload && payload.tags ? payload.tags : '')
        .split(',')
        .map(normalizeTag)
        .filter(Boolean);
    } catch (error) {
      console.error('Designer CTA product tag lookup failed:', error);
      return [];
    }
  }

  async function initDesignerShopifyCTA() {
    const mounts = Array.from(document.querySelectorAll('[data-designer-product-handle]'));
    if (!mounts.length) return;

    const layouts = await loadLayouts();

    await Promise.all(mounts.map(async (mount) => {
      if (mount.getAttribute('data-designer-rendered') === 'true') {
        return;
      }

      const productHandle = mount.getAttribute('data-designer-product-handle') || '';
      if (!productHandle) {
        return;
      }

      const productTags = await loadProductTags(productHandle);
      if (!productTags.length) {
        return;
      }

      const matchedTags = getMatchedTags(layouts, productTags);
      if (!matchedTags.length) {
        return;
      }

      renderButton(mount, productHandle, matchedTags);
      mount.setAttribute('data-designer-rendered', 'true');
    }));
  }

  window.DesignerShopifyCTA = {
    init: initDesignerShopifyCTA
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDesignerShopifyCTA, { once: true });
  } else {
    initDesignerShopifyCTA();
  }
})();