// Перевод через DeepL. Ключ хранится в переменной окружения DEEPL_KEY (Vercel → Settings → Environment Variables).
// POST { texts: [...], context?: "весь текст страницы", tags?: true }  →  { translations: [...] }
const KEY = process.env.DEEPL_KEY || '';
const BASE = KEY.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
const MAX_CHARS = 40000;

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  if (!KEY) return res.status(500).json({ error: 'no_key' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const texts = Array.isArray(body.texts) ? body.texts.map(t => String(t == null ? '' : t)) : [];
    if (!texts.length) return res.status(200).json({ translations: [] });
    const total = texts.reduce((a, t) => a + t.length, 0);
    if (total > MAX_CHARS || texts.length > 400) return res.status(413).json({ error: 'too_big' });
    const target = /^[A-Z]{2}(-[A-Z]{2})?$/.test(body.target || '') ? body.target : 'UK';
    const context = body.context ? String(body.context).slice(0, 4000) : undefined;

    const out = [];
    for (let i = 0; i < texts.length; i += 50) {
      const chunk = texts.slice(i, i + 50);
      const payload = { text: chunk, target_lang: target, preserve_formatting: true };
      if (context) payload.context = context;
      if (body.tags) payload.tag_handling = 'xml';
      let r, tries = 0;
      while (true) {
        r = await fetch(BASE + '/v2/translate', {
          method: 'POST',
          headers: { 'Authorization': 'DeepL-Auth-Key ' + KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if ((r.status === 429 || r.status >= 500) && tries < 3) { tries++; await new Promise(s => setTimeout(s, 700 * tries)); continue; }
        break;
      }
      if (r.status === 456) return res.status(456).json({ error: 'quota' });
      if (!r.ok) return res.status(502).json({ error: 'deepl', status: r.status, detail: (await r.text()).slice(0, 200) });
      const j = await r.json();
      j.translations.forEach(t => out.push(t.text));
    }
    return res.status(200).json({ translations: out });
  } catch (e) {
    return res.status(500).json({ error: 'server', detail: String(e && e.message || e) });
  }
};
