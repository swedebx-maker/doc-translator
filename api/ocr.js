// Облачное распознавание текста на картинках.
// 1) Google Cloud Vision, пока не исчерпан бесплатный лимит месяца (счётчик в Vercel Blob; VISION_LIMIT, по умолчанию 950 из 1000)
// 2) потом OCR.space
// 3) если и это недоступно — сайт сам распознаёт в браузере (Tesseract)
// POST { image: "<base64 jpeg>" }  →  { provider, lines: [{ text, x0, y0, x1, y1, angle, conf }] }
// angle: 0 — обычный текст, 90 — читается сверху вниз, -90 — снизу вверх
const store = require('./_store');
const VKEY = process.env.GOOGLE_VISION_KEY || '';
const OKEY = process.env.OCRSPACE_KEY || '';
const LIMIT = Math.max(0, +process.env.VISION_LIMIT || 950);
const MAX_B64 = 4000000;

const snap = deg => (Math.abs(deg) < 25 ? 0 : deg > 65 && deg < 115 ? 90 : deg < -65 && deg > -115 ? -90 : null);

function parseGoogle(resp) {
  const lines = [];
  const pages = (resp.fullTextAnnotation && resp.fullTextAnnotation.pages) || [];
  const push = cur => {
    if (!cur || !cur.words.length) return;
    const xs = [], ys = [];
    cur.words.forEach(w => (w.v || []).forEach(p => { xs.push(p.x || 0); ys.push(p.y || 0); }));
    if (!xs.length) return;
    const v = cur.words[0].v || [];
    const deg = v.length > 1 ? Math.atan2((v[1].y || 0) - (v[0].y || 0), (v[1].x || 0) - (v[0].x || 0)) * 180 / Math.PI : 0;
    const angle = snap(deg);
    if (angle === null) return; // наклонный или перевёрнутый текст не берём
    const conf = cur.words.reduce((a, w) => a + (w.conf == null ? 0.9 : w.conf), 0) / cur.words.length * 100;
    lines.push({ text: cur.text.replace(/\s+/g, ' ').trim(), x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys), angle, conf: Math.round(conf) });
  };
  for (const pg of pages) for (const bl of pg.blocks || []) for (const pa of bl.paragraphs || []) {
    let cur = null;
    for (const wd of pa.words || []) {
      const syms = wd.symbols || [];
      const text = syms.map(s => s.text).join('');
      const brk = syms.length && syms[syms.length - 1].property && syms[syms.length - 1].property.detectedBreak && syms[syms.length - 1].property.detectedBreak.type;
      if (!cur) cur = { words: [], text: '' };
      cur.words.push({ v: wd.boundingBox && wd.boundingBox.vertices, conf: wd.confidence });
      cur.text += text + (brk === 'SPACE' || brk === 'SURE_SPACE' ? ' ' : '');
      if (brk === 'EOL_SURE_BREAK' || brk === 'LINE_BREAK') { push(cur); cur = null; }
    }
    push(cur);
  }
  return lines.filter(l => l.text);
}

async function viaGoogle(b64) {
  const r = await fetch('https://vision.googleapis.com/v1/images:annotate?key=' + encodeURIComponent(VKEY), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ image: { content: b64 }, features: [{ type: 'DOCUMENT_TEXT_DETECTION' }], imageContext: { languageHints: ['sv'] } }] })
  });
  if (!r.ok) { const e = new Error('vision ' + r.status + ' ' + (await r.text()).slice(0, 200)); e.status = r.status; throw e; }
  const j = await r.json(); const resp = (j.responses || [])[0] || {};
  if (resp.error) { const e = new Error('vision ' + JSON.stringify(resp.error).slice(0, 200)); e.status = resp.error.code; throw e; }
  return parseGoogle(resp);
}

async function viaOcrSpace(b64) {
  if (b64.length * 0.75 > 1000000) throw new Error('ocrspace: file over 1 MB');
  const form = new FormData();
  form.append('base64Image', 'data:image/jpeg;base64,' + b64);
  form.append('isOverlayRequired', 'true');
  form.append('OCREngine', process.env.OCRSPACE_ENGINE || '2');
  form.append('scale', 'true');
  const r = await fetch('https://api.ocr.space/parse/image', { method: 'POST', headers: { apikey: OKEY }, body: form });
  if (!r.ok) throw new Error('ocrspace ' + r.status);
  const j = await r.json();
  if (j.IsErroredOnProcessing) throw new Error('ocrspace: ' + JSON.stringify(j.ErrorMessage).slice(0, 200));
  const lines = [];
  for (const pr of j.ParsedResults || []) for (const l of (pr.TextOverlay && pr.TextOverlay.Lines) || []) {
    const ws = l.Words || []; if (!ws.length) continue;
    const text = ws.map(w => w.WordText).join(' ').trim(); if (!text) continue;
    const x0 = Math.min(...ws.map(w => w.Left)), x1 = Math.max(...ws.map(w => w.Left + w.Width));
    const y0 = l.MinTop != null ? l.MinTop : Math.min(...ws.map(w => w.Top));
    const y1 = y0 + (l.MaxHeight || Math.max(...ws.map(w => w.Height)));
    lines.push({ text, x0, y0, x1, y1, angle: 0, conf: 85 });
  }
  return lines;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  if (!VKEY && !OKEY) return res.status(503).json({ error: 'no_ocr' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const img = String(body.image || '').replace(/^data:[^,]+,/, '');
    if (!img || img.length > MAX_B64) return res.status(413).json({ error: 'bad_image' });

    if (VKEY && store.enabled() && LIMIT > 0) {
      const path = `quota/vision-${new Date().toISOString().slice(0, 7)}.json`;
      let q = null;
      try { q = await store.getJSON(path); } catch (e) {}
      q = q || { n: 0 };
      if (q.n < LIMIT) {
        q.n++; // резервируем попытку до запроса, чтобы не превысить бесплатный лимит
        try { await store.putJSON(path, q); } catch (e) { console.error('quota write', e.message); }
        try { return res.status(200).json({ provider: 'google', lines: await viaGoogle(img) }); }
        catch (e) {
          console.error('google failed', e.message);
          if (e.status === 403 || e.status === 429) { q.n = LIMIT; try { await store.putJSON(path, q); } catch (x) {} } // квота/биллинг — дальше не пытаемся до след. месяца
        }
      }
    }
    if (OKEY) {
      try { return res.status(200).json({ provider: 'ocrspace', lines: await viaOcrSpace(img) }); }
      catch (e) { console.error('ocrspace failed', e.message); }
    }
    return res.status(503).json({ error: 'unavailable' });
  } catch (e) {
    return res.status(500).json({ error: 'server', detail: String(e && e.message || e) });
  }
};
