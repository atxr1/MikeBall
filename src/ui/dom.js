// Tiny DOM helpers.

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function svg(markup) {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstChild;
}

// A pixel chevron for back / previous / next buttons (the font's angle
// quotes are tiny): dir -1 points left, 1 right.
export function chevron(dir = -1, px = 3) {
  const rows = [4, 3, 2, 1, 2, 3, 4];
  const rects = rows.map((x, y) => `<rect x="${dir < 0 ? x : 6 - x - 1}" y="${y}" width="2" height="1"/>`).join('');
  return svg(`<svg width="${7 * px}" height="${7 * px}" viewBox="0 0 7 7" shape-rendering="crispEdges" aria-hidden="true" fill="currentColor">${rects}</svg>`);
}
