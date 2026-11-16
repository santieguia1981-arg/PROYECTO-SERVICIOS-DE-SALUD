import { createHash, randomBytes } from 'node:crypto';
import { get, list, put } from '@vercel/blob';

const accessPrefix = 'customer-service/operators/';
const messagePrefix = 'customer-service/web/';
const hash = value => createHash('sha256').update(value).digest('hex');
const authError = { error: 'El acceso no es válido o fue retirado.' };

async function readRecord(pathname) {
  const blob = await get(pathname, { access: 'private', useCache: false });
  return blob?.statusCode === 200 ? new Response(blob.stream).json() : null;
}

async function allFiles(prefix) {
  const files = [];
  let cursor;
  do {
    const page = await list({ prefix, limit: 100, cursor });
    files.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return files;
}

async function records(files) {
  const data = [];
  for (let i = 0; i < files.length; i += 8) {
    data.push(...await Promise.all(files.slice(i, i + 8).map(file => readRecord(file.pathname))));
  }
  return data.filter(Boolean);
}

function save(pathname, data, options = {}) {
  return put(pathname, JSON.stringify(data), {
    access: 'private', addRandomSuffix: false, contentType: 'application/json', ...options
  });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    if (req.query.mode === 'admin') {
      // Only the individually configured deployment behind Vercel Authentication can manage operators.
      if (process.env.VERCEL_ENV !== 'preview' || process.env.INBOX_ACCESS_MANAGER !== 'enabled') {
        return res.status(404).end();
      }
      if (req.method === 'GET') {
        const operators = await records(await allFiles(accessPrefix));
        return res.json({ operators: operators.filter(operator => operator.active) });
      }
      if (req.headers.origin !== 'https://' + req.headers.host ||
          req.headers['content-type']?.split(';')[0] !== 'application/json') return res.status(403).end();
      if (req.method === 'POST') {
        const label = req.body?.label;
        if (typeof label !== 'string' || !label.trim() || label.length > 180) return res.status(400).end();
        const key = 'cs_' + randomBytes(32).toString('base64url');
        const id = hash(key);
        await save(accessPrefix + id + '.json', { id, label: label.trim(), active: true, createdAt: new Date().toISOString() });
        return res.status(201).json({ key });
      }
      if (req.method === 'DELETE') {
        const id = req.body?.id;
        if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) return res.status(400).end();
        const path = accessPrefix + id + '.json';
        const operator = await readRecord(path);
        if (operator?.active) await save(path, { ...operator, active: false }, { allowOverwrite: true });
        return res.status(204).end();
      }
      return res.status(405).end();
    }
    if (req.method !== 'GET') return res.status(405).end();
    const bearer = /^Bearer (cs_[A-Za-z0-9_-]{43})$/.exec(req.headers.authorization || '');
    if (!bearer) return res.status(401).json(authError);
    const operator = await readRecord(accessPrefix + hash(bearer[1]) + '.json');
    if (!operator?.active) return res.status(401).json(authError);
    const items = await records(await allFiles(messagePrefix));
    const messages = items.flatMap(item => item.message ? [item.message] : []);
    messages.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return res.json({ operator: operator.label, messages });
  } catch {
    return res.status(503).json({ error: 'No se pudo consultar el buzón. Volvé a intentar.' });
  }
}
