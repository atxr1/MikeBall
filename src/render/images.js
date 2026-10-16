// Tiny image cache for canvas drawing. Images load in the background; draw
// code asks `ready(url)` and falls back to procedural art until it's loaded.

const cache = new Map();
const failed = new Map(); // url -> time of failure
const RETRY_MS = 30000;
let onLoad = null;

export function setImageLoadListener(fn) {
  onLoad = fn;
}

export function image(url) {
  if (!url) return null;
  let img = cache.get(url);
  if (!img) {
    const f = failed.get(url);
    if (f && Date.now() - f < RETRY_MS) return null;
    img = new Image();
    img.decoding = 'async';
    img.addEventListener('load', () => onLoad && onLoad(url));
    img.addEventListener('error', () => {
      cache.delete(url);
      failed.set(url, Date.now());
    });
    img.src = url;
    cache.set(url, img);
  }
  return img;
}

// The image if it has loaded, else null (and starts loading it).
export function ready(url) {
  const img = image(url);
  return img && img.complete && img.naturalWidth > 0 ? img : null;
}

export function preload(urls) {
  for (const u of urls) image(u);
}
