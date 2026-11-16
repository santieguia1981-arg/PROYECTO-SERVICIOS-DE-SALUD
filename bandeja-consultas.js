const $ = id => document.getElementById(id);
const adminMode = new URLSearchParams(location.search).get('administrar') === '1';
const path = '/api/customer-service/access';
const sessionKey = 'acceso-consultas-catalogo';
let accessKey = '';
let busy = false;
try { accessKey = sessionStorage.getItem(sessionKey) || ''; } catch {}

function message(text) { $('feedback').textContent = text; }
function clearSession() {
  accessKey = '';
  try { sessionStorage.removeItem(sessionKey); } catch {}
  $('messages').replaceChildren();
  $('count').textContent = '';
  $('inbox').hidden = true;
  $('login').hidden = false;
}
function element(tag, text, cls) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (cls) node.className = cls;
  return node;
}
function renderMessages(items) {
  $('count').textContent = items.length === 1 ? '1 consulta recibida' : items.length + ' consultas recibidas';
  const cards = items.map(item => {
    const card = document.createElement('article');
    card.append(element('span', item.ticketNumber, 'ticket'), element('h2', item.contactName),
      element('p', [new Date(item.createdAt).toLocaleString('es-AR'), item.status, item.email, item.phone].filter(Boolean).join(' · '), 'meta'));
    if (item.requestedProducts) card.append(element('p','Productos: ' + item.requestedProducts));
    card.append(element('p', item.message, 'detail'));
    return card;
  });
  $('messages').replaceChildren(...cards);
}
async function refresh() {
  if (busy || !accessKey) return;
  busy = true;
  const currentKey = accessKey;
  try {
    const response = await fetch(path, { headers: { Authorization: 'Bearer ' + currentKey }, cache: 'no-store' });
    if (currentKey !== accessKey) return;
    if (response.status === 401) { clearSession(); message('La clave no es válida o fue retirada.'); return; }
    if (!response.ok) throw Error();
    const data = await response.json();
    if (currentKey !== accessKey) return;
    try { sessionStorage.setItem(sessionKey, accessKey); } catch {}
    $('accessKey').value = '';
    $('login').hidden = true;
    $('inbox').hidden = false;
    renderMessages(data.messages);
    message('Sesión de ' + data.operator);
  } catch { message('No se pudo actualizar la bandeja. Volvé a intentar.'); }
  finally { busy = false; }
}
async function adminRequest(method, body) {
  const options = { method, cache: 'no-store' };
  if (body) { options.headers = { 'Content-Type': 'application/json' }; options.body = JSON.stringify(body); }
  const response = await fetch(path + '?mode=admin', options);
  if (!response.ok) throw Error();
  return response.status === 204 ? null : response.json();
}
async function loadAdmin() {
  const data = await adminRequest('GET');
  $('admin').hidden = false;
  $('operators').replaceChildren(...data.operators.map(person => {
    const item = element('li',person.label + ' ');
    const revoke = element('button','Retirar acceso','quiet');
    revoke.onclick = async () => {
      if (!confirm('¿Retirar el acceso de ' + person.label + '?')) return;
      try { await adminRequest('DELETE', { id: person.id }); await loadAdmin(); message('Acceso retirado.'); }
      catch { message('No se pudo retirar el acceso.'); }
    };
    item.append(revoke);
    return item;
  }));
}
$('inviteForm').onsubmit = async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  button.disabled = true;
  try {
    const result = await adminRequest('POST', { label: $('label').value });
    $('newKey').value = result.key; $('newAccess').hidden = false; $('label').value = '';
    await loadAdmin(); message('Acceso creado. Copiá la clave para entregarla de forma privada.');
  } catch { message('No se pudo crear el acceso.'); }
  finally { button.disabled = false; }
};
$('copy').onclick = async () => {
  try { await navigator.clipboard.writeText($('newKey').value); message('Clave copiada.'); }
  catch { $('newKey').select(); message('Usá Copiar para guardar la clave.'); }
};
$('loginForm').onsubmit = event => { event.preventDefault(); accessKey = $('accessKey').value.trim(); refresh(); };
$('logout').onclick = () => { clearSession(); message('Sesión cerrada.'); };
$('refresh').onclick = refresh;
if (adminMode) {
  $('title').textContent = 'Accesos a Customer Service';
  loadAdmin().catch(() => message('Abrí el enlace de administración privado desde tu cuenta de Vercel.'));
} else {
  $('login').hidden = false;
  if (accessKey) refresh();
  setInterval(() => { if (!document.hidden && accessKey) refresh(); }, 20000);
}
