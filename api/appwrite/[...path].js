export default async function handler(req, res) {
  const appwriteUrl = 'https://fra.cloud.appwrite.io/v1';
  const projectId = process.env.VITE_APPWRITE_PROJECT_ID || '6a366796002ca5f0af34';
  const path = Array.isArray(req.query.path) ? req.query.path.join('/') : (req.query.path || '');

  const appwriteRes = await fetch(`${appwriteUrl}/${path}`, {
    method: req.method,
    headers: {
      'X-Appwrite-Project': projectId,
      'Content-Type': 'application/json',
      ...(req.headers['x-appwrite-key'] && { 'X-Appwrite-Key': req.headers['x-appwrite-key'] })
    },
    body: req.method !== 'GET' && req.method !== 'HEAD' ? JSON.stringify(req.body) : undefined
  });

  const data = await appwriteRes.text();
  res.status(appwriteRes.status).setHeader('Content-Type', 'application/json').send(data);
}
