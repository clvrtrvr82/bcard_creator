(function () {
  const APP_BASE_URL = 'https://bcard-creator.onrender.com';
  const fallbackLayouts = [
    { shopifyTags: ['card-designer', 'ihg-card-designer', 'ihg-business-card'] },
    { shopifyTags: ['card-designer', 'holiday-inn-card', 'hi-green-field'] },
    { shopifyTags: ['card-designer', 'holiday-inn-express-card', 'hie-impact'] },
    { shopifyTags: ['card-designer', 'crowne-plaza-card', 'cp-prestige'] },
    { shopifyTags: ['card-designer', 'staybridge-card', 'ss-warmth'] }
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

  async function loadLayouts() {
    try {
      const response = await fetch(APP_BASE_URL + '/layout-index.json?source=shopify-cta-script', {
        cache: 'no-store',
        mode: 'cors',
        credentials: 'omit'
      });
      if (!response.ok) throw new Error('Unable to load Cardify layout index.');

      const payload = await response.json();
      const layouts = Array.isArray(payload && payload.layouts) ? payload.layouts : [];
      return layouts.length ? layouts : fallbackLayouts;
    } catch (error) {
      console.error('Cardify CTA manifest fallback:', error);
      return fallbackLayouts;
    }
  }

  async function loadProductTags(productHandle) {
    try {
      const response = await fetch(APP_BASE_URL + '/products/' + encodeURIComponent(productHandle) + '.js', {
        cache: 'no-store',
        mode: 'cors',
        credentials: 'omit'
      });
      if (!response.ok) throw new Error('Unable to load Shopify product tags.');

      const payload = await response.json();
      return String(payload && payload.tags ? payload.tags : '')
        .split(',')
        .map(normalizeTag)
        .filter(Boolean);
    } catch (error) {
      console.error('Cardify CTA product tag lookup failed:', error);
      return [];
    }
  }

  async function initCardifyShopifyCTA() {
    const mounts = Array.from(document.querySelectorAll('[data-cardify-product-handle]'));
    if (!mounts.length) return;

    const layouts = await loadLayouts();

    await Promise.all(mounts.map(async (mount) => {
      if (mount.getAttribute('data-cardify-rendered') === 'true') {
        return;
      }

      const productHandle = mount.getAttribute('data-cardify-product-handle') || '';
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
      mount.setAttribute('data-cardify-rendered', 'true');
    }));
  }

  window.CardifyShopifyCTA = {
    init: initCardifyShopifyCTA
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCardifyShopifyCTA, { once: true });
  } else {
    initCardifyShopifyCTA();
  }
})();
