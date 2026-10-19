// Хранилище переводов: Vercel Blob (Vercel → Storage → Blob → Connect to project).
const blob = require('@vercel/blob');
const enabled = () => !!process.env.BLOB_READ_WRITE_TOKEN;

async function url(pathname) {
  try { const h = await blob.head(pathname); return h.url; }
  catch (e) { return null; }
}
async function getJSON(pathname) {
  const u = await url(pathname);
  if (!u) return null;
  const r = await fetch(u + '?v=' + Date.now(), { cache: 'no-store' });
  return r.ok ? r.json() : null;
}
async function putJSON(pathname, obj) {
  await blob.put(pathname, JSON.stringify(obj), {
    access: 'public', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60
  });
}
module.exports = { enabled, url, getJSON, putJSON };
