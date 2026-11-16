const $ = id => document.getElementById(id);
const adminMode = new URLSearchParams(location.search).get('administrar') === '1';
const path = '/api/customer-service/access';
const sessionKey = 'acceso-consultas-catalogo';
let accessKey = '';
let reading = false;
let changing = false;
let version = 0;
let signedIn = false;
try { accessKey = sessionStorage.getItem(sessionKey) || ''; } catch {}

function message(text) { $('feedback').textContent = text; }
function setTabKey(key) {
  accessKey = key;
  try {
    if (key) sessionStorage.setItem(sessionKey, key);
    else sessionStorage.removeItem(sessionKey);
  } catch {}
}
function clearSession() {
  signedIn = false;
  setTabKey('');
  $('messages').replaceChildren();
  $('count').textContent = '';
  $('inbox').hidden = true;
  $('login').hidden = false;
  $('accessKey').value = '';
  $('remember').checked = false;
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
async function readInbox(key) {
  const headers = key ? { Authorization: 'Bearer ' + key } : {};
  const response = await fetch(path, { headers, cache: 'no-store' });
  if (response.status === 401) return null;
  if (!response.ok) throw Error();
  return response.json();
}

function showInbox(data) {
  signedIn = true;
  $('login').hidden = true;
  $('inbox').hidden = false;
  $('accessKey').value = '';
  $('rememberHere').hidden = !accessKey;
  renderMessages(data.messages);
  message('Sesión de ' + data.operator);
}

async function refresh() {
  if (reading || changing) return;
  reading = true;
  const started = version;
  try {
    const data = await readInbox(accessKey);
    if (started !== version) return;
    if (data) return showInbox(data);
    const hadSession = signedIn || Boolean(accessKey);
    clearSession();
    message(hadSession ? 'El acceso venció o fue retirado. Ingresá con una clave vigente.' : '');
  } catch {
    if (started === version) {
      if (!signedIn) $('login').hidden = false;
      message('No se pudo actualizar la bandeja. Volvé a intentar.');
    }
  } finally { reading = false; }
}

function changeSession(method, key) {
  const headers = { 'Content-Type': 'application/json' };
  if (key) headers.Authorization = 'Bearer ' + key;
  return fetch(path + '?mode=browser', { method, headers, body: '{}', cache: 'no-store' });
}

async function login(key, remember) {
  if (changing || !key) return;
  changing = true;
  version++;
  try {
    let data;
    if (remember) {
      const res = await changeSession('POST', key);
      if (res.status === 401) { clearSession(); message('La clave no es válida o fue retirada.'); return; }
      if (!res.ok) throw Error();
      data = await readInbox('');
      if (data) {
        setTabKey('');
        showInbox(data);
        message('Se recordará tu acceso en este navegador por 30 días.');
        return;
      }
    }
    data = await readInbox(key);
    if (!data) { clearSession(); message('La clave no es válida o fue retirada.'); return; }
    setTabKey(key);
    showInbox(data);
    if (remember) message('El navegador bloqueó la sesión guardada. Tenés acceso en esta pestaña.');
  } catch { message('No se pudo iniciar o guardar la sesión. Volvé a intentar.'); }
  finally { changing = false; }
}

async function logout() {
  if (changing) return;
  changing = true;
  version++;
  try {
    const response = await changeSession('DELETE');
    if (!response.ok) throw Error();
    clearSession();
    message('Sesión cerrada en este navegador.');
  } catch { message('No se pudo cerrar la sesión. Volvé a intentar.'); }
  finally { changing = false; }
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
$('loginForm').onsubmit = event => { event.preventDefault(); login($('accessKey').value.trim(), $('remember').checked); };
$('rememberHere').onclick = () => login(accessKey, true);
$('logout').onclick = logout;
$('refresh').onclick = refresh;
if (adminMode) {
  $('title').textContent = 'Accesos a Customer Service';
  loadAdmin().catch(() => message('Abrí el enlace de administración privado desde tu cuenta de Vercel.'));
} else {
  message('Buscando una sesión autorizada…');
  refresh();
  setInterval(() => { if (!document.hidden && signedIn) refresh(); }, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && signedIn) refresh(); });
  window.addEventListener('pageshow', event => { if (event.persisted) refresh(); });
}
