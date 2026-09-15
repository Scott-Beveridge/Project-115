//Stores the game on the device so it runs without a connection after the first visit.
//Game code is served from the cache and refreshed in the background (picked up on the next launch);
//images and sounds are served from the cache and only downloaded once.

const CACHE = "project115"
const CODE = /\.(html|js|json|webmanifest)$|\/$/

self.addEventListener("install", event => {
    self.skipWaiting()
})

self.addEventListener("activate", event => {
    event.waitUntil(self.clients.claim())
})

self.addEventListener("fetch", event => {
    const request = event.request
    const url = new URL(request.url)
    if (request.method !== "GET" || url.origin !== location.origin) return

    event.respondWith((async () => {
        const cache = await caches.open(CACHE)
        const key = request.mode === "navigate" ? new URL("./index.html", location).href : url.origin + url.pathname
        const cached = await cache.match(key)

        const fromNetwork = fetch(request.mode === "navigate" ? key : request).then(response => {
            if (response.ok && response.status === 200) {
                cache.put(key, response.clone())
            }
            return response
        })

        if (cached != null) {
            if (CODE.test(url.pathname) || request.mode === "navigate") {
                event.waitUntil(fromNetwork.catch(() => {}))
            }
            return cached
        }
        return fromNetwork
    })())
})

//The page asks for everything to be saved once the game has loaded
self.addEventListener("message", event => {
    if (event.data === "cache-all") {
        event.waitUntil(cacheAll())
    }
})

let caching = null

function cacheAll() {
    if (caching == null) {
        caching = cacheAll1().finally(() => caching = null)
    }
    return caching
}

async function cacheAll1() {
    const cache = await caches.open(CACHE)
    let list
    try {
        list = await (await fetch("offline-files.json", {cache: "no-store"})).json()
    } catch (e) {
        const cached = await cache.match(new URL("offline-files.json", location).href)
        if (cached == null) return
        list = await cached.json()
    }
    await cache.put(new URL("offline-files.json", location).href, new Response(JSON.stringify(list)))

    const base = new URL("./", location)
    const urls = list.files.map(f => new URL(f, base).href)
    let done = 0
    let failed = 0
    const report = async () => {
        for (const client of await self.clients.matchAll()) {
            client.postMessage({type: "cache-progress", done, failed, total: urls.length})
        }
    }

    let next = 0
    const worker = async () => {
        while (next < urls.length) {
            const href = urls[next++]
            if (await cache.match(href) == null) {
                try {
                    const response = await fetch(href)
                    if (!response.ok) throw new Error("HTTP " + response.status)
                    await cache.put(href, response)
                } catch (e) {
                    failed++
                }
            }
            done++
            if (done % 10 === 0) await report()
        }
    }
    await Promise.all([worker(), worker(), worker(), worker()])
    await report()
}
