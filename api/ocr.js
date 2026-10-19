// Облачное распознавание текста на картинках.
// Исключительно OCR.space
// POST { image: "<base64 jpeg>" }  →  { provider, lines: [{ text, x0, y0, x1, y1, angle, conf }] }

const OKEY = process.env.OCRSPACE_KEY || '';
const MAX_B64 = 5000000;

async function viaOcrSpace(b64) {
  if (b64.length * 0.75 > 5000000) throw new Error('ocrspace: file over 5 MB');
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
  for (const pr of j.ParsedResults || []) {
    for (const l of (pr.TextOverlay && pr.TextOverlay.Lines) || []) {
      const ws = l.Words || []; 
      if (!ws.length) continue;
      
      const text = ws.map(w => w.WordText).join(' ').trim(); 
      if (!text) continue;
      
      const x0 = Math.min(...ws.map(w => w.Left));
      const x1 = Math.max(...ws.map(w => w.Left + w.Width));
      const y0 = l.MinTop != null ? l.MinTop : Math.min(...ws.map(w => w.Top));
      const y1 = y0 + (l.MaxHeight || Math.max(...ws.map(w => w.Height)));
      
      lines.push({ text, x0, y0, x1, y1, angle: 0, conf: 85 });
    }
  }
  return lines;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  if (!OKEY) return res.status(503).json({ error: 'no_ocr' });
  
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const img = String(body.image || '').replace(/^data:[^,]+,/, '');
    
    if (!img || img.length > MAX_B64) {
      return res.status(413).json({ error: 'bad_image' });
    }

    try {
      return res.status(200).json({ provider: 'ocrspace', lines: await viaOcrSpace(img) });
    } catch (e) {
      console.error('ocrspace failed', e.message);
      return res.status(503).json({ error: 'unavailable' });
    }
  } catch (e) {
    return res.status(500).json({ error: 'server', detail: String(e && e.message || e) });
  }
};
