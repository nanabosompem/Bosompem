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
  projects: 'bosompem_projects'
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
        if (!db.objectStoreNames.contains('memories')) db.createObjectStore('memories', { keyPath: 'id' });
      };
      request.onsuccess = e => {
        this.db = e.target.result;
        this.db.onversionchange = () => this.db?.close();
        resolve();
      };
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  }

  normalize(text) {
    return String(text || '').normalize('NFKC').toLowerCase()
      .replace(/[’']/g, '')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  tokens(text) {
    const stopWords = new Set([
      'the','and','for','that','this','with','from','have','has','had','are','was','were',
      'you','your','yours','about','into','onto','then','than','them','they','their','there',
      'here','what','when','where','which','while','who','how','why','can','could','would',
      'should','will','just','also','very','more','most','some','any','all','not','but','because',
      'please','remember','user','fact','want','need','am','is','it','my','me','i','a','an','to',
      'of','in','on','at','up','now','do','did','does','was','were','be','been','being','much'
    ]);
    return this.normalize(text).split(' ').filter(token => token.length > 2 && !stopWords.has(token));
  }

  expandTokens(tokens) {
    const groups = [
      ['cheap','affordable','inexpensive','budget','lowcost','lowcosts'],
      ['shoe','shoes','sneaker','sneakers','footwear','trainer','trainers'],
      ['job','work','working','employment','career'],
      ['home','house','residence','apartment','flat'],
      ['phone','mobile','smartphone','device','handset'],
      ['buy','purchase','shopping','shop','get','obtain'],
      ['like','likes','liked','love','loves','loved','enjoy','enjoys','prefer','prefers','preferred','favorite','favourite'],
      ['fast','quick','rapid'],
      ['remember','memory','recall','remind'],
      ['money','cash','income','salary','pay','funds','savings','saving','save','saved'],
      ['laptop','computer','notebook','pc'],
      ['goal','goals','aim','target','plan','plans','planning','intend','intention'],
      ['color','colour','colors','colours'],
      ['now','currently','latest','new','updated'],
      ['want','wants','wanted','wish','wishes','looking']
    ];
    const expanded = new Set(tokens);
    for (const group of groups) {
      if (group.some(word => expanded.has(word))) group.forEach(word => expanded.add(word));
    }
    // Lightweight English word-form normalization for common memory phrasing.
    for (const token of [...expanded]) {
      if (token.endsWith('ies') && token.length > 4) expanded.add(token.slice(0, -3) + 'y');
      if (token.endsWith('ing') && token.length > 5) expanded.add(token.slice(0, -3));
      if (token.endsWith('s') && token.length > 4) expanded.add(token.slice(0, -1));
    }
    return expanded;
  }

  // Detect a narrow, explicit preference subject so newer statements can replace
  // an older statement about the same subject without deleting unrelated facts.
  preferenceKey(fact) {
    const n = this.normalize(fact);
    let match = n.match(/\bmy (?:current )?(?:favorite|favourite) ([a-z]+)\b/);
    if (match) return `favorite:${match[1]}`;
    match = n.match(/\b(?:i|im|i am) (?:currently )?(?:prefer|like|love|dislike|hate) (?:the )?(.+)/);
    if (match) {
      let object = match[1].replace(/\b(now|currently|more|most|better|best|instead|these days)\b/g, ' ').trim();
      const words = this.tokens(object);
      if (words.length) return `preference:${words[words.length - 1]}`;
    }
    return null;
  }

  async storeMemory(fact) {
    const cleanFact = String(fact || '').trim().replace(/\s+/g, ' ');
    if (!this.db || !cleanFact) return null;
    const all = await this.getAllMemories();
    const normalizedFact = this.normalize(cleanFact);
    const duplicate = all.find(item => this.normalize(item.fact) === normalizedFact);
    const newPreferenceKey = this.preferenceKey(cleanFact);
    const replacedPreference = !duplicate && newPreferenceKey
      ? all.find(item => this.preferenceKey(item.fact) === newPreferenceKey)
      : null;
    const now = new Date().toISOString();
    const item = {
      id: duplicate?.id || replacedPreference?.id || 'mem_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      fact: duplicate ? duplicate.fact : cleanFact,
      tokens: this.tokens(duplicate ? duplicate.fact : cleanFact),
      date: duplicate?.date || replacedPreference?.date || now,
      updatedAt: now,
      timesSaved: (duplicate?.timesSaved || 0) + 1
    };
    // When a newer explicit preference replaces an older one, retain the same
    // record ID/date so the Memory Vault stays compatible, but save the new fact.
    if (replacedPreference) {
      item.fact = cleanFact;
      item.tokens = this.tokens(cleanFact);
      item.timesSaved = (replacedPreference.timesSaved || 0) + 1;
    }
    return new Promise(resolve => {
      let tx;
      try {
        tx = this.db.transaction('memories', 'readwrite');
        tx.objectStore('memories').put(item);
        tx.oncomplete = () => resolve(item);
        tx.onerror = () => resolve(null);
        tx.onabort = () => resolve(null);
      } catch { resolve(null); }
    });
  }

  async getAllMemories() {
    if (!this.db) return [];
    return new Promise(resolve => {
      let req;
      try { req = this.db.transaction('memories', 'readonly').objectStore('memories').getAll(); }
      catch { resolve([]); return; }
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  }

  async retrieveRelevant(query) {
    const all = await this.getAllMemories();
    const queryTokens = this.tokens(query);
    if (!queryTokens.length || !all.length) return [];
    const queryExpanded = this.expandTokens(queryTokens);
    const querySet = new Set(queryTokens);
    const normalizedQuery = this.normalize(query);
    const savingIntent = /\b(save|saving|saved|savings|put aside|setting aside|saving up)\b/.test(normalizedQuery);
    const goalIntent = /\b(goal|plan|planning|intend|intending|aim|trying|working toward|saving|save up)\b/.test(normalizedQuery);
    const preferenceIntent = /\b(prefer|favorite|favourite|like|love|dislike|hate|usually|always)\b/.test(normalizedQuery);

    return all.map(memory => {
      const fact = memory.fact || '';
      const normalizedFact = this.normalize(fact);
      const memoryTokens = this.tokens(fact);
      const memoryExpanded = this.expandTokens(memoryTokens);
      const memorySet = new Set(memoryTokens);
      let exactMatches = 0, semanticMatches = 0;
      for (const token of querySet) if (memorySet.has(token)) exactMatches++;
      for (const token of queryExpanded) if (memoryExpanded.has(token)) semanticMatches++;
      const union = new Set([...queryExpanded, ...memoryExpanded]).size || 1;
      const overlap = semanticMatches / union;
      const coverage = semanticMatches / Math.max(1, queryExpanded.size);
      const phraseBonus = normalizedQuery.length > 5 && normalizedFact.includes(normalizedQuery) ? 0.6 : 0;
      const exactBonus = exactMatches ? Math.min(0.5, exactMatches * 0.12) : 0;
      let intentBonus = 0;
      if (savingIntent && /\b(save|saving|saved|savings|money|fund|buy|purchase|goal|plan|laptop|computer)\b/.test(normalizedFact)) intentBonus += 0.48;
      if (goalIntent && /\b(plan|goal|aim|intend|want|wish|trying|working toward|save|saving|buy|purchase)\b/.test(normalizedFact)) intentBonus += 0.18;
      if (preferenceIntent && this.preferenceKey(fact)) intentBonus += 0.12;
      const score = overlap + coverage * 0.55 + exactBonus + phraseBonus + intentBonus;
      return { memory, score, exactMatches, semanticMatches };
    })
      .filter(item => item.score >= 0.22 && (item.semanticMatches > 0 || item.score >= 0.48))
      .sort((a, b) => b.score - a.score || new Date(b.memory.updatedAt || b.memory.date || 0) - new Date(a.memory.updatedAt || a.memory.date || 0))
      .slice(0, 8)
      .map(item => item.memory.fact);
  }

  async deleteMemory(id) {
    if (!this.db) return;
    return new Promise(resolve => {
      try {
        const tx = this.db.transaction('memories', 'readwrite');
        tx.objectStore('memories').delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch { resolve(); }
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
  isSending:false
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
  loadSavedSettings();
  updateGreeting();
  updateClock();
  setInterval(updateClock,30000);
  renderReminders();
  renderMemoryList();
  renderProjects();
  if(!state.sessions.length) createNewChatSession(); else loadSession(state.sessions[0].id);
});

function updateClock(){
  const el=document.getElementById('status-time');
  if(el)el.textContent=new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',hour12:false});
}
function updateGreeting(){
  const el=document.getElementById('dynamic-greeting');
  if(el)el.textContent=`Hello${state.userName?', '+state.userName:''}`;
  const name=document.getElementById('drawer-user-name');
  if(name)name.textContent=state.userName?`Bosompem for ${state.userName}`:'Bosompem Pro';
}

function openScreen(screenId){
  state.activeScreen=screenId;
  document.querySelectorAll('.screen-view').forEach(x=>x.classList.toggle('active',x.id===`screen-${screenId}`));
  document.querySelectorAll('.nav-tab,.menu-item').forEach(x=>x.classList.toggle('active',x.dataset.screen===screenId));
  const titles={chat:'Chat Studio','live-voice':'Live Voice',projects:'Projects','media-lab':'Media & Vision','memory-vault':'Memory Vault',tasks:'Tasks & Reminders',profile:'User Profile',settings:'System Settings'};
  const title=document.getElementById('active-screen-title'); if(title)title.textContent=titles[screenId]||'Bosompem AI';
  if(screenId==='memory-vault')renderMemoryList();
  if(screenId==='projects')renderProjects();
  if(screenId==='tasks')renderReminders();
}
function toggleNavDrawer(){
  document.getElementById('nav-drawer')?.classList.toggle('open');
  document.getElementById('nav-overlay')?.classList.toggle('active');
}
function switchScreenFromDrawer(id){openScreen(id);toggleNavDrawer();}

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
  if(!s||!s.messages.length){if(hero)hero.style.display='flex';if(box){box.style.display='none';box.innerHTML='';}}
  else{if(hero)hero.style.display='none';if(box)box.style.display='flex';renderMessages();}
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
    const endpoint=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(state.model)}:generateContent?key=${encodeURIComponent(state.apiKey)}`;
    const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
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
    session.messages.push({role:'assistant',text:`I couldn't complete that request.\n\n**Reason:** ${err.message||'Connection error.'}`,createdAt:new Date().toISOString()});
    saveSessions();renderMessages();setVoiceState('IDLE');
  }finally{
    state.isSending=false;
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
function clearSelectedImage(){state.selectedImageData=null;document.getElementById('attachment-preview')?.classList.add('hidden');}

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
  liveRecognition.continuous=false;liveRecognition.interimResults=true;liveRecognition.lang='en-US';
  liveRecognition.onstart=()=>setVoiceState('LISTENING');
  liveRecognition.onresult=e=>{
    let transcript='';
    for(let i=e.resultIndex;i<e.results.length;i++)transcript+=e.results[i][0].transcript;
    const card=document.getElementById('voice-live-transcript');if(card)card.textContent=transcript;
    if(e.results[e.results.length-1].isFinal&&transcript.trim())sendChatMessage(transcript);
  };
  liveRecognition.onerror=()=>{if(state.isLiveVoiceActive)setVoiceState('IDLE');};
  liveRecognition.onend=()=>{
    if(state.isLiveVoiceActive&&state.voiceState!=='SPEAKING'&&state.voiceState!=='THINKING'){
      setTimeout(()=>{try{liveRecognition.start();}catch{}},350);
    }else if(!state.isLiveVoiceActive)setVoiceState('IDLE');
  };

  voiceNoteRecognition=new SpeechRecognition();
  voiceNoteRecognition.continuous=true;voiceNoteRecognition.interimResults=true;voiceNoteRecognition.lang='en-US';
  voiceNoteRecognition.onresult=e=>{
    let transcript='';
    for(let i=0;i<e.results.length;i++)transcript+=e.results[i][0].transcript+' ';
    const input=document.getElementById('chat-input');if(input){input.value=transcript.trim();autoExpandTextarea(input);}
  };
  voiceNoteRecognition.onend=()=>{if(state.isVoiceNoteRecording){try{voiceNoteRecognition.start();}catch{}}};
}
function toggleLiveVoiceMode(){
  if(!SpeechRecognition)return alert('Live speech recognition is not supported by this browser.');
  state.isLiveVoiceActive=!state.isLiveVoiceActive;
  const btn=document.getElementById('live-voice-toggle-btn');
  if(state.isLiveVoiceActive){
    if(btn)btn.innerHTML='<i class="fa-solid fa-stop"></i> Stop Live Mode';
    stopSpeechPlayback();try{liveRecognition.start();}catch{}
  }else{
    if(btn)btn.innerHTML='<i class="fa-solid fa-microphone"></i> Start Live Mode';
    try{liveRecognition.stop();}catch{};stopSpeechPlayback();setVoiceState('IDLE');
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
  speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(clean);u.rate=1;u.pitch=1;
  u.onstart=()=>setVoiceState('SPEAKING');
  u.onend=()=>{setVoiceState('IDLE');if(state.isLiveVoiceActive)setTimeout(()=>{try{liveRecognition.start();}catch{}},350);};
  u.onerror=()=>setVoiceState('IDLE');speechSynthesis.speak(u);
}
function stopSpeechPlayback(){if('speechSynthesis'in window)speechSynthesis.cancel();setVoiceState('IDLE');}

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

function saveUserProfile(){
  const input=document.getElementById('user-name-input');state.userName=(input?.value||'').trim();localStorage.setItem(STORAGE.userName,state.userName);updateGreeting();alert('Profile saved.');
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
       
