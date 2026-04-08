// sw.js — Service Worker de Platita
const CACHE_NAME = 'platita-v2';
const CDN_CACHE = 'platita-cdn-v1';

// Recursos a cachear para funcionar offline
const STATIC_ASSETS = [
  '/platita/',
  '/platita/index.html',
  '/platita/manifest.json'
];

// CDN externos que cachear con estrategia cache-first
const CDN_ASSETS = [
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://unpkg.com/react@18/umd/react.production.min.js',
  'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js',
  'https://unpkg.com/@babel/standalone/babel.min.js',
  'https://www.gstatic.com/firebasejs/11.0.1/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/11.0.1/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore-compat.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap'
];

// --- INSTALL: cachear todos los recursos estáticos ---
self.addEventListener('install', event => {
  event.waitUntil(
    Promise.all([
      // Cachear assets locales en CACHE_NAME
      caches.open(CACHE_NAME).then(cache => {
        console.log('[SW] Cacheando recursos locales...');
        return Promise.allSettled(
          STATIC_ASSETS.map(url =>
            cache.add(url).catch(err => console.warn('[SW] No se pudo cachear:', url, err))
          )
        );
      }),
      // Cachear CDNs en CDN_CACHE (de forma silent, sin fallar si no está disponible)
      caches.open(CDN_CACHE).then(cache => {
        console.log('[SW] Cacheando CDNs...');
        return Promise.allSettled(
          CDN_ASSETS.map(url =>
            cache.add(url).catch(err => console.warn('[SW] CDN no disponible:', url))
          )
        );
      })
    ]).then(() => self.skipWaiting())
  );
});

// --- ACTIVATE: limpiar caches viejas ---
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME && key !== CDN_CACHE)
          .map(key => {
            console.log('[SW] Eliminando cache vieja:', key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// --- FETCH: estrategia optimizada por tipo de recurso ---
self.addEventListener('fetch', event => {
  // Ignorar requests que no son GET
  if (event.request.method !== 'GET') return;

  // Ignorar Firebase API calls (Firestore maneja su propia persistencia)
  const url = event.request.url;
  if (
    url.includes('firestore.googleapis.com') ||
    url.includes('firebase.googleapis.com') ||
    url.includes('identitytoolkit.googleapis.com') ||
    url.includes('securetoken.googleapis.com')
  ) return;

  // Estrategia Cache-First para CDNs versionados (nunca cambian)
  const isCDN = url.includes('cdn.') ||
                url.includes('unpkg.com') ||
                url.includes('gstatic.com') ||
                url.includes('googleapis.com');

  if (isCDN) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) {
          console.log('[SW] CDN desde cache:', url);
          return cached;
        }
        return fetch(event.request)
          .then(response => {
            if (response && response.status === 200) {
              const responseClone = response.clone();
              caches.open(CDN_CACHE).then(cache => {
                cache.put(event.request, responseClone);
              });
            }
            return response;
          })
          .catch(() => {
            // Si no hay conexión ni cache, devolver offline page si es navegación
            if (event.request.mode === 'navigate') {
              return caches.match('/platita/index.html');
            }
          });
      })
    );
  } else {
    // Network-first para recursos locales
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response && response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          return caches.match(event.request).then(cached => {
            if (cached) {
              console.log('[SW] Sirviendo desde cache:', url);
              return cached;
            }
            if (event.request.mode === 'navigate') {
              return caches.match('/platita/index.html');
            }
          });
        })
    );
  }
});
