/* ==========================================================
   BOSOMPEM PRO — UNIFIED PERSONAL AI OPERATING LAYER
   Web/PWA layer. Native Android capabilities belong in a
   permissioned DeviceBridge rather than pretending the browser
   has root access.
   ========================================================== */

const SYSTEM_INSTRUCTION = `
You are Bosompem Pro, a unified AI personal assistant and agent.
Your job is to understand the user's goal, not merely repeat their words.
Be direct, natural and useful. Use standard Markdown for visual responses.

When a task is complex:
1. identify the objective,
2. propose a concise plan,
3. use available tools/capabilities,
4. clearly state what was actually completed,
5. never claim an action was performed if the current environment cannot perform it.

Respect user permissions and autonomy settings. Sensitive, irreversible or external actions
must require appropriate confirmation unless the user explicitly enabled an autonomous level
that permits them. Adapt response depth to the user's request.
`;

const STORAGE = {
  sessions: 'bosompem_sessions',
  userName: 'bosompem_user_name',
  apiKey: 'bosompem_api_key',
  model: 'bosompem_model',
  memoryMode: 'bosompem_memory_mode',
  proactive: 'bosompem_proactive',
  autonomy: 'bosompem_autonomy',
  reminders: 'bosompem_reminders',
  projects: 'bosompem_projects',
  userRole: 'bosompem_user_role',
  userBio: 'bosompem_user_bio'
};

class SpeechSanitizer {
  static cleanTextForSpeech(text) {
    if (!text) return '';
    let clean = String(text);
    clean = clean.replace(/```[\s\S]*?```/g, ' Code block omitted. ');
    clean = clean.replace(/`([^`]+)`/g, '$1');
    clean = clean.replace(/^#{1,6}\s+(.*)$/gm, '$1. ');
    clean = clean.replace(/(\*\*|__)(.*?)\1/g, '$2');
    clean = clean.replace(/(\*|_)(.*?)\1/g, '$2');
    clean = clean.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    clean = clean.replace(/https?:\/\/\S+/g, '');
    clean = clean.replace(/^\s*[-*+]\s+/gm, '');
    clean = clean.replace(/^\s*\d+\.\s+/gm, '');
    clean = clean.replace(/<[^>]*>/g, '');
    return clean.replace(/\s+/g, ' ').trim();
  }
}

class MemoryVault {
  constructor() { this.db = null; this.dbName = 'BosompemMemoryVault'; }
  async init() {
    if (!window.indexedDB) return;
    return new Promise(resolve => {
      const request = indexedDB.open(this.dbName, 1);
      request.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('memories')) db.createObjectStore('memories', {keyPath:'id'});
      };
      request.onsuccess = e => { this.db = e.target.result; resolve(); };
      request.onerror = () => resolve();
    });
  }
  tokens(text) {
    return String(text).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu,' ').split(/\s+/).filter(x=>x.length>2);
  }
  async storeMemory(fact) {
    if (!this.db || !fact?.trim()) return null;
    const item = {id:'mem_'+Date.now()+'_'+Math.random().toString(36).slice(2,7), fact:fact.trim(), tokens:this.tokens(fact), date:new Date().toISOString()};
    return new Promise(resolve=>{
      const tx=this.db.transaction('memories','readwrite');
      tx.objectStore('memories').put(item);
      tx.oncomplete=()=>resolve(item);
      tx.onerror=()=>resolve(null);
    });
  }
  async getAllMemories() {
    if (!this.db) return [];
    return new Promise(resolve=>{
      const req=this.db.transaction('memories','readonly').objectStore('memories').getAll();
      req.onsuccess=()=>resolve(req.result||[]); req.onerror=()=>resolve([]);
    });
  }
  async retrieveRelevant(query) {
    const all=await this.getAllMemories(); const q=this.tokens(query);
    if(!q.length) return [];
    return all.map(m=>({m,score:q.reduce((n,t)=>n+(m.tokens.includes(t)?1:0),0)}))
      .filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,8).map(x=>x.m.fact);
  }
  async deleteMemory(id) {
    if(!this.db)return;
    return new Promise(resolve=>{
      const tx=this.db.transaction('memories','readwrite');
      tx.objectStore('memories').delete(id); tx.oncomplete=()=>resolve();
    });
  }
}

const state = {
  activeScreen:'chat',
  userName:localStorage.getItem(STORAGE.userName)||'',
  apiKey:localStorage.getItem(STORAGE.apiKey)||'',
  model:localStorage.getItem(STORAGE.model)||'gemini-2.5-flash',
  memoryMode:localStorage.getItem(STORAGE.memoryMode)!=='false',
  proactive:localStorage.getItem(STORAGE.proactive)==='true',
  autonomy:localStorage.getItem(STORAGE.autonomy)||'ask',
  sessions:readJSON(STORAGE.sessions,[]),
  activeSessionId:null,
  reminders:readJSON(STORAGE.reminders,[]),
  projects:readJSON(STORAGE.projects,[]),
  voiceState:'IDLE',
  isLiveVoiceActive:false,
  isVoiceNoteRecording:false,
  selectedImageData:null,
  isSending:false,
  activeRequestController:null,
  attachmentMenuOpen:false,
  profileRole:localStorage.getItem('bosompem_user_role')||'',
  profileBio:localStorage.getItem('bosompem_user_bio')||'',
  touchStartX:0,
  touchStartY:0
};

const memoryEngine=new MemoryVault();
const SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition||null;
let liveRecognition=null;
let voiceNoteRecognition=null;

function readJSON(key,fallback){try{return JSON.parse(localStorage.getItem(key)||JSON.stringify(fallback));}catch{return fallback;}}
function saveJSON(key,value){localStorage.setItem(key,JSON.stringify(value));}

window.addEventListener('DOMContentLoaded',async()=>{
  await memoryEngine.init();
  initVoiceEngines();
  initSwipeNavigation();
  loadSavedSettings();
  updateGreeting();
  updateClock();
  setInterval(updateClock,30000);
  renderReminders();
  renderMemoryList();
  renderProjects();
  if(!state.sessions.length) createNewChatSession(); else loadSession(state.sessions[0].id);
  updateSendButton();
});

function updateClock(){}
function updateGreeting(){
  const el=document.getElementById('dynamic-greeting');
  if(el)el.textContent=`Hello${state.userName?', '+state.userName:''}`;
  const name=document.getElementById('drawer-user-name');
  if(name)name.textContent=state.userName?state.userName:'Bosompem Pro';
  updateProfilePreview();
}

function openScreen(screenId){
  state.activeScreen=screenId;
  closeAttachmentMenu();
  document.querySelectorAll('.screen-view').forEach(x=>x.classList.toggle('active',x.id===`screen-${screenId}`));
  document.querySelectorAll('.nav-tab,.menu-item').forEach(x=>x.classList.toggle('active',x.dataset.screen===screenId));
  const titles={chat:'Chat Studio','live-voice':'Live Voice',projects:'Projects','media-lab':'Media & Vision','memory-vault':'Memory Vault',tasks:'Tasks & Reminders',profile:'User Profile',settings:'System Settings'};
  const title=document.getElementById('active-screen-title'); if(title)title.textContent=titles[screenId]||'Bosompem AI';
  if(screenId==='memory-vault')renderMemoryList();
  if(screenId==='projects')renderProjects();
  if(screenId==='tasks')renderReminders();
  if(screenId==='profile'){loadSavedSettings();updateProfilePreview();updateProfileStatus();}
}
function toggleNavDrawer(){
  const drawer=document.getElementById('nav-drawer');
  if(drawer?.classList.contains('open'))closeNavDrawer();else openNavDrawer();
}
function switchScreenFromDrawer(id){openScreen(id);closeNavDrawer();}

function autoExpandTextarea(el){if(!el)return;el.style.height='24px';el.style.height=Math.min(el.scrollHeight,120)+'px';}
function handleTextareaKeyDown(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();handleChatSubmit();}}

function createNewChatSession(){
  const s={id:'session-'+Date.now(),title:'New Conversation',messages:[],createdAt:new Date().toISOString()};
  state.sessions.unshift(s);saveJSON(STORAGE.sessions,state.sessions);loadSession(s.id);
}
function getActiveSession(){return state.sessions.find(s=>s.id===state.activeSessionId);}
function loadSession(id){
  state.activeSessionId=id;
  const s=getActiveSession(),hero=document.getElementById('welcome-hero'),box=document.getElementById('chat-messages-container');
  if(!s||!s.messages.length){
    if(hero)hero.style.display='flex';
    if(box){box.style.display='none';box.innerHTML='';}
  } else {
    if(hero)hero.style.display='none';
    if(box)box.style.display='flex';
    renderMessages();
  }
  updateSendButton();
}
function saveSessions(){saveJSON(STORAGE.sessions,state.sessions);}

async function sendChatMessage(text,imageData=null){
  if(state.isSending)return;
  text=(text||'').trim();
  if(!text && !imageData)return;
  if(!state.apiKey){alert('Add your Gemini API key in System Settings first.');openScreen('settings');return;}
  const session=getActiveSession(); if(!session)return;
  state.isSending=true;

  if(!text)text='Please analyze the attached image.';
  if(!session.messages.length)session.title=text.length>32?text.slice(0,32)+'…':text;
  document.getElementById('welcome-hero')?.style.setProperty('display','none');
  const box=document.getElementById('chat-messages-container'); if(box)box.style.display='flex';

  if(/^remember(?: that)?\s+/i.test(text)){
    const fact=text.replace(/^remember(?: that)?\s+/i,'').trim();
    await memoryEngine.storeMemory(fact);
  }

  session.messages.push({role:'user',text,createdAt:new Date().toISOString()});
  saveSessions();renderMessages();

  let memoryContext='';
  if(state.memoryMode){
    const memories=await memoryEngine.retrieveRelevant(text);
    if(memories.length)memoryContext=`Relevant user memory (use only when helpful): ${memories.join(' | ')}\n`;
  }

  const complex=state.autonomy!=='ask' || state.proactive || text.length>100;
  if(complex)renderAgentSteps(['Understand objective','Check memory and context','Select available capabilities','Execute or prepare permitted actions','Report result']);

  setVoiceState('THINKING');
  const thinkingId=appendThinkingIndicator();
  const input=document.getElementById('chat-input');if(input){input.value='';autoExpandTextarea(input);}
  clearSelectedImage();

  const contents=session.messages.map((m,i)=>{
    const parts=[{text:(i===session.messages.length-1&&m.role==='user'?memoryContext:'')+m.text}];
    if(i===session.messages.length-1&&imageData){
      const comma=imageData.indexOf(',');
      const meta=imageData.slice(0,comma),data=imageData.slice(comma+1);
      const mime=(meta.match(/data:([^;]+)/)||[])[1]||'image/jpeg';
      parts.push({inline_data:{mime_type:mime,data}});
    }
    return {role:m.role==='assistant'?'model':'user',parts};
  });

  try{
    state.activeRequestController=new AbortController();
    const endpoint=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(state.model)}:generateContent?key=${encodeURIComponent(state.apiKey)}`;
    const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},signal:state.activeRequestController.signal,body:JSON.stringify({
      contents,systemInstruction:{parts:[{text:SYSTEM_INSTRUCTION}]},
      generationConfig:{temperature:.55,topP:.9,maxOutputTokens:4096}
    })});
    const data=await response.json();
    removeThinkingIndicator(thinkingId);hideAgentSteps();

    if(!response.ok||data.error){
      throw new Error(data.error?.message||`Gemini request failed (${response.status})`);
    }
    const reply=(data.candidates?.[0]?.content?.parts||[]).map(p=>p.text||'').join('').trim()||'I did not receive a usable response.';
    session.messages.push({role:'assistant',text:reply,createdAt:new Date().toISOString()});
    saveSessions();renderMessages();
    if(state.isLiveVoiceActive||state.activeScreen==='live-voice')speakText(reply);else setVoiceState('IDLE');
  }catch(err){
    removeThinkingIndicator(thinkingId);hideAgentSteps();
    if(err?.name==='AbortError')return;
    session.messages.push({role:'assistant',text:`I couldn't complete that request.\n\n**Reason:** ${err.message||'Connection error.'}`,createdAt:new Date().toISOString()});
    saveSessions();renderMessages();setVoiceState('IDLE');
  }finally{
    state.isSending=false;
    state.activeRequestController=null;
    updateSendButton();
  }
}

function handleChatSubmit(){const input=document.getElementById('chat-input');if(input)sendChatMessage(input.value,state.selectedImageData);}
function usePromptPreset(type){
  const input=document.getElementById('chat-input');if(!input)return;
  const prompts={code:'Help me build, debug or improve this:',research:'Research and explain this clearly:',remember:'Remember this about me:'};
  input.value=prompts[type]||'';autoExpandTextarea(input);input.focus();
}
function webSearchFallback(){
  const q=document.getElementById('chat-input')?.value.trim();
  if(!q)return alert('Enter a search query first.');
  window.open(`https://www.google.com/search?q=${encodeURIComponent(q)}`,'_blank','noopener');
}

function handleChatImageUpload(e){
  const file=e.target.files?.[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=ev=>{
    state.selectedImageData=ev.target.result;
    const img=document.getElementById('attachment-preview-image');const box=document.getElementById('attachment-preview');
    if(img)img.src=state.selectedImageData;if(box)box.classList.remove('hidden');
  };
  reader.readAsDataURL(file);e.target.value='';
}
function clearSelectedImage(){state.selectedImageData=null;document.getElementById('attachment-preview')?.classList.add('hidden');updateSendButton();}

function renderMessages(){
  const box=document.getElementById('chat-messages-container'),session=getActiveSession();if(!box||!session)return;
  box.innerHTML=session.messages.map((m,i)=>{
    const body=m.role==='assistant'?formatMarkdown(m.text):escapeHtml(m.text).replace(/\n/g,'<br>');
    const actions=m.role==='assistant'?`<div class="bubble-actions">
      <button class="btn-bubble-action" onclick="speakMessage(${i})"><i class="fa-solid fa-volume-high"></i> Speak</button>
      <button class="btn-bubble-action" onclick="copyMessage(${i})"><i class="fa-solid fa-copy"></i> Copy</button>
    </div>`:'';
    return `<div class="chat-bubble ${m.role}"><div class="bubble-content">${body}${actions}</div></div>`;
  }).join('');
  scrollToBottom();
}
function speakMessage(i){const s=getActiveSession();if(s?.messages[i])speakText(s.messages[i].text);}
async function copyMessage(i){const s=getActiveSession();if(!s?.messages[i])return;try{await navigator.clipboard.writeText(s.messages[i].text);alert('Copied.');}catch{alert('Copy is not available here.');}}
function appendThinkingIndicator(){
  const box=document.getElementById('chat-messages-container');if(!box)return null;
  const id='thinking-'+Date.now();box.insertAdjacentHTML('beforeend',`<div id="${id}" class="chat-bubble assistant"><div class="bubble-content">Thinking…</div></div>`);scrollToBottom();return id;
}
function removeThinkingIndicator(id){if(id)document.getElementById(id)?.remove();}
function scrollToBottom(){const b=document.getElementById('chat-messages-container');if(b)b.scrollTop=b.scrollHeight;}

function formatMarkdown(text){
  let s=escapeHtml(text);
  s=s.replace(/```([\s\S]*?)```/g,(_,code)=>`<pre><code>${code.trim()}</code></pre>`);
  s=s.replace(/`([^`]+)`/g,'<code>$1</code>');
  s=s.replace(/^###\s+(.*)$/gm,'<h4>$1</h4>').replace(/^##\s+(.*)$/gm,'<h3>$1</h3>').replace(/^#\s+(.*)$/gm,'<h2>$1</h2>');
  s=s.replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/__(.*?)__/g,'<strong>$1</strong>');
  s=s.replace(/^\s*[-*]\s+(.*)$/gm,'<li>$1</li>');
  s=s.replace(/(<li>[\s\S]*?<\/li>)/g,'<ul>$1</ul>');
  s=s.replace(/\n{2,}/g,'</p><p>').replace(/\n/g,'<br>');
  if(!s.startsWith('<pre>')&&!s.startsWith('<h'))s='<p>'+s+'</p>';
  return s;
}
function escapeHtml(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

function setVoiceState(newState){
  state.voiceState=newState;
  const orb=document.getElementById('voice-orb'),icon=document.getElementById('orb-icon'),bar=document.getElementById('speech-state-bar'),status=document.getElementById('voice-status-title');
  if(orb)orb.className=`voice-orb ${newState.toLowerCase()}`;
  if(icon)icon.className=newState==='LISTENING'?'fa-solid fa-microphone':newState==='THINKING'?'fa-solid fa-circle-notch fa-spin':newState==='SPEAKING'?'fa-solid fa-volume-high':'fa-solid fa-microphone';
  if(bar)bar.classList.toggle('hidden',newState!=='SPEAKING');
  if(status)status.textContent={IDLE:'Live Voice Ready',LISTENING:'Listening…',THINKING:'Thinking…',SPEAKING:'Speaking…'}[newState]||'Live Voice';
}
function initVoiceEngines(){
  if(!SpeechRecognition)return;
  liveRecognition=new SpeechRecognition();
  liveRecognition.continuous=false;
  liveRecognition.interimResults=true;
  liveRecognition.lang='en-US';
  liveRecognition.maxAlternatives=1;
  liveRecognition.onstart=()=>setVoiceState('LISTENING');
  liveRecognition.onresult=e=>{
    let transcript='';
    for(let i=e.resultIndex;i<e.results.length;i++)transcript+=e.results[i][0].transcript;
    const card=document.getElementById('voice-live-transcript');
    if(card)card.textContent=transcript.trim()||'Listening…';
    const last=e.results[e.results.length-1];
    if(last?.isFinal&&transcript.trim()){
      state.voicePendingTranscript=transcript.trim();
      setVoiceState('THINKING');
      try{liveRecognition.stop();}catch{}
      sendChatMessage(state.voicePendingTranscript);
    }
  };
  liveRecognition.onerror=e=>{
    const recoverable=['no-speech','aborted','audio-capture'];
    if(state.isLiveVoiceActive){
      if(e.error==='not-allowed'||e.error==='service-not-allowed'){
        state.isLiveVoiceActive=false;
        updateLiveVoiceButton();
        setVoiceState('IDLE');
        const sub=document.getElementById('voice-status-sub');
        if(sub)sub.textContent='Microphone access was blocked. Allow microphone access for this site and try again.';
      } else if(recoverable.includes(e.error)) setVoiceState('IDLE');
    }
  };
  liveRecognition.onend=()=>{
    if(!state.isLiveVoiceActive)return setVoiceState('IDLE');
    if(state.isSending||state.voiceState==='SPEAKING'||state.voiceState==='THINKING')return;
    setTimeout(()=>startLiveRecognition(),450);
  };

  voiceNoteRecognition=new SpeechRecognition();
  voiceNoteRecognition.continuous=true;
  voiceNoteRecognition.interimResults=true;
  voiceNoteRecognition.lang='en-US';
  voiceNoteRecognition.onstart=()=>{const b=document.getElementById('voice-note-btn');if(b)b.classList.add('recording');};
  voiceNoteRecognition.onresult=e=>{
    let transcript='';
    for(let i=0;i<e.results.length;i++)transcript+=e.results[i][0].transcript+' ';
    const input=document.getElementById('chat-input');
    if(input){input.value=transcript.trim();autoExpandTextarea(input);updateSendButton();}
  };
  voiceNoteRecognition.onend=()=>{
    if(state.isVoiceNoteRecording){try{voiceNoteRecognition.start();}catch{}}
    else document.getElementById('voice-note-btn')?.classList.remove('recording');
  };
   
}
function startLiveRecognition(){
  if(!state.isLiveVoiceActive||!liveRecognition||state.isSending||state.voiceState==='SPEAKING')return;
  try{liveRecognition.start();}catch{}
}
function updateLiveVoiceButton(){
  const btn=document.getElementById('live-voice-toggle-btn');
  if(!btn)return;
  btn.innerHTML=state.isLiveVoiceActive?'<i class="fa-solid fa-stop"></i> Stop Live Mode':'<i class="fa-solid fa-microphone"></i> Start Live Mode';
  btn.classList.toggle('active',state.isLiveVoiceActive);
}
function toggleLiveVoiceMode(){
  if(!SpeechRecognition)return alert('Live Voice is not supported by this browser. Try Chrome on Android.');
  state.isLiveVoiceActive=!state.isLiveVoiceActive;
  updateLiveVoiceButton();
  const sub=document.getElementById('voice-status-sub');
  if(state.isLiveVoiceActive){
    stopSpeechPlayback();
    if(sub)sub.textContent='Listening continuously. Speak naturally and pause when you are finished.';
    setVoiceState('LISTENING');
    setTimeout(()=>startLiveRecognition(),120);
  }else{
    try{liveRecognition.stop();}catch{}
    stopSpeechPlayback();
    setVoiceState('IDLE');
    if(sub)sub.textContent='Live Voice is paused. Tap Start Live Mode to continue.';
  }
}

function toggleVoiceNoteRecording(){
  if(!SpeechRecognition)return alert('Speech recognition is unavailable in this browser.');
  state.isVoiceNoteRecording=!state.isVoiceNoteRecording;
  const btn=document.getElementById('voice-note-btn');if(btn)btn.style.color=state.isVoiceNoteRecording?'var(--accent-rose)':'var(--text-sub)';
  if(state.isVoiceNoteRecording){try{voiceNoteRecognition.start();}catch{}}else{try{voiceNoteRecognition.stop();}catch{}}
}
function speakText(rawText){
  if(!('speechSynthesis' in window))return;
  const clean=SpeechSanitizer.cleanTextForSpeech(rawText);if(!clean)return;
  speechSynthesis.cancel();
  const u=new SpeechSynthesisUtterance(clean);
  const voices=speechSynthesis.getVoices();
  const male=voices.find(v=>/male|david|mark|guy|daniel|alex|fred|tom/i.test((v.name||'')+' '+(v.voiceURI||''))) || voices.find(v=>/^en/i.test(v.lang));
  if(male)u.voice=male;
  u.rate=1.12;u.pitch=.82;u.volume=1;
  u.onstart=()=>setVoiceState('SPEAKING');
  u.onend=()=>{
    if(state.isLiveVoiceActive){
      setVoiceState('IDLE');
      setTimeout(()=>startLiveRecognition(),450);
    } else setVoiceState('IDLE');
  };
  u.onerror=()=>setVoiceState('IDLE');
  speechSynthesis.speak(u);
}
function stopSpeechPlayback(){if('speechSynthesis'in window)speechSynthesis.cancel();setVoiceState('IDLE');}
if('speechSynthesis' in window)window.speechSynthesis.onvoiceschanged=()=>window.speechSynthesis.getVoices();

function updateSendButton(){
  const btn=document.getElementById('send-btn');if(!btn)return;
  const input=document.getElementById('chat-input');
  const hasText=Boolean(input?.value.trim()||state.selectedImageData);
  if(state.isSending){btn.innerHTML='<i class="fa-solid fa-stop"></i>';btn.title='Stop';btn.disabled=false;btn.classList.add('stop-mode');}
  else{btn.innerHTML='<i class="fa-solid fa-arrow-up"></i>';btn.title='Send';btn.disabled=!hasText;btn.classList.remove('stop-mode');}
}
function stopGeneration(){
  if(state.activeRequestController)state.activeRequestController.abort();
  stopSpeechPlayback();
  state.isSending=false;state.activeRequestController=null;
  setVoiceState(state.isLiveVoiceActive?'IDLE':'IDLE');
  updateSendButton();
}
function toggleAttachmentMenu(){
  state.attachmentMenuOpen=!state.attachmentMenuOpen;
  const menu=document.getElementById('attachment-menu'),btn=document.getElementById('plus-btn');
  if(menu){menu.classList.toggle('open',state.attachmentMenuOpen);menu.setAttribute('aria-hidden',String(!state.attachmentMenuOpen));}
  if(btn){btn.classList.toggle('open',state.attachmentMenuOpen);btn.setAttribute('aria-expanded',String(state.attachmentMenuOpen));}
}
function closeAttachmentMenu(){if(state.attachmentMenuOpen){state.attachmentMenuOpen=false;document.getElementById('attachment-menu')?.classList.remove('open');document.getElementById('plus-btn')?.classList.remove('open');document.getElementById('plus-btn')?.setAttribute('aria-expanded','false');}}
function triggerChatImage(mode='gallery'){
  closeAttachmentMenu();
  const input=document.getElementById('chat-image-input');if(!input)return;
  input.setAttribute('accept','image/*');
  if(mode==='camera')input.setAttribute('capture','environment');else input.removeAttribute('capture');
  input.click();
}
async function triggerScreenshot(){
  closeAttachmentMenu();
  if(!navigator.mediaDevices?.getDisplayMedia)return alert('Screen capture is not supported by this browser.');
  try{
    const stream=await navigator.mediaDevices.getDisplayMedia({video:{displaySurface:'browser'},audio:false});
    const video=document.createElement('video');video.srcObject=stream;video.muted=true;await video.play();
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    const canvas=document.createElement('canvas');canvas.width=video.videoWidth||window.innerWidth;canvas.height=video.videoHeight||window.innerHeight;
    canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
    stream.getTracks().forEach(t=>t.stop());
    state.selectedImageData=canvas.toDataURL('image/jpeg',.88);
    const img=document.getElementById('attachment-preview-image'),box=document.getElementById('attachment-preview');
    if(img)img.src=state.selectedImageData;if(box)box.classList.remove('hidden');updateSendButton();
  }catch(error){if(error?.name!=='AbortError')alert('Screen capture was cancelled or unavailable.');}
}
function attachLocation(){
  closeAttachmentMenu();
  if(!navigator.geolocation)return alert('Location is not supported by this browser.');
  navigator.geolocation.getCurrentPosition(pos=>{
    const {latitude,longitude,accuracy}=pos.coords;
    const input=document.getElementById('chat-input');
    if(input){input.value=`My current location is approximately ${latitude.toFixed(5)}, ${longitude.toFixed(5)} (accuracy ${Math.round(accuracy)}m). Help me use this location.`;autoExpandTextarea(input);updateSendButton();input.focus();}
  },err=>alert(err.code===1?'Location permission was denied.':'Unable to get your location.'),{enableHighAccuracy:true,timeout:10000,maximumAge:60000});
}
function initSwipeNavigation(){
  const root=document.querySelector('.phone-container');if(!root)return;
  root.addEventListener('touchstart',e=>{if(e.touches.length!==1)return;state.touchStartX=e.touches[0].clientX;state.touchStartY=e.touches[0].clientY;},{passive:true});
  root.addEventListener('touchend',e=>{
    if(e.changedTouches.length!==1)return;
    const x=e.changedTouches[0].clientX,y=e.changedTouches[0].clientY,dx=x-state.touchStartX,dy=y-state.touchStartY;
    if(Math.abs(dx)<55||Math.abs(dx)<Math.abs(dy)*1.25)return;
    const drawer=document.getElementById('nav-drawer');
    if(dx>0 && state.touchStartX<38 && !drawer?.classList.contains('open')){openNavDrawer();}
    else if(dx<0 && drawer?.classList.contains('open')){closeNavDrawer();}
  },{passive:true});
  document.addEventListener('click',e=>{const menu=document.getElementById('attachment-menu'),btn=document.getElementById('plus-btn');if(state.attachmentMenuOpen&&menu&&!menu.contains(e.target)&&btn&&!btn.contains(e.target))closeAttachmentMenu();});
}
function openNavDrawer(){document.getElementById('nav-drawer')?.classList.add('open');document.getElementById('nav-overlay')?.classList.add('active');}
function closeNavDrawer(){document.getElementById('nav-drawer')?.classList.remove('open');document.getElementById('nav-overlay')?.classList.remove('active');}
function renderAgentSteps(steps){
  const card=document.getElementById('agent-planner-card'),list=document.getElementById('agent-steps-list');if(!card||!list)return;
  list.innerHTML=steps.map((s,i)=>`<div class="agent-step-item"><i class="fa-solid fa-circle-notch fa-spin"></i> Step ${i+1}: ${escapeHtml(s)}</div>`).join('');
  card.classList.remove('hidden');
}
function hideAgentSteps(){document.getElementById('agent-planner-card')?.classList.add('hidden');}

function handleImageUpload(e){
  const file=e.target.files?.[0];if(!file)return;const reader=new FileReader();
  reader.onload=ev=>{state.selectedImageData=ev.target.result;const img=document.getElementById('lab-image-preview'),box=document.getElementById('image-preview-box');if(img)img.src=state.selectedImageData;if(box)box.classList.remove('hidden');};
  reader.readAsDataURL(file);e.target.value='';
}
function processMediaLabTask(){
  const prompt=document.getElementById('media-prompt-input')?.value.trim();
  if(!state.selectedImageData&&!prompt)return alert('Select an image or enter an instruction.');
  const q=prompt||'Analyze this image in detail.';
  openScreen('chat');sendChatMessage(`[Vision Workspace] ${q}`,state.selectedImageData);
}

async function addCustomMemory(){
  const input=document.getElementById('memory-add-input');if(!input?.value.trim())return;
  await memoryEngine.storeMemory(input.value.trim());input.value='';renderMemoryList();
}
async function renderMemoryList(){
  const list=document.getElementById('memory-items-list');if(!list)return;
  const memories=await memoryEngine.getAllMemories();
  list.innerHTML=memories.length?memories.map(m=>`<div class="task-item"><div><span>${escapeHtml(m.fact)}</span><small>${new Date(m.date).toLocaleString()}</small></div><button class="btn-icon-danger" onclick="deleteMemoryItem('${m.id}')"><i class="fa-solid fa-trash"></i></button></div>`).join(''):'<div class="empty-state">No facts stored in long-term memory.</div>';
}
async function deleteMemoryItem(id){await memoryEngine.deleteMemory(id);renderMemoryList();}

function addReminder(){
  const title=prompt('What should Bosompem remind you about?');if(!title?.trim())return;
  const when=prompt('When? Example: tomorrow 09:00 or 2026-10-10 18:30');if(!when?.trim())return;
  state.reminders.unshift({id:'rem_'+Date.now(),title:title.trim(),when:when.trim(),createdAt:new Date().toISOString()});saveJSON(STORAGE.reminders,state.reminders);renderReminders();
}
function renderReminders(){
  const list=document.getElementById('full-reminders-list');if(!list)return;
  list.innerHTML=state.reminders.length?state.reminders.map(r=>`<div class="task-item"><div><strong>${escapeHtml(r.title)}</strong><small>${escapeHtml(r.when)}</small></div><button class="btn-icon-danger" onclick="deleteReminder('${r.id}')"><i class="fa-solid fa-trash"></i></button></div>`).join(''):'<div class="empty-state">No scheduled reminders yet.</div>';
}
function deleteReminder(id){state.reminders=state.reminders.filter(r=>r.id!==id);saveJSON(STORAGE.reminders,state.reminders);renderReminders();}

function createProject(){
  const name=prompt('Project name');if(!name?.trim())return;
  const description=prompt('What is the project goal?')||'';
  state.projects.unshift({id:'project_'+Date.now(),name:name.trim(),description:description.trim(),status:'Active',updatedAt:new Date().toISOString()});
  saveJSON(STORAGE.projects,state.projects);renderProjects();openScreen('projects');
}
function renderProjects(){
  const list=document.getElementById('projects-list');if(!list)return;
  list.innerHTML=state.projects.length?state.projects.map(p=>`<div class="project-card" onclick="continueProject('${p.id}')"><h3>${escapeHtml(p.name)}</h3><p>${escapeHtml(p.description||'No description yet.')}</p><div class="project-meta"><span class="status-pill">${escapeHtml(p.status)}</span><span class="status-pill">${new Date(p.updatedAt).toLocaleDateString()}</span></div></div>`).join(''):'<div class="empty-state">No projects yet. Create one and tell Bosompem to continue it later.</div>';
}
function continueProject(id){
  const p=state.projects.find(x=>x.id===id);if(!p)return;
  openScreen('chat');const input=document.getElementById('chat-input');if(input){input.value=`Continue the project "${p.name}". Project goal: ${p.description||'not specified'}. Review the context you have and tell me the best next action.`;autoExpandTextarea(input);input.focus();}
}

function updateProfilePreview(){
  const name=(document.getElementById('user-name-input')?.value||state.userName||'Your Profile').trim();
  const role=(document.getElementById('user-role-input')?.value||state.profileRole||'').trim();
  const title=document.getElementById('profile-display-name');if(title)title.textContent=name||'Your Profile';
  const line=document.getElementById('profile-profile-line');if(line)line.textContent=role||'Bosompem is personalized for you.';
  const avatar=document.getElementById('profile-avatar');if(avatar)avatar.textContent=(name||'B').split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase();
  const completion=[name,role,(document.getElementById('user-bio-input')?.value||state.profileBio||'').trim()].filter(Boolean).length;
  const pct=Math.round(40+(completion/3)*60);
  const val=document.getElementById('profile-completion-value');if(val)val.textContent=pct+'%';
  const bar=document.getElementById('profile-completion-bar');if(bar)bar.style.width=pct+'%';
}
function updateProfileStatus(){
  const mem=document.getElementById('profile-memory-status');if(mem)mem.textContent=state.memoryMode?'On':'Off';
  const pro=document.getElementById('profile-proactive-status');if(pro)pro.textContent=state.proactive?'On':'Off';
}
function saveUserProfile(){
  const name=(document.getElementById('user-name-input')?.value||'').trim();
  const role=(document.getElementById('user-role-input')?.value||'').trim();
  const bio=(document.getElementById('user-bio-input')?.value||'').trim();
  state.userName=name;state.profileRole=role;state.profileBio=bio;
  localStorage.setItem(STORAGE.userName,name);localStorage.setItem(STORAGE.userRole,role);localStorage.setItem(STORAGE.userBio,bio);
  updateGreeting();updateProfileStatus();
  const btn=document.querySelector('#screen-profile .primary-btn');
  if(btn){const old=btn.innerHTML;btn.innerHTML='<i class="fa-solid fa-check"></i> Saved';setTimeout(()=>{btn.innerHTML=old;},1200);}
}
function switchModel(model){state.model=model;localStorage.setItem(STORAGE.model,model);}
function saveSettings(){
  const key=document.getElementById('api-key')?.value.trim();if(key){state.apiKey=key;localStorage.setItem(STORAGE.apiKey,key);}
  state.memoryMode=!!document.getElementById('memory-context-toggle')?.checked;
  state.proactive=!!document.getElementById('proactive-toggle')?.checked;
  state.autonomy=document.getElementById('autonomy-level')?.value||'ask';
  localStorage.setItem(STORAGE.memoryMode,state.memoryMode);
  localStorage.setItem(STORAGE.proactive,state.proactive);
  localStorage.setItem(STORAGE.autonomy,state.autonomy);
  alert('Bosompem preferences saved.');
}
function loadSavedSettings(){
  const key=document.getElementById('api-key');if(key)key.value=state.apiKey;
  const model=document.getElementById('model-select');if(model)model.value=state.model;
  const name=document.getElementById('user-name-input');if(name)name.value=state.userName;
  const role=document.getElementById('user-role-input');if(role)role.value=state.profileRole;
  const bio=document.getElementById('user-bio-input');if(bio)bio.value=state.profileBio;
  updateProfileStatus();updateProfilePreview();
  const mem=document.getElementById('memory-context-toggle');if(mem)mem.checked=state.memoryMode;
  const pro=document.getElementById('proactive-toggle');if(pro)pro.checked=state.proactive;
  const auto=document.getElementById('autonomy-level');if(auto)auto.value=state.autonomy;
  updateGreeting();
}

/* Permissioned device bridge.
   The web app can call a future native Android wrapper without
   pretending it has root access. */
const DeviceBridge={
  available:()=>Boolean(window.BosompemNative),
  async execute(action,payload={}){
    if(!this.available())return {ok:false,reason:'Native Android bridge not connected.',action,payload};
    try{return await window.BosompemNative.execute(action,payload);}
    catch(error){return {ok:false,reason:error.message,action};}
  }
};

window.Bosompem={state,memoryEngine,DeviceBridge,sendChatMessage,openScreen};
       
