import { createHash } from 'node:crypto';
import { get, put } from '@vercel/blob';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const limits = { contactName: 200, email: 254, phone: 80, message: 12000, requestedProducts: 8000 };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }
  if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
    return res.status(415).end();
  }
  const body = req.body;
  if (!body || typeof body !== 'object' || typeof body.id !== 'string' || !uuid.test(body.id)) {
    return res.status(400).json({ error: 'Identificador de consulta inválido.' });
  }
  const fields = {};
  for (const [key, limit] of Object.entries(limits)) {
    const value = body[key] ?? '';
    if (typeof value !== 'string' || value.length > limit) {
      return res.status(400).json({ error: 'Revisá la extensión de los campos.' });
    }
    fields[key] = value.trim();
  }
  if (!fields.contactName || !fields.message || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)) {
    return res.status(400).json({ error: 'Completá el nombre, un email válido y la consulta.' });
  }
  const id = body.id.toLowerCase();
  const pathname = `customer-service/web/${id}.json`;
  const fingerprint = createHash('sha256').update(JSON.stringify(fields)).digest('hex');
  const receipt = `WEB-${id.toUpperCase()}`;
  const message = {
    ...fields, id: `web-${id}`, ticketNumber: receipt, createdAt: new Date().toISOString(),
    organization: fields.contactName, status: 'Nuevo', urgency: 'Normal',
    subject: fields.requestedProducts ? 'Solicitud de cotización web' : 'Consulta web',
    sourceUrl: 'https://proyecto-servicios-de-salud-seven.vercel.app/productos.html'
  };
  try {
    await put(pathname, JSON.stringify({ fingerprint, message }), {
      access: 'private', addRandomSuffix: false, allowOverwrite: false, contentType: 'application/json'
    });
    return res.status(201).json({ success: true, ticketNumber: receipt });
  } catch {
    // After a lost response or a concurrent retry, acknowledge only the original submission.
    try {
      const current = await get(pathname, { access: 'private', useCache: false });
      if (current?.statusCode === 200) {
        const stored = await new Response(current.stream).json();
        if (stored.fingerprint === fingerprint) {
          return res.status(200).json({ success: true, ticketNumber: receipt });
        }
        return res.status(409).json({ error: 'Este identificador ya se utilizó para otra consulta.' });
      }
    } catch { /* Storage is unavailable. Keep the form intact so the visitor can retry. */ }
    return res.status(503).json({ error: 'No pudimos confirmar la recepción. Volvé a intentar.' });
  }
}
