const CACHE_NAME = 'buildflow-v1';
const ASSETS = [
    '/',
    '/index.html',
    '/dashboard.html',
    '/css/style.css',
    '/js/main.js',
    '/js/offline-storage.js',
    '/pages/entradas.html',
    '/pages/saidas.html',
    '/pages/estoque.html',
    '/pages/relatorios.html'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS);
        })
    );
});

self.addEventListener('fetch', (event) => {
    // Skip API calls, they are handled by offline-storage.js + main.js
    if (event.request.url.includes('/api/')) {
        return;
    }

    event.respondWith(
        caches.match(event.request).then((response) => {
            return response || fetch(event.request);
        })
    );
});
