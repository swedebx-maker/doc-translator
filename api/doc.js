// Коды переводов (как код комнаты в игре).
// GET ?cfg=1           → { cloud: true/false }
// GET ?code=AB12C      → meta
// GET ?hash=sha256     → meta, если этот файл уже переводили
// POST {action:'new'}  → { code }
// POST {action:'finish', code, hash, meta} → { ok }
const store = require('./_store');
const ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const BAD = /SEX|KUK|FUC|FUK|FCK|SHIT|CUNT|DICK|COCK|PISS|PORN|PORR|HORA|NAZI|RAPE|ANAL|TWAT|SLUT|KNUL|TITS|BAJS|FAN|ASS|GAY|KKK|HUJ|HUY|XUY|SUKA|BLYA|PIZD|ZHOP|KURW|CUM|DUM|JEB/;
const okCode = c => /^[A-Z0-9]{5}$/.test(c || '');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') {
      if (req.query.cfg) return res.status(200).json({ cloud: store.enabled() });
      if (!store.enabled()) return res.status(503).json({ error: 'no_cloud' });
      if (req.query.code) {
        const code = String(req.query.code).toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (!okCode(code)) return res.status(404).json({ error: 'not_found' });
        const meta = await store.getJSON(`docs/${code}/meta.json`);
        return meta ? res.status(200).json(meta) : res.status(404).json({ error: 'not_found' });
      }
      if (req.query.hash) {
        const hash = String(req.query.hash).replace(/[^a-f0-9]/g, '').slice(0, 64);
        const link = await store.getJSON(`hash/${hash}.json`);
        if (!link || !okCode(link.code)) return res.status(404).json({ error: 'not_found' });
        const meta = await store.getJSON(`docs/${link.code}/meta.json`);
        return meta ? res.status(200).json(meta) : res.status(404).json({ error: 'not_found' });
      }
      return res.status(400).json({ error: 'bad_request' });
    }
    if (req.method === 'POST') {
      if (!store.enabled()) return res.status(503).json({ error: 'no_cloud' });
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      if (body.action === 'new') {
        for (let i = 0; i < 20; i++) {
          let c = ''; for (let k = 0; k < 5; k++) c += ABC[Math.floor(Math.random() * ABC.length)];
          if (BAD.test(c)) continue;
          if (!(await store.url(`docs/${c}/meta.json`))) return res.status(200).json({ code: c });
        }
        return res.status(500).json({ error: 'no_code' });
      }
      if (body.action === 'finish') {
        const code = String(body.code || '');
        if (!okCode(code) || !body.meta || !Array.isArray(body.meta.pages)) return res.status(400).json({ error: 'bad_request' });
        const m = body.meta;
        const meta = {
          code, title: String(m.title || '').slice(0, 120), kind: String(m.kind || 'pdf'), created: Date.now(),
          pages: m.pages.slice(0, 400).map(p => ({ w: +p.w || 0, h: +p.h || 0, uk: String(p.uk || ''), sv: String(p.sv || ''),
            blocks: Array.isArray(p.blocks) ? p.blocks.slice(0, 300) : [] })),
          file: m.file ? String(m.file) : '', original: m.original ? String(m.original) : ''
        };
        await store.putJSON(`docs/${code}/meta.json`, meta);
        if (body.hash) await store.putJSON(`hash/${String(body.hash).replace(/[^a-f0-9]/g, '').slice(0, 64)}.json`, { code });
        return res.status(200).json({ ok: true, code });
      }
      return res.status(400).json({ error: 'bad_request' });
    }
    return res.status(405).end();
  } catch (e) {
    return res.status(500).json({ error: 'server', detail: String(e && e.message || e) });
  }
};
