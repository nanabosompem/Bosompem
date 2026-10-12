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

WEB RESEARCH:
When current facts, prices, recent events, current availability, or up-to-date information matter,
use the provided Google Search grounding tool when available. Distinguish sourced facts from inference
and do not invent citations or claim you searched if search grounding was unavailable.

TASK EXECUTION:
Turn multi-step goals into clear steps. Use only capabilities actually available in this web app.
You may help organize local projects, reminders, and saved memories when the user explicitly asks,
but never claim to send messages, control Android, access private apps, or complete external actions
unless a connected, authorized tool confirms success. Ask before sensitive, irreversible, or external actions.

PERSONALIZATION:
Use relevant memory context discreetly. Newer explicit preferences should take precedence over older ones.
Do not infer sensitive personal traits from unrelated facts.
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
  model:localStorage.getItem(STORAGE.model)||'auto',
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
  voiceRequestPending:false,
  voiceFinalTranscript:'',
  reminderTimer:null
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
  initReminderNotifications();
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
  const drawer = document.getElementById('nav-drawer');
  const overlay = document.getElementById('nav-overlay');
  if (!drawer || !overlay) return;
  const shouldOpen = !drawer.classList.contains('open');
  drawer.classList.toggle('open', shouldOpen);
  overlay.classList.toggle('active', shouldOpen);
  drawer.setAttribute('aria-hidden', String(!shouldOpen));
  overlay.setAttribute('aria-hidden', String(!shouldOpen));
}
function switchScreenFromDrawer(id){openScreen(id);toggleNavDrawer();}

function autoExpandTextarea(el){if(!el)return;el.style.height='24px';el.style.height=Math.min(el.scrollHeight,120)+'px';}
function handleTextareaKeyDown(e){if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();handleChatSubmit();}}

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

function classifyRequest(text) {
  const t = String(text || '').toLowerCase();
  const webResearch = /\b(latest|current|today|tonight|this week|recent|news|price|prices|cost|available|availability|weather|score|standings|compare.*(online|market|options)|research|search the web|look up|find online|source|sources|citation|202[5-9])\b/.test(t);
  const complex = /\b(architecture|debug|debugging|code|program|programming|analy[sz]e|analysis|reasoning|step.by.step|multi.step|plan|strategy|compare|evaluate|design|build|project|research|report|long term|integrate|automation|automate)\b/.test(t) || String(text || '').length > 180;
  return { webResearch, complex };
}

function chooseModelForRequest(text) {
  const kind = classifyRequest(text);
  // Keep the requested latest model for every request; do not silently downgrade.
  return { ...kind, model: 'gemini-3.8-flash' };
}

function addGroundingSources(reply, data) {
  const chunks = data?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  const sources = [];
  for (const chunk of chunks) {
    const uri = chunk?.web?.uri;
    const title = chunk?.web?.title || uri;
    if (uri && /^https?:\/\//i.test(uri) && !sources.some(s => s.uri === uri)) sources.push({ uri, title });
  }
  if (!sources.length) return reply;
  const sourceBlock = '\n\n**Sources**\n' + sources.slice(0, 5).map((s, i) => `${i + 1}. [${String(s.title).replace(/[\[\]]/g, '')}](${s.uri})`).join('\n');
  return /\*\*Sources\*\*/i.test(reply) ? reply : reply + sourceBlock;
}

async function requestGemini({ contents, text, model, allowSearch }) {
  const makeBody = (includeSearch) => {
    const body = {
      contents,
      systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      generationConfig: { temperature: 0.45, topP: 0.9, maxOutputTokens: 2048 }
    };
    if (includeSearch) body.tools = [{ google_search: {} }];
    return body;
  };
  const call = async (targetModel, includeSearch) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(targetModel)}:generateContent`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': state.apiKey },
        body: JSON.stringify(makeBody(includeSearch)),
        signal: controller.signal
         });
      let data;
      try { data = await response.json(); }
      catch { throw new Error(`Google returned an unreadable response (HTTP ${response.status}). Check the connection and try again.`); }
      if (!response.ok || data.error) {
        const msg = data.error?.message || `Gemini request failed (HTTP ${response.status})`;
        const status = data.error?.status || '';
        if (response.status === 400 && /API key|key not valid/i.test(msg)) throw new Error('Your Gemini API key was rejected. Re-enter the key in Settings.');
        if (response.status === 401 || response.status === 403) throw new Error('Gemini denied access. Check that the API key is valid and the Gemini API is enabled for its Google project.');
        if (response.status === 404 || /model.*not found|not supported for generateContent/i.test(msg)) throw new Error(`Google could not find or use model “${targetModel}” for this API key. Confirm the model is available in Google AI Studio. Details: ${msg}`);
        if (response.status === 429) throw new Error('Gemini rate limit or quota reached. Wait briefly or check your Google AI Studio quota.');
        throw new Error(`${msg}${status ? ` (${status})` : ''}`);
      }
      return { data, model: targetModel, searched: includeSearch };
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('Gemini took longer than 90 seconds and the request timed out. Check your connection and try again.');
      if (err instanceof TypeError) throw new Error('Could not reach Google Gemini. Check your internet connection, API access, and browser network restrictions.');
      throw err;
    } finally { clearTimeout(timeout); }
  };
  try {
    return await call(model || 'gemini-3.8-flash', !!allowSearch);
  } catch (err) {
    const msg = String(err.message || '');
    // Search grounding is optional; retry the same latest model without search when grounding is rejected.
    if (allowSearch && /google_search|grounding|search tool|tool.*not supported|invalid argument/i.test(msg)) {
      return await call(model || 'gemini-3.8-flash', false);
    }
    throw err;
  }
}

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

  const routing = chooseModelForRequest(text);
  const complex = state.autonomy !== 'ask' || state.proactive || routing.complex;
  if(complex)renderAgentSteps(['Understand objective','Check relevant memory','Choose the appropriate AI model','Use web research when current facts are needed','Prepare permitted actions and report verified results']);

  setVoiceState('THINKING');
  const thinkingId=appendThinkingIndicator();
  const input=document.getElementById('chat-input');if(input){input.value='';autoExpandTextarea(input);}
  clearSelectedImage();

  // Send only recent conversational context to reduce payload size and latency.
  // Full history remains saved locally; this limits only what is sent per request.
  const recentMessages = session.messages.slice(-12);
  const contents=recentMessages.map((m,i)=>{
    const parts=[{text:(i===recentMessages.length-1&&m.role==='user'?memoryContext:'')+m.text}];
    if(i===recentMessages.length-1&&imageData){
      const comma=imageData.indexOf(',');
      const meta=imageData.slice(0,comma),data=imageData.slice(comma+1);
      const mime=(meta.match(/data:([^;]+)/)||[])[1]||'image/jpeg';
      parts.push({inline_data:{mime_type:mime,data}});
    }
    return {role:m.role==='assistant'?'model':'user',parts};
  });

  try{
    const result = await requestGemini({ contents, text, model: routing.model, allowSearch: routing.webResearch });
    const data = result.data;
    removeThinkingIndicator(thinkingId);hideAgentSteps();

    let reply=(data.candidates?.[0]?.content?.parts||[]).map(p=>p.text||'').join('').trim()||'I did not receive a usable response.';
    reply = addGroundingSources(reply, data);
    if (routing.webResearch && !result.searched) {
      reply += '\n\n*Live search grounding was unavailable for this request, so this answer may not reflect the latest information.*';
    }
    session.messages.push({role:'assistant',text:reply,createdAt:new Date().toISOString()});
    saveSessions();renderMessages();
    if(state.isLiveVoiceActive||state.activeScreen==='live-voice')speakText(reply);else setVoiceState('IDLE');
  }catch(err){
    removeThinkingIndicator(thinkingId);hideAgentSteps();
    session.messages.push({role:'assistant',text:`I couldn’t complete that request.\n\n**What went wrong:** ${err.message||'An unexpected connection error occurred.'}\n\nYour chat history is still saved. You can retry without losing your message.`,createdAt:new Date().toISOString()});
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

function toggleAttachmentMenu(){
  const menu=document.getElementById('attachment-menu'),btn=document.getElementById('plus-btn');
  if(!menu)return;
  const opening=menu.classList.contains('hidden');
  menu.classList.toggle('hidden',!opening);menu.setAttribute('aria-hidden',String(!opening));
  btn?.setAttribute('aria-expanded',String(opening));
}
function triggerChatImage(mode='gallery'){
  const input=document.getElementById('chat-image-input');if(!input)return;
  input.setAttribute('accept','image/*');
  if(mode==='camera')input.setAttribute('capture','environment');else input.removeAttribute('capture');
  input.click();
  const menu=document.getElementById('attachment-menu');menu?.classList.add('hidden');menu?.setAttribute('aria-hidden','true');
  document.getElementById('plus-btn')?.setAttribute('aria-expanded','false');
}
function triggerScreenshot(){
  alert('Screen capture is not available in this browser build. Use Gallery or Camera to attach an image.');
}
function attachLocation(){
  if(!navigator.geolocation){alert('Location is not supported by this browser.');return;}
  navigator.geolocation.getCurrentPosition(pos=>{
    const input=document.getElementById('chat-input');
    if(input){input.value+=` My location: ${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`;autoExpandTextarea(input);}
    openScreen('chat');
  },err=>alert(err.code===1?'Location permission was denied.':'Could not get your location.'),{enableHighAccuracy:false,timeout:8000,maximumAge:60000});
}
function stopGeneration(){
  // Fetch cancellation is not wired into the existing request pipeline; this safely stops speech and resets UI.
  stopSpeechPlayback();state.isSending=false;hideAgentSteps();setVoiceState(state.isLiveVoiceActive?'LISTENING':'IDLE');
  const btn=document.getElementById('send-btn');if(btn)btn.disabled=false;
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
  s=s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,'<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
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
  liveRecognition.continuous=true;liveRecognition.interimResults=true;liveRecognition.lang='en-US';
  liveRecognition.onstart=()=>{if(state.isLiveVoiceActive&&state.voiceState!=='THINKING'&&state.voiceState!=='SPEAKING')setVoiceState('LISTENING');};
  liveRecognition.onresult=e=>{
    let interim='';
    for(let i=e.resultIndex;i<e.results.length;i++){
      const piece=e.results[i][0]?.transcript||'';
      if(e.results[i].isFinal)state.voiceFinalTranscript+=' '+piece;else interim+=' '+piece;
    }
    const full=(state.voiceFinalTranscript+' '+interim).trim();
    const card=document.getElementById('voice-live-transcript');if(card)card.textContent=full||'Listening…';
    // Submit only after the browser finalizes speech; onend handles a final pause without duplicate sends.
    if(e.results[e.results.length-1]?.isFinal)queueLiveVoiceSubmit(650);
  };
  liveRecognition.onerror=e=>{
    if(!state.isLiveVoiceActive)return;
    if(e.error==='not-allowed'||e.error==='service-not-allowed'){
      state.isLiveVoiceActive=false;setVoiceState('IDLE');const b=document.getElementById('live-voice-toggle-btn');if(b)b.innerHTML='<i class="fa-solid fa-microphone"></i><span>Start Live Mode</span>';
      alert('Microphone permission is blocked. Allow microphone access for this site, then try again.');return;
    }
    if(e.error!=='no-speech'&&e.error!=='aborted')console.warn('Live speech recognition:',e.error);
  };
  liveRecognition.onend=()=>{
    if(!state.isLiveVoiceActive)return;
    if(state.voiceState==='THINKING'||state.voiceState==='SPEAKING'||state.voiceRequestPending)return;
    queueLiveVoiceSubmit(180);
    setTimeout(()=>{if(state.isLiveVoiceActive&&!state.voiceRequestPending&&state.voiceState!=='THINKING'&&state.voiceState!=='SPEAKING')try{liveRecognition.start();}catch{}},250);
  };
  voiceNoteRecognition=new SpeechRecognition();
  voiceNoteRecognition.continuous=true;voiceNoteRecognition.interimResults=true;voiceNoteRecognition.lang='en-US';
  voiceNoteRecognition.onresult=e=>{let transcript='';for(let i=0;i<e.results.length;i++)transcript+=e.results[i][0].transcript+' ';const input=document.getElementById('chat-input');if(input){input.value=transcript.trim();autoExpandTextarea(input);}};
  voiceNoteRecognition.onend=()=>{if(state.isVoiceNoteRecording)try{voiceNoteRecognition.start();}catch{}};
}
let liveSubmitTimer=null;
function queueLiveVoiceSubmit(delay=450){
  clearTimeout(liveSubmitTimer);liveSubmitTimer=setTimeout(async()=>{
    const text=state.voiceFinalTranscript.trim();
    if(!text||!state.isLiveVoiceActive||state.voiceRequestPending||state.isSending)return;
    state.voiceFinalTranscript='';state.voiceRequestPending=true;
    try{if(liveRecognition)try{liveRecognition.stop();}catch{};setVoiceState('THINKING');await sendChatMessage(text);}
    finally{state.voiceRequestPending=false;if(state.isLiveVoiceActive&&state.voiceState!=='SPEAKING'&&state.voiceState!=='THINKING')setTimeout(()=>{try{liveRecognition.start();}catch{}},220);}
  },delay);
    }
function toggleLiveVoiceMode(){
  if(!SpeechRecognition)return alert('Live voice requires a browser with SpeechRecognition support. Try Chrome on Android.');
  state.isLiveVoiceActive=!state.isLiveVoiceActive;
  const btn=document.getElementById('live-voice-toggle-btn');
  if(state.isLiveVoiceActive){
    if(!state.apiKey){state.isLiveVoiceActive=false;alert('Add your Gemini API key in System Settings before starting Live Voice.');openScreen('settings');return;}
    if(btn)btn.innerHTML='<i class="fa-solid fa-stop"></i><span>Stop Live Mode</span>';
    state.voiceFinalTranscript='';stopSpeechPlayback();setVoiceState('LISTENING');
    try{liveRecognition.start();}catch(e){state.isLiveVoiceActive=false;setVoiceState('IDLE');if(btn)btn.innerHTML='<i class="fa-solid fa-microphone"></i><span>Start Live Mode</span>';alert('Could not start the microphone. Check browser microphone permission and try again.');}
  }else{
    if(btn)btn.innerHTML='<i class="fa-solid fa-microphone"></i><span>Start Live Mode</span>';
    clearTimeout(liveSubmitTimer);state.voiceFinalTranscript='';try{liveRecognition.stop();}catch{};stopSpeechPlayback();setVoiceState('IDLE');
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
  u.rate=1.08;u.onend=()=>{if(state.isLiveVoiceActive){setVoiceState('LISTENING');setTimeout(()=>{try{liveRecognition.start();}catch{}},180);}else setVoiceState('IDLE');};
  u.onerror=()=>{if(state.isLiveVoiceActive)setVoiceState('LISTENING');else setVoiceState('IDLE');};speechSynthesis.speak(u);
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

async function enableNotifications(){
  if(!('Notification' in window)){alert('This browser does not support notifications.');return false;}
  if(!window.isSecureContext){alert('Notifications require HTTPS. Open Bosompem on its secure GitHub Pages address.');return false;}
  const permission=await Notification.requestPermission();
  if(permission!=='granted'){alert('Notifications are blocked. You can enable them in the browser site settings.');return false;}
  showBrowserNotification('Bosompem notifications enabled','Reminders can notify you while this page is active.');return true;
}
function showBrowserNotification(title,body){
  if(!('Notification' in window)||Notification.permission!=='granted')return false;
  try{if('serviceWorker'in navigator&&navigator.serviceWorker.controller){navigator.serviceWorker.ready.then(reg=>reg.showNotification(title,{body,icon:'./icon-192.png',badge:'./icon-192.png',tag:'bosompem-'+Date.now()})).catch(()=>new Notification(title,{body}));}
    else new Notification(title,{body});return true;}catch(err){console.warn('Notification failed',err);return false;}
}
function initReminderNotifications(){
  if(state.reminderTimer)clearInterval(state.reminderTimer);
  state.reminderTimer=setInterval(()=>{
    const now=Date.now();let changed=false;
    for(const r of state.reminders){const due=r.dueAt?Date.parse(r.dueAt):Date.parse(r.when||'');if(Number.isFinite(due)&&due<=now&&!r.notified){r.notified=true;changed=true;showBrowserNotification('Bosompem reminder',r.title);}}
    if(changed){saveJSON(STORAGE.reminders,state.reminders);renderReminders();}
  },15000);
}
async function generateImage(){
  const prompt=document.getElementById('image-generation-prompt')?.value.trim();
  const status=document.getElementById('image-generation-status');
  const result=document.getElementById('generated-image-result');
  const button=document.getElementById('generate-image-btn');
  if(!prompt){if(status)status.textContent='Describe the image you want to create first.';return;}
  if(!state.apiKey){if(status)status.textContent='Add your Gemini API key in Settings first.';openScreen('settings');return;}
  if(button){button.disabled=true;button.classList.add('is-loading');}
  if(status)status.textContent='Creating your image with Google’s image-generation model…';
  if(result)result.innerHTML='';
  // Current Google image-generation model first; professional model is a capability fallback.
  const candidates=['gemini-3.1-flash-image','gemini-3-pro-image','gemini-2.5-flash-image'];
  let lastError='No image model was available for this API key.';
  try {
    for(const model of candidates){
      try{
        const res=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{
          method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':state.apiKey},
          body:JSON.stringify({contents:[{role:'user',parts:[{text:`Create a polished, high-quality image matching this prompt. Respect the subject, composition, materials, lighting, color palette, and aspect ratio described. Prompt: ${prompt}`}]}],generationConfig:{responseModalities:['TEXT','IMAGE']}})
        });
        let data;try{data=await res.json();}catch{throw new Error(`Image service returned an unreadable response (HTTP ${res.status}).`);}
        if(!res.ok||data.error)throw new Error(data.error?.message||`Image API error ${res.status}`);
        const parts=data.candidates?.[0]?.content?.parts||[];
        const imagePart=parts.find(p=>p.inlineData?.data||p.inline_data?.data);
        const d=imagePart?.inlineData||imagePart?.inline_data;
        if(!d?.data)throw new Error('The model returned text but no image. This model or API key may not have image generation enabled.');
        const mime=d.mimeType||d.mime_type||'image/png';
        const safeMime=/^image\/(png|jpeg|webp)$/i.test(mime)?mime:'image/png';
        if(result){
          const img=document.createElement('img');img.className='generated-image';img.alt='Image generated by Bosompem';img.src=`data:${safeMime};base64,${d.data}`;
          const save=document.createElement('a');save.className='primary-btn';save.textContent='Save generated image';save.download=`bosompem-image-${Date.now()}.${safeMime==='image/jpeg'?'jpg':safeMime==='image/webp'?'webp':'png'}`;save.href=img.src;
          result.append(img,save);
        }
        if(status)status.textContent=`Image created successfully using ${model}.`;
        return;
      }catch(err){
        lastError=err.message||String(err);
        // Continue only when this model is unavailable; quota/key/network errors need user action.
        if(/not found|not supported|not available|model.*unavailable|does not exist/i.test(lastError))continue;
        if(/returned text but no image|no image-generation|image generation.*not enabled/i.test(lastError))continue;
        break;
      }
    }
    if(status)status.textContent=`Image generation failed: ${lastError}`;
  } finally { if(button){button.disabled=false;button.classList.remove('is-loading');} }
}

function parseReminderDate(value){
  const now=new Date();const normalized=value.toLowerCase().trim();
  let m=normalized.match(/^(today|tomorrow)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if(m){let hour=Number(m[2]),minute=Number(m[3]||0);if(m[4]==='pm'&&hour<12)hour+=12;if(m[4]==='am'&&hour===12)hour=0;if(hour>23||minute>59)return null;const d=new Date(now);if(m[1]==='tomorrow')d.setDate(d.getDate()+1);d.setHours(hour,minute,0,0);return d;}
  const parsed=Date.parse(value);return Number.isFinite(parsed)?new Date(parsed):null;
}
function addReminder(){
  const title=prompt('What should Bosompem remind you about?');if(!title?.trim())return;
  const when=prompt('When? Example: tomorrow 09:00 or 2026-10-10 18:30');if(!when?.trim())return;
  const dueAt=parseReminderDate(when.trim());state.reminders.unshift({id:'rem_'+Date.now(),title:title.trim(),when:when.trim(),dueAt:dueAt?dueAt.toISOString():null,notified:false,createdAt:new Date().toISOString()});saveJSON(STORAGE.reminders,state.reminders);renderReminders();
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
  const role=(document.getElementById('user-role-input')?.value||localStorage.getItem('bosompem_user_role')||'').trim();
  const bio=(document.getElementById('user-bio-input')?.value||localStorage.getItem('bosompem_user_bio')||'').trim();
  const title=document.getElementById('profile-display-name');if(title)title.textContent=name||'Your Profile';
  const avatar=document.getElementById('profile-avatar');if(avatar)avatar.textContent=(name||'B').charAt(0).toUpperCase();
  const line=document.getElementById('profile-profile-line');if(line)line.textContent=role||bio||'Bosompem is personalized for you.';
  const completion=document.getElementById('profile-completion-value'),bar=document.getElementById('profile-completion-bar');const pct=40+(name&&name!=='Your Profile'?20:0)+(role?20:0)+(bio?20:0);if(completion)completion.textContent=pct+'%';if(bar)bar.style.width=pct+'%';
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
  const name=document.getElementById('user-name-input');if(name)name.value=state.userName;const role=document.getElementById('user-role-input');if(role)role.value=localStorage.getItem('bosompem_user_role')||'';const bio=document.getElementById('user-bio-input');if(bio)bio.value=localStorage.getItem('bosompem_user_bio')||'';
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

window.Bosompem={state,memoryEngine,DeviceBridge,sendChatMessage,openScreen,classifyRequest,chooseModelForRequest};


   
