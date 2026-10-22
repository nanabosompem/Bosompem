const CACHE_NAME='bosompem-pro-upgrade-v1';
const CORE=['./','./index.html','./style.css','./app.js','./manifest.json'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(CORE)).catch(()=>{}));self.skipWaiting();});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;event.respondWith(fetch(event.request).then(response=>{const copy=response.clone();caches.open(CACHE_NAME).then(cache=>cache.put(event.request,copy));return response;}).catch(()=>caches.match(event.request)));});
self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(clients=>{for(const client of clients){if('focus'in client){if(event.notification.data?.url&&'navigate'in client)return client.navigate(event.notification.data.url).then(()=>client.focus());return client.focus();}}if(self.clients.openWindow)return self.clients.openWindow(event.notification.data?.url||'./');}));});

// Remote push requires a subscribed browser and a configured push sender.
self.addEventListener('push',event=>{
  let payload={title:'Bosompem update',body:'You have an update.'};
  try{if(event.data){const incoming=event.data.json();payload={...payload,...incoming};}}catch{try{payload.body=event.data.text();}catch{}}
  event.waitUntil(self.registration.showNotification(payload.title||'Bosompem update',{body:payload.body||'',icon:payload.icon||'./icon-192.png',badge:payload.badge||'./icon-192.png',tag:payload.tag||'bosompem-push',data:payload.data||{url:'./'}}));
});
