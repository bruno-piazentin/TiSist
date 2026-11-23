// Service worker do SisTI: guarda a casca do app para abrir sem internet.
// Dados da API não passam por aqui: o app usa IndexedDB e a fila offline.
const VERSAO = 'sisti-__VERSAO__';
const CASCA = ['/', '/index.html', '/app.js', '/styles.css', '/icon.svg', '/manifest.webmanifest'];

self.addEventListener('install', e => {
  // cache: 'reload' ignora o cache HTTP do navegador, para a casca guardada ser sempre a versão nova
  e.waitUntil(caches.open(VERSAO).then(c => c.addAll(CASCA.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(chaves => Promise.all(chaves.filter(k => k !== VERSAO).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // Navegação: rede primeiro, cache como reserva (sempre a SPA)
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('/index.html')));
    return;
  }
  // Arquivos estáticos: rede primeiro (sempre a versão publicada), cache só sem conexão
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(r => {
    if (r.ok) { const copia = r.clone(); caches.open(VERSAO).then(c => c.put(e.request, copia)); }
    return r;
  }).catch(() => caches.match(e.request)));
});
