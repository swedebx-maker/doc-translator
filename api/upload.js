// Выдаёт браузеру одноразовый токен, чтобы он сам загрузил страницы/файл в Vercel Blob (без лимита 4.5 МБ).
const { handleUpload } = require('@vercel/blob/client');

module.exports = async (req, res) => {
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const json = await handleUpload({
      body, request: req,
      onBeforeGenerateToken: async (pathname) => {
        if (!/^docs\/[A-Z0-9]{5}\/[\w.-]{1,80}$/.test(pathname)) throw new Error('bad path');
        return {
          allowedContentTypes: ['image/jpeg', 'image/png', 'application/pdf',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
          maximumSizeInBytes: 80 * 1024 * 1024, addRandomSuffix: false, allowOverwrite: true
        };
      },
      onUploadCompleted: async () => {}
    });
    return res.status(200).json(json);
  } catch (e) {
    return res.status(400).json({ error: String(e && e.message || e) });
  }
};
