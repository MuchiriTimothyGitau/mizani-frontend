export default async function handler(req, res) {
  const appwriteUrl = 'https://fra.cloud.appwrite.io/v1';
  const projectId = process.env.VITE_APPWRITE_PROJECT_ID || '6a366796002ca5f0af34';
  const { path } = req.query;

  if (!path || typeof path !== 'string') {
    return res.status(400).json({ error: 'Missing path parameter' });
  }

  try {
    const appwriteRes = await fetch(`${appwriteUrl}/${path}`, {
      method: req.method,
      headers: {
        'X-Appwrite-Project': projectId,
        'Content-Type': 'application/json',
        ...(req.headers['x-appwrite-key'] && { 'X-Appwrite-Key': req.headers['x-appwrite-key'] })
      },
      body: (req.method !== 'GET' && req.method !== 'HEAD') ? JSON.stringify(req.body) : undefined
    });

    const text = await appwriteRes.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    res.status(appwriteRes.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Proxy error' });
  }
}
