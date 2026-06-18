(function () {
  const APP_BASE_URL = 'https://bcard-creator.onrender.com';
  const fallbackLayouts = [
    { shopifyTags: ['holiday-inn-card', 'holiday-inn-v2'] },
    { shopifyTags: ['holiday-inn-card', 'holiday-inn'] },
    { shopifyTags: ['holiday-inn-express-card', 'holiday-inn-express'] }
  ];

  function normalizeTag(tag) {
    return String(tag || '').trim().toLowerCase();
  }

  function normalizeHandle(handle) {
    return String(handle || '').trim().toLowerCase();
  }

  function getMatchedLayouts(layouts, productTags) {
    return layouts.filter((layout) => {
      const layoutTags = Array.isArray(layout && layout.shopifyTags) ? layout.shopifyTags : [];
      const hasMatch = layoutTags.some((tag) => productTags.includes(normalizeTag(tag)));
      if (hasMatch) {
        console.log('[Designer CTA] Layout "' + layout.name + '" matched: layout tags [' + layoutTags.join(', ') + '] vs product tags [' + productTags.join(', ') + ']');
      }
      return hasMatch;
    });
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

  function renderButton(mount, productHandle, matchedLayouts, productTags) {
    if (!matchedLayouts.length) return;

    const matchedTags = getMatchedTags(matchedLayouts, productTags);

    const params = new URLSearchParams();
    params.set('product', productHandle);
    if (matchedTags.length) {
      params.set('tags', matchedTags.join(','));
    }
    if (matchedLayouts.length === 1 && matchedLayouts[0] && matchedLayouts[0].id) {
      params.set('layoutId', matchedLayouts[0].id);
    }
    if (typeof window !== 'undefined' && window.location && window.location.href) {
      params.set('returnTo', window.location.href);
    }

    mount.innerHTML = [
      '<a href="' + APP_BASE_URL + '/?' + params.toString() + '"',
      'style="display:inline-block;padding:12px 18px;background:#111827;color:#ffffff;text-decoration:none;border-radius:10px;font-weight:600;"',
      '>',
      'Customize My Card',
      '</a>'
    ].join(' ');
  }

  function readMountTags(mount) {
    const rawTags = mount.getAttribute('data-designer-product-tags') || '';
    return rawTags
      .split(',')
      .map(normalizeTag)
      .filter(Boolean);
  }

  function readWindowMetaTags(productHandle) {
    try {
      if (typeof window === 'undefined') return [];
      const metaProduct = window.meta && window.meta.product ? window.meta.product : null;
      if (!metaProduct) return [];

      const metaHandle = normalizeHandle(metaProduct.handle || '');
      if (metaHandle && metaHandle !== normalizeHandle(productHandle)) {
        return [];
      }

      const tags = Array.isArray(metaProduct.tags)
        ? metaProduct.tags
        : String(metaProduct.tags || '').split(',');

      return tags.map(normalizeTag).filter(Boolean);
    } catch (_error) {
      return [];
    }
  }

  async function fetchProductTagsFromUrl(url) {
    const response = await fetch(url, {
      cache: 'no-store',
      mode: 'cors',
      credentials: 'omit'
    });

    if (!response.ok) {
      const error = new Error('Unable to load Shopify product tags.');
      error.status = response.status;
      error.url = url;
      throw error;
    }

    const payload = await response.json();
    return String(payload && payload.tags ? payload.tags : '')
      .split(',')
      .map(normalizeTag)
      .filter(Boolean);
  }

  async function loadLayouts() {
    try {
      const response = await fetch(APP_BASE_URL + '/layout-index.json?source=shopify-cta-script&v=' + Date.now(), {
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
    const urls = [];

    if (typeof window !== 'undefined' && window.location && window.location.origin) {
      const storefrontUrl = window.location.origin + '/products/' + encodeURIComponent(productHandle) + '.js';
      if (!urls.includes(storefrontUrl)) {
        urls.push(storefrontUrl);
      }
    }

    const appProxyUrl = APP_BASE_URL + '/products/' + encodeURIComponent(productHandle) + '.js?source=shopify-cta-script';
    if (!urls.includes(appProxyUrl)) {
      urls.push(appProxyUrl);
    }

    console.log('[Designer CTA] Attempting to load product tags from ' + urls.length + ' URL(s):', urls);
    let lastError = null;

    try {
      for (const url of urls) {
        try {
          console.log('[Designer CTA] Fetching tags from: ' + url);
          const tags = await fetchProductTagsFromUrl(url);
          if (tags.length) {
            console.log('[Designer CTA] Successfully loaded ' + tags.length + ' tag(s) from ' + url + ':', tags);
            return tags;
          }
        } catch (error) {
          console.warn('[Designer CTA] Failed to load from ' + url + ':', error.message);
          lastError = error;
        }
      }
    } catch (error) {
      lastError = error;
    }

    if (lastError && lastError.status !== 404) {
      console.error('Designer CTA product tag lookup failed:', lastError);
    }

    console.log('[Designer CTA] No product tags loaded from any URL');
    return [];
  }

  async function initDesignerShopifyCTA() {
    const mounts = Array.from(document.querySelectorAll('[data-designer-product-handle]'));
    if (!mounts.length) {
      console.log('[Designer CTA] No mounts found with data-designer-product-handle attribute');
      return;
    }
    console.log('[Designer CTA] Found ' + mounts.length + ' mount(s)');

    const layouts = await loadLayouts();
    console.log('[Designer CTA] Loaded ' + layouts.length + ' layout(s):', layouts.map((l) => ({ id: l.id, name: l.name, tags: l.shopifyTags })));

    await Promise.all(mounts.map(async (mount) => {
      if (mount.getAttribute('data-designer-rendered') === 'true') {
        console.log('[Designer CTA] Mount already rendered, skipping');
        return;
      }

      const productHandle = mount.getAttribute('data-designer-product-handle') || '';
      if (!productHandle) {
        console.log('[Designer CTA] No product handle on mount');
        return;
      }
      console.log('[Designer CTA] Processing product handle: ' + productHandle);

      const mountTags = readMountTags(mount);
      console.log('[Designer CTA] Mount tags from data attribute: ', mountTags);
      
      let productTags = mountTags.length ? mountTags : await loadProductTags(productHandle);
      console.log('[Designer CTA] Product tags after fetch attempt: ', productTags);
      
      if (!productTags.length) {
        productTags = readWindowMetaTags(productHandle);
        console.log('[Designer CTA] Product tags from window.meta: ', productTags);
      }
      
      console.log('[Designer CTA] Final product tags array: ', productTags);
      const matchedLayouts = getMatchedLayouts(layouts, productTags);
      console.log('[Designer CTA] Matched ' + matchedLayouts.length + ' layout(s):', matchedLayouts.map((l) => ({ id: l.id, name: l.name })));
      
      if (!matchedLayouts.length) {
        console.warn('[Designer CTA] No layouts matched product tags. Button will NOT render.');
        console.warn('[Designer CTA] Layout tags:', layouts.map((l) => l.shopifyTags));
        console.warn('[Designer CTA] Product tags:', productTags);
        return;
      }

      renderButton(mount, productHandle, matchedLayouts, productTags);
      console.log('[Designer CTA] Button rendered successfully');
      mount.setAttribute('data-designer-rendered', 'true');
    }));
  }

  window.DesignerShopifyCTA = {
    init: initDesignerShopifyCTA
  };

  function observeDesignerMounts() {
    if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return;

    const observer = new MutationObserver((mutations) => {
      const hasRelevantAddition = mutations.some((mutation) => {
        return Array.from(mutation.addedNodes || []).some((node) => {
          if (!node || node.nodeType !== 1) return false;
          const element = node;
          if (element.matches && element.matches('[data-designer-product-handle]')) return true;
          return Boolean(element.querySelector && element.querySelector('[data-designer-product-handle]'));
        });
      });

      if (hasRelevantAddition) {
        initDesignerShopifyCTA();
      }
    });

    observer.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDesignerShopifyCTA, { once: true });
  } else {
    initDesignerShopifyCTA();
  }

  observeDesignerMounts();
})();