/* Bosompem v4 service worker — resilient offline shell and Web Push */
'use strict';
const CACHE_NAME='bosompem-pro-v6-aurora-glass';
const CORE=['./','./index.html','./style.css','./app.js','./manifest.json'];
self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE_NAME);
    await Promise.all(CORE.map(async url=>{try{const response=await fetch(url,{cache:'reload'});if(response.ok)await cache.put(url,response);}catch(error){console.warn('Bosompem cache skipped:',url,error);}}));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{const keys=await caches.keys();await Promise.all(keys.filter(key=>key.startsWith('bosompem-')&&key!==CACHE_NAME).map(key=>caches.delete(key)));await self.clients.claim();})());
});
self.addEventListener('message',event=>{if(event.data?.type==='SKIP_WAITING')self.skipWaiting();});
self.addEventListener('fetch',event=>{
  const request=event.request;if(request.method!=='GET')return;
  const url=new URL(request.url);if(url.origin!==self.location.origin)return;
  if(request.mode==='navigate'){
    event.respondWith((async()=>{try{const response=await fetch(request);if(response.ok){const cache=await caches.open(CACHE_NAME);await cache.put('./index.html',response.clone());}return response;}catch{return (await caches.match(request))||(await caches.match('./index.html'));}})());return;
  }
  event.respondWith((async()=>{const cached=await caches.match(request);try{const response=await fetch(request);if(response.ok){const cache=await caches.open(CACHE_NAME);await cache.put(request,response.clone());}return response;}catch{return cached||Response.error();}})());
});
self.addEventListener('push',event=>{
  let data={title:'Bosompem',body:'You have an update.',url:'./',tag:'bosompem-push'};
  try{if(event.data)data={...data,...event.data.json()};}catch{if(event.data)data.body=event.data.text();}
  const options={body:String(data.body||'You have an update.').slice(0,500),tag:String(data.tag||'bosompem-push').slice(0,100),data:{url:data.url||'./'},badge:'./icon-192.png',icon:'./icon-192.png'};
  event.waitUntil(self.registration.showNotification(String(data.title||'Bosompem').slice(0,100),options));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const parsed=new URL(event.notification.data?.url||'./',self.location.origin);const target=(parsed.origin===self.location.origin?parsed:new URL('./',self.location.origin)).href;
  event.waitUntil((async()=>{const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});for(const client of clients){if(new URL(client.url).origin===self.location.origin){if('navigate'in client)await client.navigate(target);return client.focus();}}if(self.clients.openWindow)return self.clients.openWindow(target);})());
});
