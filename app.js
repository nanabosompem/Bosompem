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
  activeRequestController:null,
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
  renderFavouriteContacts();
  await memoryEngine.init();
  initVoiceEngines();
  loadSavedSettings();
  initTheme();
  initNotificationSettings();
  initPushSettings();
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
  const titles={chat:'Chat Studio','live-voice':'Live Voice',projects:'Projects','media-lab':'Media & Vision','memory-vault':'Memory Vault',tasks:'Tasks & Reminders',games:'Games Predictions',profile:'User Profile',settings:'System Settings'};
  const title=document.getElementById('active-screen-title'); if(title)title.textContent=titles[screenId]||'Bosompem AI';
        if(screenId==='memory-vault')renderMemoryList();
  if(screenId==='projects')renderProjects();
  if(screenId==='tasks')renderReminders();
  if(screenId==='device-control')refreshDeviceBridgeStatus();
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
  const selected = state.model || 'auto';

  const model = (
    !selected ||
    selected === 'auto' ||
    selected.toLowerCase().includes('automatic')
  )
    ? 'gemini-3.5-flash-lite'
    : selected;

  return { ...kind, model };
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

async function requestGemini({ contents, text, model, allowSearch, signal }) {
  const makeBody = (includeSearch) => {
    const body = {
      contents,
      systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      generationConfig: { temperature: .45, topP: .9, maxOutputTokens: 1024 }
    };
    if (includeSearch) body.tools = [{ google_search: {} }];
    return body;
  };

  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const call = async (targetModel, includeSearch) => {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(targetModel)}:generateContent?key=${encodeURIComponent(state.apiKey)}`;
    let response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(makeBody(includeSearch)),
        signal
      });
    } catch (networkError) {
      if (signal?.aborted || networkError?.name === 'AbortError') {
        throw new DOMException('Request cancelled by the user.', 'AbortError');
      }
      const error = new Error('Network connection failed before Gemini responded. Check your connection and retry.');
      error.status = 0;
      error.transient = true;
      throw error;
    }

    let data = {};
    try { data = await response.json(); }
    catch { data = {}; }
    if (!response.ok || data.error) {
      const error = new Error(data.error?.message || `Gemini request failed (${response.status})`);
      error.status = Number(data.error?.code || response.status);
      error.apiStatus = String(data.error?.status || '');
      error.model = targetModel;
      throw error;
    }
    return { data, model: targetModel, searched: includeSearch };
  };

  const isTransient = error => {
    const status = Number(error?.status || 0);
    const message = String(error?.message || '');
    return error?.transient === true || [408, 429, 500, 502, 503, 504].includes(status) ||
      /UNAVAILABLE|RESOURCE_EXHAUSTED|INTERNAL|DEADLINE_EXCEEDED|temporarily unavailable|high demand|overloaded/i.test(message);
  };
  const isSearchConfigError = error => /google_search|grounding|tool.*not supported|unsupported.*tool|invalid argument/i.test(String(error?.message || ''));

  // First retry transient failures on the selected model with bounded exponential backoff.
  // Only switch models after retrying a transient server/capacity failure; do not mask key or request errors.
  let firstError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await call(model, allowSearch);
    } catch (error) {
      firstError = error;
      if (allowSearch && isSearchConfigError(error)) {
        try { return await call(model, false); }
        catch (noSearchError) { firstError = noSearchError; }
      }
      if (!isTransient(firstError) || attempt === 1) break;
      await wait((attempt === 0 ? 900 : 1800) + Math.floor(Math.random() * 350));
    }
  }

  // A supported stable fallback may recover when the primary model is temporarily overloaded.
  // The fallback is deliberately limited to transient errors and is not a promise of free-tier access.
  if (isTransient(firstError)) {
    const fallbackModel = model === 'gemini-3.6-flash' ? 'gemini-3.5-flash-lite' : 'gemini-3.6-flash';
    try {
      return await call(fallbackModel, allowSearch);
    } catch (fallbackError) {
      if (allowSearch && isSearchConfigError(fallbackError)) {
        try { return await call(fallbackModel, false); }
        catch (noSearchError) { fallbackError = noSearchError; }
      }
      if (isTransient(fallbackError)) {
        await wait(1600 + Math.floor(Math.random() * 400));
        try { return await call(fallbackModel, false); }
        catch (lastError) { throw lastError; }
      }
      throw fallbackError;
    }
  }

  throw firstError;
}

async function sendChatMessage(text,imageData=null){
  if(state.isSending)return;
  text=(text||'').trim();
  if(!text && !imageData)return;
  if(!state.apiKey){alert('Add your Gemini API key in System Settings first.');openScreen('settings');return;}
  const session=getActiveSession(); if(!session)return;
  state.isSending=true;
  const requestController = new AbortController();
  state.activeRequestController = requestController;

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
    const result = await requestGemini({ contents, text, model: routing.model, allowSearch: routing.webResearch, signal: requestController.signal });
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
    if (err?.name === 'AbortError' || requestController.signal.aborted) { setVoiceState(state.isLiveVoiceActive?'LISTENING':'IDLE'); return; }
    session.messages.push({role:'assistant',text:`I couldn't complete that request.\n\n**Reason:** ${err.message||'Connection error.'}`,createdAt:new Date().toISOString()});
    saveSessions();renderMessages();setVoiceState('IDLE');
  }finally{
    if (state.activeRequestController === requestController) state.activeRequestController = null;
    state.isSending=false;
  }
}

function isLikelyDeviceCommand(text){const value=String(text||'').trim();return /^(?:hey\s+)?bosompem[,.! ]*(?:please\s+)?(?:open|launch|call|message|text|send|update|upgrade|navigate|go to|turn on|turn off|share my location)\b/i.test(value)||/^(?:update|upgrade)\s+(?:all\s+)?(?:my\s+)?apps\b/i.test(value);}
function routeDeviceCommand(text,showScreen=true){const input=document.getElementById('device-command-input');if(!input)return false;input.value=String(text||'').replace(/^(?:hey\s+)?bosompem[,.! ]*/i,'').trim();if(showScreen&&state.activeScreen!=='device-control')openScreen('device-control');prepareDeviceCommand();return true;}
function handleChatSubmit(){const input=document.getElementById('chat-input');if(!input)return;const text=input.value;if(!state.selectedImageData&&isLikelyDeviceCommand(text)){input.value='';autoExpandTextarea(input);updateSendButton();routeDeviceCommand(text,true);return;}sendChatMessage(input.value,state.selectedImageData);}
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


function toggleAttachmentMenu() {
  const menu = document.getElementById('attachment-menu');
  const btn = document.getElementById('plus-btn');

  if (!menu) {
    console.error('Bosompem: attachment-menu was not found.');
    return;
  }

  const opening = !menu.classList.contains('open');

  menu.classList.toggle('open', opening);
  menu.classList.toggle('hidden', !opening);
  menu.setAttribute('aria-hidden', String(!opening));

  if (btn) {
    btn.setAttribute('aria-expanded', String(opening));
  }
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
  // Abort the active network request so a late response cannot overwrite the stopped state.
  state.activeRequestController?.abort();
  stopSpeechPlayback();hideAgentSteps();setVoiceState(state.isLiveVoiceActive?'LISTENING':'IDLE');
  const btn=document.getElementById('send-btn');if(btn)btn.disabled=false;
}

function openImageGenerationFromComposer(){
  const menu=document.getElementById('attachment-menu');
  menu?.classList.add('hidden');menu?.setAttribute('aria-hidden','true');
  document.getElementById('plus-btn')?.setAttribute('aria-expanded','false');
  openScreen('media-lab');
  const prompt=document.getElementById('image-generation-prompt');
  if(prompt){prompt.focus();prompt.scrollIntoView({behavior:'smooth',block:'center'});}
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

const BOSOMPEM_VOICE_LANGUAGE_KEY='bosompem_voice_language_v1';
function getRecognitionLanguage(){try{return localStorage.getItem(BOSOMPEM_VOICE_LANGUAGE_KEY)||'en-GB';}catch{return'en-GB';}}
function setRecognitionLanguage(value){const allowed=['en-GB','en-US','en-GH','en-NG'];const selected=allowed.includes(value)?value:'en-GB';try{localStorage.setItem(BOSOMPEM_VOICE_LANGUAGE_KEY,selected);}catch{}if(liveRecognition)liveRecognition.lang=selected;if(voiceNoteRecognition)voiceNoteRecognition.lang=selected;const select=document.getElementById('voice-language-select');if(select)select.value=selected;}
function appendTranscriptOnce(existing,addition){const a=String(existing||'').trim(),b=String(addition||'').trim();if(!b)return a;if(!a)return b;if(a.toLowerCase()===b.toLowerCase())return a;const aw=a.toLowerCase().split(/\s+/),bw=b.toLowerCase().split(/\s+/);let overlap=0;for(let n=Math.min(aw.length,bw.length);n>0;n--){if(aw.slice(-n).join(' ')===bw.slice(0,n).join(' ')){overlap=n;break;}}return (a+' '+b.split(/\s+/).slice(overlap).join(' ')).trim();}

function setVoiceState(newState){
  state.voiceState=newState;
  const orb=document.getElementById('voice-orb'),icon=document.getElementById('orb-icon'),bar=document.getElementById('speech-state-bar'),status=document.getElementById('voice-status-title');
  if(orb)orb.className=`voice-orb ${newState.toLowerCase()}`;
  if(icon)icon.className=newState==='LISTENING'?'fa-solid fa-microphone':newState==='THINKING'?'fa-solid fa-circle-notch fa-spin':newState==='SPEAKING'?'fa-solid fa-volume-high':'fa-solid fa-microphone';
  if(bar)bar.classList.toggle('hidden',newState!=='SPEAKING');
 if(status)status.textContent={IDLE:'Live Voice Ready',LISTENING:'Listening…',THINKING:'Thinking…',SPEAKING:'Speaking…'}[newState]||'Live Voice';
}
let liveSubmitTimer = null;
let liveLastSubmittedText = '';
let liveLastSubmittedAt = 0;
let liveRestartTimer = null;

function initVoiceEngines(){
  if(!SpeechRecognition)return;

  liveRecognition=new SpeechRecognition();
  liveRecognition.continuous=true;
  liveRecognition.interimResults=true;
  liveRecognition.lang=getRecognitionLanguage();

  liveRecognition.onstart=()=>{
    if(state.isLiveVoiceActive && state.voiceState!=='THINKING' && state.voiceState!=='SPEAKING'){
      setVoiceState('LISTENING');
    }
  };

  liveRecognition.onresult=e=>{
    let interim='';
    for(let i=e.resultIndex;i<e.results.length;i++){
      const result=e.results[i];
      const piece=(result[0]?.transcript||'').trim();
      if(!piece)continue;
      if(result.isFinal){
        const marker=`${i}:${piece.toLowerCase()}`;
        if(!state._liveFinalResultMarkers)state._liveFinalResultMarkers=new Set();
        if(!state._liveFinalResultMarkers.has(marker)){
          state._liveFinalResultMarkers.add(marker);
          state.voiceFinalTranscript=appendTranscriptOnce(state.voiceFinalTranscript,piece);
        }
      }else interim=appendTranscriptOnce(interim,piece);
    }
    const full=(state.voiceFinalTranscript+' '+interim).trim();
    const card=document.getElementById('voice-live-transcript');
    if(card)card.textContent=full||'Listening…';
    // Wait for a quiet gap after the latest finalized result. Interim text is preview only.
    if(state.voiceFinalTranscript.trim())queueLiveVoiceSubmit(1450);
  };

  liveRecognition.onerror=e=>{
    if(!state.isLiveVoiceActive)return;
    if(e.error==='not-allowed'||e.error==='service-not-allowed'){
      state.isLiveVoiceActive=false;
      clearTimeout(liveSubmitTimer);
      clearTimeout(liveRestartTimer);
      setVoiceState('IDLE');
      const b=document.getElementById('live-voice-toggle-btn');
      if(b)b.innerHTML='<i class="fa-solid fa-microphone"></i><span>Start Live Mode</span>';
      alert('Microphone permission is blocked. Allow microphone access for this site, then try again.');
      return;
    }
    if(e.error!=='no-speech'&&e.error!=='aborted')console.warn('Live speech recognition:',e.error);
  };

  liveRecognition.onend=()=>{
    if(!state.isLiveVoiceActive)return;
    if(state.voiceState==='THINKING'||state.voiceState==='SPEAKING'||state.voiceRequestPending||state.isSending)return;
    // Do not submit here: onresult is the single submission trigger.
    clearTimeout(liveRestartTimer);
    liveRestartTimer=setTimeout(()=>{
      if(state.isLiveVoiceActive&&!state.voiceRequestPending&&!state.isSending&&state.voiceState!=='THINKING'&&state.voiceState!=='SPEAKING'){
        try{liveRecognition.start();}catch{}
      }
    },350);
  };

  voiceNoteRecognition=new SpeechRecognition();
  voiceNoteRecognition.continuous=true;
  voiceNoteRecognition.interimResults=true;
  voiceNoteRecognition.lang=getRecognitionLanguage();
  voiceNoteRecognition.onresult=e=>{
    let transcript='';
    for(let i=0;i<e.results.length;i++){
      const result=e.results[i];
      const piece=(result[0]?.transcript||'').trim();
      if(piece)transcript=appendTranscriptOnce(transcript,piece);
    }
    const input=document.getElementById('chat-input');
    if(input){input.value=transcript.trim();autoExpandTextarea(input);updateSendButton();}
  };
  voiceNoteRecognition.onerror=e=>{if(e.error==='not-allowed'||e.error==='service-not-allowed'){state.isVoiceNoteRecording=false;const b=document.getElementById('voice-note-btn');if(b)b.style.color='';setDeviceActionStatus?.('Microphone permission was denied. Allow it in browser settings and retry.');}};
  voiceNoteRecognition.onend=()=>{if(state.isVoiceNoteRecording){try{voiceNoteRecognition.start();}catch{}}};
}

function queueLiveVoiceSubmit(delay=900){
  clearTimeout(liveSubmitTimer);
  liveSubmitTimer=setTimeout(async()=>{
    const text=(state.voiceFinalTranscript||'').trim();
    if(!text||!state.isLiveVoiceActive||state.voiceRequestPending||state.isSending)return;

    const now=Date.now();
    if(text===liveLastSubmittedText&&now-liveLastSubmittedAt<7000){
      state.voiceFinalTranscript='';
      state._liveFinalResultMarkers=new Set();
      return;
    }

    liveLastSubmittedText=text;
    liveLastSubmittedAt=now;
    state.voiceFinalTranscript='';
    state._liveFinalResultMarkers=new Set();
    state.voiceRequestPending=true;
    clearTimeout(liveRestartTimer);

    try{
      if(liveRecognition)try{liveRecognition.stop();}catch{}
      setVoiceState('THINKING');
      if(isLikelyDeviceCommand(text)){routeDeviceCommand(text, /\b(message|text|send)\b/i.test(text));setVoiceState('IDLE');}
      else await sendChatMessage(text);
    }finally{
      state.voiceRequestPending=false;
      // Recognition restarts from speech playback's onend, or here if playback did not start.
      if(state.isLiveVoiceActive&&state.voiceState!=='SPEAKING'&&state.voiceState!=='THINKING'){
        clearTimeout(liveRestartTimer);
        liveRestartTimer=setTimeout(()=>{
          if(state.isLiveVoiceActive&&!state.voiceRequestPending&&!state.isSending&&state.voiceState!=='SPEAKING'&&state.voiceState!=='THINKING'){
            try{liveRecognition.start();}catch{}
          }
        },350);
      }
    }
  },delay);
}

function toggleLiveVoiceMode(){
  if(!SpeechRecognition)return alert('Live voice requires a browser with SpeechRecognition support. Try Chrome on Android.');
  state.isLiveVoiceActive=!state.isLiveVoiceActive;
  const btn=document.getElementById('live-voice-toggle-btn');
  if(state.isLiveVoiceActive){
    if(!state.apiKey){state.isLiveVoiceActive=false;alert('Add your Gemini API key in System Settings before starting Live Voice.');openScreen('settings');return;}
    if(btn)btn.innerHTML='<i class="fa-solid fa-stop"></i><span>Stop Live Mode</span>';
    clearTimeout(liveSubmitTimer);
    clearTimeout(liveRestartTimer);
    state.voiceFinalTranscript='';
    state._liveFinalResultMarkers=new Set();
    stopSpeechPlayback();
    setVoiceState('LISTENING');
    try{liveRecognition.start();}catch(e){
      state.isLiveVoiceActive=false;
      setVoiceState('IDLE');
      if(btn)btn.innerHTML='<i class="fa-solid fa-microphone"></i><span>Start Live Mode</span>';
      alert('Could not start the microphone. Check browser microphone permission and try again.');
    }
  }else{
    if(btn)btn.innerHTML='<i class="fa-solid fa-microphone"></i><span>Start Live Mode</span>';
    clearTimeout(liveSubmitTimer);
    clearTimeout(liveRestartTimer);
    state.voiceFinalTranscript='';
    state._liveFinalResultMarkers=new Set();
    try{liveRecognition.stop();}catch{}
    stopSpeechPlayback();
    setVoiceState('IDLE');
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
function showBrowserNotification(title,body,kind='taskUpdates'){
  const prefs=typeof getNotificationPreferences==='function'?getNotificationPreferences():{reminders:true,taskUpdates:true,quietStart:'22:00',quietEnd:'07:00'};
  if(!prefs[kind])return false;
  const now=new Date(),current=now.getHours()*60+now.getMinutes();
  const toMinutes=value=>{const parts=String(value||'').split(':').map(Number);return parts.length===2&&parts.every(Number.isFinite)&&parts[0]>=0&&parts[0]<24&&parts[1]>=0&&parts[1]<60?parts[0]*60+parts[1]:null;};
  const qs=toMinutes(prefs.quietStart),qe=toMinutes(prefs.quietEnd);
  if(qs!==null&&qe!==null&&qs!==qe){const quiet=qs<qe?(current>=qs&&current<qe):(current>=qs||current<qe);if(quiet)return false;}
  if(!('Notification' in window)||Notification.permission!=='granted')return false;
  try{if('serviceWorker'in navigator&&navigator.serviceWorker.controller){navigator.serviceWorker.ready.then(reg=>reg.showNotification(title,{body,tag:'bosompem-'+kind+'-'+Date.now()})).catch(()=>new Notification(title,{body}));}
    else new Notification(title,{body});return true;}catch(err){console.warn('Notification failed',err);return false;}
}
function initReminderNotifications(){
  if(state.reminderTimer)clearInterval(state.reminderTimer);
  state.reminderTimer=setInterval(()=>{
    const now=Date.now();let changed=false;
    for(const r of state.reminders){const due=r.dueAt?Date.parse(r.dueAt):Date.parse(r.when||'');if(Number.isFinite(due)&&due<=now&&!r.notified){r.notified=true;changed=true;showBrowserNotification('Bosompem reminder',r.title,'reminders');}}
    if(changed){saveJSON(STORAGE.reminders,state.reminders);renderReminders();}
  },15000);
}
let imageGenerationController=null;
async function generateImage(){
  const prompt=document.getElementById('image-generation-prompt')?.value.trim();
  const ratio=document.getElementById('image-aspect-ratio')?.value||'1:1';
  const size=document.getElementById('image-size')?.value||'1K';
  const status=document.getElementById('image-generation-status');
  const result=document.getElementById('generated-image-result');
  const button=document.getElementById('generate-image-btn');
  const stopButton=document.getElementById('stop-image-generation-btn');
  if(!prompt){if(status)status.textContent='Add a prompt describing the image first.';return;}
  if(!state.apiKey){if(status)status.textContent='Add your Gemini API key in Settings to generate images.';openScreen('settings');return;}
  if(imageGenerationController){imageGenerationController.abort();}
  imageGenerationController=new AbortController();
  if(button)button.disabled=true;if(stopButton)stopButton.classList.remove('hidden');
  if(status)status.textContent=`Creating a ${ratio} image (${size})…`;
  if(result)result.innerHTML='';
  // Current supported image models use Gemini's GenerateContent endpoint. Model access can vary by API project.
  const candidates=['gemini-3.1-flash-image','gemini-2.5-flash-image'];
  let lastError='No supported image model was available.';
  try{
    for(const model of candidates){
      try{
        const generationConfig={responseModalities:['TEXT','IMAGE'],imageConfig:{aspectRatio:ratio}};
        if(model==='gemini-3.1-flash-image')generationConfig.imageConfig.imageSize=size;
        const res=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{
          method:'POST',signal:imageGenerationController.signal,
          headers:{'Content-Type':'application/json','x-goog-api-key':state.apiKey},
          body:JSON.stringify({contents:[{role:'user',parts:[{text:`Create one original image from this brief. Return an actual image, not only a description. Prompt: ${prompt}`}]}],generationConfig})
        });
        const data=await res.json().catch(()=>({}));
        if(!res.ok)throw new Error(data.error?.message||`Image API error ${res.status}`);
        const parts=data.candidates?.[0]?.content?.parts||[];
        const imagePart=parts.find(p=>p.inlineData?.data||p.inline_data?.data);
        const d=imagePart?.inlineData||imagePart?.inline_data;
        if(!d?.data)throw new Error((parts.find(p=>p.text)?.text)||'The model returned no image. Check model access and API billing/quota.');
        const mime=d.mimeType||d.mime_type||'image/png';
        const ext=mime.includes('jpeg')||mime.includes('jpg')?'jpg':mime.includes('webp')?'webp':'png';
        const src=`data:${mime};base64,${d.data}`;
        if(result){
          const img=document.createElement('img');img.className='generated-image';img.alt='AI-generated image';img.src=src;
          const actions=document.createElement('div');actions.className='generated-image-actions';
          const save=document.createElement('a');save.className='primary-btn';save.href=src;save.download=`bosompem-generated-image.${ext}`;save.textContent='Save image';
          const promptCopy=document.createElement('button');promptCopy.className='secondary-glass-btn';promptCopy.type='button';promptCopy.textContent='Copy prompt';promptCopy.onclick=async()=>{try{await navigator.clipboard.writeText(prompt);if(status)status.textContent='Prompt copied.';}catch{if(status)status.textContent='Clipboard access was blocked by the browser.';}};
          actions.append(save,promptCopy);result.append(img,actions);
        }
        if(status)status.textContent=`Image created with ${model}. Save it to keep a local copy.`;
        return;
      }catch(err){
        if(err.name==='AbortError')throw err;
        lastError=err.message||String(err);
        if(!/quota|billing|permission|not found|not supported|not available|model|unsupported|404|403/i.test(lastError))break;
      }
    }
    throw new Error(lastError);
  }catch(err){
    if(err.name==='AbortError'){if(status)status.textContent='Image generation cancelled.';}
    else{if(status)status.textContent='Image generation failed.';alert(`Bosompem could not generate the image. ${err.message||err}`);}
  }finally{
    imageGenerationController=null;if(button)button.disabled=false;if(stopButton)stopButton.classList.add('hidden');
  }
}
function stopImageGeneration(){if(imageGenerationController)imageGenerationController.abort();}

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
    try{const raw=await window.BosompemNative.execute(action,JSON.stringify(payload||{}));if(typeof raw==='string'){try{return JSON.parse(raw);}catch{return {ok:false,reason:raw,action};}}return raw||{ok:false,reason:'Native bridge returned no result.',action};}
    catch(error){return {ok:false,reason:error.message,action};}
  }
};


let bosompemWakeLock = null;
function setDeviceActionStatus(message, ok=false){
  const el=document.getElementById('device-action-status');
  if(el){el.textContent=message;el.dataset.state=ok?'success':'info';}
  if(state?.isLiveVoiceActive){const live=document.getElementById('voice-live-transcript');if(live)live.textContent=message;}
  if(ok&&document.hidden&&typeof showBrowserNotification==='function')showBrowserNotification('Bosompem task update',message,'taskUpdates');
}
function setPermissionState(id,label){const el=document.getElementById(id);if(el)el.textContent=label;}
async function requestBosompemPermission(kind){
  const status=document.getElementById('permission-center-status');
  const say=(message,ok=false)=>{if(status){status.textContent=message;status.dataset.state=ok?'success':'info';}};
  try{
    if(kind==='microphone'){
      if(!navigator.mediaDevices?.getUserMedia){setPermissionState('permission-mic-state','NOT SUPPORTED');say('Microphone access is not supported in this browser/context. Open the secure HTTPS site in Chrome and try again.');return;}
      const stream=await navigator.mediaDevices.getUserMedia({audio:true});stream.getTracks().forEach(track=>track.stop());
      setPermissionState('permission-mic-state','GRANTED');say('Microphone permission is granted. Listening still depends on browser support and whether the page is active; this does not enable always-listening in the background.',true);return;
    }
    if(kind==='notifications'){
      if(!('Notification' in window)){setPermissionState('permission-notify-state','NOT SUPPORTED');say('Notifications are not supported in this browser.');return;}
      let result=Notification.permission;if(result==='default')result=await Notification.requestPermission();
      setPermissionState('permission-notify-state',result.toUpperCase());say(result==='granted'?'Notifications are allowed. Android or browser settings may still affect delivery.':`Notification permission status: ${result}. You can change it in your browser site settings.`,result==='granted');return;
    }
    if(kind==='location'){
      if(!navigator.geolocation){setPermissionState('permission-location-state','NOT SUPPORTED');say('Location is not supported in this browser.');return;}
      say('Waiting for Android/browser location permission…');
      navigator.geolocation.getCurrentPosition(()=>{setPermissionState('permission-location-state','GRANTED');say('Location permission is granted. Coordinates were not saved by this permission check.',true);},err=>{const label=err.code===1?'DENIED':err.code===2?'UNAVAILABLE':'TIMEOUT';setPermissionState('permission-location-state',label);say(err.code===1?'Location was denied. You can allow it in Android site settings.':`Location check failed: ${err.message}`);},{enableHighAccuracy:false,timeout:12000,maximumAge:60000});return;
    }
  }catch(error){const map={microphone:'permission-mic-state',notifications:'permission-notify-state',location:'permission-location-state'};setPermissionState(map[kind]||'','BLOCKED');say(`${kind} permission was not granted: ${error.message||'request failed'}. Check Android site permissions.`);}
}
function refreshDeviceBridgeStatus(){
  const native=DeviceBridge.available();
  const title=document.getElementById('device-bridge-title');
  const description=document.getElementById('device-bridge-description');
  const pill=document.getElementById('device-bridge-pill');
  if(title)title.textContent=native?'Android bridge detected':'Browser controls ready';
  if(description)description.textContent=native?'An Android bridge is available. Only actions explicitly implemented by the companion will run.':'This web version can use supported browser actions. System-level controls such as Wi-Fi, Bluetooth and flashlight need an Android integration.';
  if(pill)pill.textContent=native?'NATIVE BRIDGE':'WEB MODE';
}
async function runDeviceAction(action){
  const labels={vibrate:'Vibration',fullscreen:'Full screen', 'keep-awake':'Keep screen awake',share:'Share','open-whatsapp':'Open WhatsApp','open-settings':'Phone settings','open-maps':'Maps','share-location':'Location sharing'};
  if(DeviceBridge.available()){
    const result=await DeviceBridge.execute(action);
    if(result&&result.ok){setDeviceActionStatus(`${labels[action]||action} completed by the Android bridge.`,true);return;}
    if(result&&result.reason&&result.reason!=='Native Android bridge not connected.'){
      setDeviceActionStatus(`${labels[action]||action} was not completed: ${result.reason}`);return;
    }
  }
  try{
    if(action==='open-whatsapp'){launchExternal('https://wa.me/');setDeviceActionStatus('Opened the WhatsApp link. Choose the app if prompted.',true);return;}
    if(action==='open-settings'){launchExternal('intent://settings#Intent;scheme=android-app;end');setDeviceActionStatus('Requested Android settings. If it did not open, use your phone Settings app.',true);return;}
    if(action==='open-maps'){launchExternal('https://maps.google.com/');setDeviceActionStatus('Opened Google Maps or the browser map page.',true);return;}
    if(action==='share-location'){prepareLocationShare();return;}
    if(action==='vibrate'){
      if(!('vibrate' in navigator)){setDeviceActionStatus('Vibration is not supported by this browser.');return;}
      const worked=navigator.vibrate([180,80,180]);
      setDeviceActionStatus(worked===false?'The browser refused the vibration request.':'Vibration request sent. If the phone did not vibrate, check silent mode and browser support.',worked!==false);return;
    }
    if(action==='fullscreen'){
      if(document.fullscreenElement){await document.exitFullscreen();setDeviceActionStatus('Exited full-screen mode.',true);}
      else if(document.documentElement.requestFullscreen){await document.documentElement.requestFullscreen();setDeviceActionStatus('Full-screen mode enabled.',true);}
      else setDeviceActionStatus('Full-screen mode is not supported here.');
      return;
    }
    if(action==='keep-awake'){
      if(!('wakeLock' in navigator)){setDeviceActionStatus('Screen Wake Lock is not supported in this browser. Keep the page open and change screen timeout in Android settings if needed.');return;}
      if(bosompemWakeLock){await bosompemWakeLock.release();bosompemWakeLock=null;setDeviceActionStatus('Keep-awake mode turned off.',true);}
      else{bosompemWakeLock=await navigator.wakeLock.request('screen');bosompemWakeLock.addEventListener('release',()=>{bosompemWakeLock=null;});setDeviceActionStatus('Screen will stay awake while the browser permits it. Android may still release the lock when the page is hidden.',true);}
      return;
    }
    if(action==='share'){
      const data={title:'Bosompem AI',text:'My personal AI assistant — Bosompem.',url:location.href};
      if(navigator.share){await navigator.share(data);setDeviceActionStatus('Share sheet opened.',true);}
      else if(navigator.clipboard&&navigator.clipboard.writeText){await navigator.clipboard.writeText(location.href);setDeviceActionStatus('Share is unavailable; the Bosompem link was copied instead.',true);}
      else setDeviceActionStatus('Sharing is not supported by this browser.');
      return;
    }
    setDeviceActionStatus('That action is not available in browser mode.');
  }catch(error){setDeviceActionStatus(`Action not completed: ${error.message||'browser permission was denied'}`);}
}

// Appearance preferences: persistent, system-independent dark/light glass themes.
function setTheme(theme){
  const selected=theme==='light'?'light':'dark';
  document.documentElement.dataset.theme=selected;
  try{localStorage.setItem('bosompem_theme',selected);}catch{}
  const icon=document.getElementById('theme-toggle-icon');
  if(icon)icon.className=selected==='dark'?'fa-solid fa-sun':'fa-solid fa-moon';
  const picker=document.getElementById('theme-select');if(picker)picker.value=selected;
  const meta=document.querySelector('meta[name="theme-color"]');if(meta)meta.content=selected==='dark'?'#19263c':'#e8effa';
}
function initTheme(){let saved='dark';try{saved=localStorage.getItem('bosompem_theme')||'dark';}catch{}setTheme(saved);const voiceSelect=document.getElementById('voice-language-select');if(voiceSelect)voiceSelect.value=getRecognitionLanguage();}
function toggleTheme(){setTheme(document.documentElement.dataset.theme==='light'?'dark':'light');}
function launchExternal(url){
  // Prefer the permissioned Android companion when available; otherwise use browser navigation.
  if(DeviceBridge.available()){
    DeviceBridge.execute('open-url',{url}).then(result=>{if(!result?.ok){const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener noreferrer';document.body.appendChild(a);a.click();a.remove();}}).catch(()=>{});
    return;
  }
  const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener noreferrer';document.body.appendChild(a);a.click();a.remove();
}
function captureDeviceCommand(){
  if(!SpeechRecognition){setDeviceActionStatus('Voice command capture is not supported in this browser. Type the command instead.');return;}
  const button=document.querySelector('.device-mic-btn');
  const recognition=new SpeechRecognition();recognition.lang=getRecognitionLanguage();recognition.interimResults=false;recognition.maxAlternatives=1;
  if(button)button.innerHTML='<i class="fa-solid fa-ear-listen"></i>';
  recognition.onresult=e=>{const text=e.results?.[0]?.[0]?.transcript||'';const input=document.getElementById('device-command-input');if(input)input.value=text;prepareDeviceCommand();};
  recognition.onerror=()=>setDeviceActionStatus('Voice capture stopped. Check microphone permission or type your command.');
  recognition.onend=()=>{if(button)button.innerHTML='<i class="fa-solid fa-microphone"></i>';};
  try{recognition.start();}catch(error){setDeviceActionStatus('Could not start microphone: '+error.message);}
}
const FAVOURITE_CONTACTS_KEY='bosompem_favourite_contacts_v1';
function getFavouriteContacts(){try{const value=JSON.parse(localStorage.getItem(FAVOURITE_CONTACTS_KEY)||'[]');return Array.isArray(value)?value:[];}catch{return[];}}
function saveFavouriteContacts(items){localStorage.setItem(FAVOURITE_CONTACTS_KEY,JSON.stringify(items));renderFavouriteContacts();}
function normalizeContactName(value){return String(value||'').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,' ').trim();}
function findFavouriteContact(name){const wanted=normalizeContactName(name);if(!wanted)return null;const contacts=getFavouriteContacts();return contacts.find(c=>normalizeContactName(c.name)===wanted)||contacts.find(c=>{const n=normalizeContactName(c.name);return n.startsWith(wanted+' ')||wanted.startsWith(n+' ');})||null;}
function renderFavouriteContacts(){const host=document.getElementById('favourite-contacts-list');if(!host)return;const items=getFavouriteContacts();if(!items.length){host.innerHTML='<p class="empty-contacts-note">No favourite contacts added yet.</p>';return;}host.innerHTML=items.map((c,i)=>`<div class="favourite-contact-item"><span class="favourite-contact-avatar"><i class="fa-solid fa-user"></i></span><div class="favourite-contact-meta"><strong>${escapeHtml(c.name)}</strong><small>${escapeHtml(c.phone||'Phone number not saved')}</small></div><button class="contact-remove-btn" type="button" aria-label="Remove ${escapeHtml(c.name)}" onclick="removeFavouriteContact(${i})"><i class="fa-solid fa-trash"></i></button></div>`).join('');}
function addFavouriteContact(){const name=document.getElementById('favorite-contact-name');const phone=document.getElementById('favorite-contact-phone');const n=(name?.value||'').trim();const ph=(phone?.value||'').trim();if(!n){setDeviceActionStatus('Enter a contact name first.');name?.focus();return;}const normalized=ph.replace(/[\s().-]/g,'');if(normalized&&!/^\+?\d{5,15}$/.test(normalized)){setDeviceActionStatus('Check the phone number. Include the country code, for example +233…');phone?.focus();return;}const items=getFavouriteContacts();const old=items.findIndex(c=>normalizeContactName(c.name)===normalizeContactName(n));const record={name:n,phone:normalized};if(old>=0)items[old]=record;else items.push(record);saveFavouriteContacts(items);if(name)name.value='';if(phone)phone.value='';setDeviceActionStatus(`${n} is saved in Favourite contacts. Bosompem will check this list first.`,true);}
function removeFavouriteContact(index){const items=getFavouriteContacts();const removed=items[index];if(!removed)return;items.splice(index,1);saveFavouriteContacts(items);setDeviceActionStatus(`${removed.name} removed from Favourite contacts.`,true);}
async function pickPhoneContact(){if(!('contacts' in navigator)||typeof navigator.contacts.select!=='function'){setDeviceActionStatus('Your browser does not support the phone contact picker here. Add the contact manually using their name and number.');return;}try{const found=await navigator.contacts.select(['name','tel'],{multiple:false});if(!found?.length)return;const item=found[0];const n=Array.isArray(item.name)?item.name[0]:item.name;const ph=Array.isArray(item.tel)?item.tel[0]:item.tel;if(n)document.getElementById('favorite-contact-name').value=n;if(ph)document.getElementById('favorite-contact-phone').value=ph;setDeviceActionStatus(`Selected ${n||'contact'}. Review the details and tap Add to save as a favourite.`);}catch(e){setDeviceActionStatus('Phone contact selection was cancelled or unavailable. You can enter the contact manually.');}}
function announceRecipient(name,action){try{if(!('speechSynthesis'in window)||!('SpeechSynthesisUtterance'in window))return;window.speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(`${action} recipient: ${name}. Please check the name before continuing.`);utterance.rate=0.95;window.speechSynthesis.speak(utterance);}catch{}}
function prepareDeviceCommand(){
  const input=document.getElementById('device-command-input');const panel=document.getElementById('device-command-plan');
  const raw=(input?.value||'').trim();if(!raw){setDeviceActionStatus('Type or speak a command first.');return;}
  if(!panel)return;const lower=raw.toLowerCase();let plan=null;
  const tell=raw.match(/(?:tell|message|text|send(?:\s+a\s+message\s+to)?)\s+([A-Za-z][A-Za-z .'-]{0,35}?)\s+(?:to\s+)?(.+?)(?:[.!?]*)$/i);
  const callNumber=raw.match(/\bcall\s+([+\d][\d ()-]{5,})/i);
  const callName=raw.match(/\bcall\s+([A-Za-z][A-Za-z .'-]{0,35})\s*$/i);
  if(/instagram/.test(lower)&&/(?:message|text|dm)/.test(lower)){
    const im=raw.match(/(?:message|text|dm)\s+(?:to\s+)?@?([A-Za-z][A-Za-z0-9_. ]{0,35}?)\s+(?:saying|that says|with message|:)\s+(.+)$/i)||raw.match(/to\s+@?([A-Za-z][A-Za-z0-9_. ]{0,35}?)\s+(?:saying|that says|with message)\s+(.+)$/i);
    if(im)plan={kind:'instagram-message',recipient:im[1].trim(),message:im[2].trim().replace(/[.!?]+$/,'')};else plan={kind:'app',app:'instagram'};
  }else if(/whatsapp|message|text|tell/.test(lower)&&tell){
    let recipient=tell[1].trim().replace(/^(?:on\s+)?whatsapp\s+/i,'').trim();let message=tell[2].trim().replace(/[.!?]+$/,'');
    message=message.charAt(0).toUpperCase()+message.slice(1);
    const favorite=findFavouriteContact(recipient);plan={kind:'whatsapp',recipient:favorite?favorite.name:recipient,message,phone:favorite?.phone||'',matchedFavourite:!!favorite};
  }else if(callNumber){plan={kind:'call',number:callNumber[1].trim(),recipient:callNumber[1].trim()};}
  else if(callName){const name=callName[1].trim();const favorite=findFavouriteContact(name);plan={kind:'call',recipient:favorite?.name||name,number:favorite?.phone||'',matchedFavourite:!!favorite};}
  else if(/open\s+whatsapp/.test(lower))plan={kind:'open',app:'WhatsApp'};
  else if(/open\s+(?:google\s+)?maps|navigate\s+to/.test(lower))plan={kind:'maps',query:raw.replace(/.*?(?:navigate to|open (?:google )?maps)\s*/i,'').trim()};
  else if(/open\s+settings/.test(lower))plan={kind:'settings'};
  else if(/share.*location|my location/.test(lower))plan={kind:'location'};
  else if(/open\s+(youtube|chrome|gmail|phone|camera|instagram|facebook|tiktok|spotify|play store|google play)/i.test(raw)){const appMatch=raw.match(/open\s+(youtube|chrome|gmail|phone|camera|instagram|facebook|tiktok|spotify|play store|google play)/i);plan={kind:'app',app:appMatch[1].toLowerCase().replace(/\s+/g,'-')};}
  else if(/(?:update|upgrade)\s+(?:all\s+)?(?:my\s+)?apps|play\s+store.*update/i.test(lower))plan={kind:'playstore-updates'};
  else if(/open\s+(https?:\/\/\S+|[a-z0-9.-]+\.[a-z]{2,}(?:\/\S*)?)/i.test(raw)){const match=raw.match(/open\s+(https?:\/\/\S+|[a-z0-9.-]+\.[a-z]{2,}(?:\/\S*)?)/i);plan={kind:'url',url:/^https?:\/\//i.test(match[1])?match[1]:'https://'+match[1]};}
  else if(/open\s+([A-Za-z][A-Za-z0-9 ._-]{1,35})/i.test(raw)){const match=raw.match(/open\s+([A-Za-z][A-Za-z0-9 ._-]{1,35})/i);plan={kind:'generic-app',appName:match[1].trim()};}
  if(!plan){panel.classList.remove('hidden');panel.innerHTML='<h4>Command needs a supported action</h4><p>I can prepare messages, call drafts for saved contacts or numbers, open supported apps and maps, and request location sharing. For an unknown contact, choose it from phone contacts and add it to favourites first.</p>';setDeviceActionStatus('No supported action was confidently identified.');return;}
  // Routine app/site navigation can proceed directly; messaging and calling still use review safeguards.
  if(['open','maps','settings','app','url','generic-app','playstore-updates'].includes(plan.kind)){
    if(plan.kind==='open'){runDeviceAction('open-whatsapp');return;}
    if(plan.kind==='maps'){launchExternal('https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(plan.query||''));setDeviceActionStatus('Requested Maps navigation/search.',true);return;}
    if(plan.kind==='settings'){runDeviceAction('open-settings');return;}
    if(plan.kind==='app'){openNamedApp(plan.app);return;}
    if(plan.kind==='url'){launchExternal(plan.url);setDeviceActionStatus(`Requested ${plan.url}. The browser or Android decides how to open it.`,true);return;}
    if(plan.kind==='generic-app'){Promise.resolve(DeviceBridge.execute('open-app',{appName:plan.appName})).then(r=>{if(r?.ok)setDeviceActionStatus(`Opened ${plan.appName}.`,true);else setDeviceActionStatus(`Could not directly open ${plan.appName}. This web version has no native app launcher connected. No Play Store or browser redirect was opened. Install/connect the Android companion for package-based app launching.`);}).catch(()=>setDeviceActionStatus(`Could not directly open ${plan.appName}. Connect the Android companion for direct app launching.`));return;}
    if(plan.kind==='playstore-updates'){Promise.resolve(DeviceBridge.execute('open-play-store-updates',{})).then(r=>{if(r?.ok)setDeviceActionStatus('Opened Play Store updates.',true);else{launchExternal('market://myapps');setDeviceActionStatus('Requested the Play Store My apps screen. If it does not open, use Play Store → profile → Manage apps & device → Updates available. The web version cannot press Update all.',true);}});return;}
  }
  if(plan.kind==='call'&&plan.number){announceRecipient(plan.recipient,'Call');launchExternal('tel:'+plan.number.replace(/[^+\d]/g,''));setDeviceActionStatus(`Opened the dialer for ${plan.recipient}. Check the recipient and tap Call.`,true);return;}
  panel.classList.remove('hidden');
  if(plan.kind==='instagram-message'){
    panel.innerHTML=`<h4><i class="fa-brands fa-instagram"></i> Review Instagram message</h4><p><b>Recipient:</b> ${escapeHtml(plan.recipient)}</p><label for="device-message-edit"><b>Edit message</b></label><textarea id="device-message-edit" class="glass-textarea" rows="3">${escapeHtml(plan.message)}</textarea><div class="message-countdown" id="message-countdown" aria-live="polite">Ready for your 3-second review countdown.</div><div class="device-plan-actions"><button type="button" id="device-confirm-action">Start 3-second countdown</button><button type="button" id="device-cancel-action">Cancel</button></div><p class="message-safety-note">After the countdown, Bosompem copies the message and opens Instagram inbox. Verify the recipient and send it yourself; this web version cannot send DMs automatically.</p>`;
    const confirm=document.getElementById('device-confirm-action');const editor=document.getElementById('device-message-edit');
    if(editor)editor.addEventListener('input',()=>{if(window.bosompemMessageCountdownTimer){clearInterval(window.bosompemMessageCountdownTimer);window.bosompemMessageCountdownTimer=null;confirm.disabled=false;confirm.textContent='Start 3-second countdown';const c=document.getElementById('message-countdown');if(c)c.textContent='Message changed. Review it and start a new 3-second countdown.';}});
    confirm.onclick=()=>{const edited=(editor?.value||'').trim();if(!edited){setDeviceActionStatus('The message is empty.');return;}confirm.disabled=true;let remaining=3;const countdown=document.getElementById('message-countdown');countdown.textContent=`Opening Instagram in ${remaining}… You can cancel now.`;clearInterval(window.bosompemMessageCountdownTimer);window.bosompemMessageCountdownTimer=setInterval(async()=>{remaining--;if(remaining>0){countdown.textContent=`Opening Instagram in ${remaining}… You can cancel now.`;return;}clearInterval(window.bosompemMessageCountdownTimer);window.bosompemMessageCountdownTimer=null;try{await navigator.clipboard.writeText(edited);}catch{}launchExternal('https://www.instagram.com/direct/inbox/');countdown.textContent='Countdown complete. Instagram inbox opened; verify the recipient and paste/send the message.';setDeviceActionStatus(`Opened Instagram inbox for ${plan.recipient}. The message was not sent automatically.`,true);confirm.disabled=false;confirm.textContent='Start countdown again';},1000);};
  }else if(plan.kind==='whatsapp'){
    const matchNote=plan.matchedFavourite?'Matched your Favourite contacts list first.':'This name is not in Favourite contacts. Verify the exact person in WhatsApp before sending.';
    panel.innerHTML=`<h4><i class="fa-brands fa-whatsapp"></i> Review WhatsApp message</h4><p><b>Recipient:</b> ${escapeHtml(plan.recipient)}</p><label for="device-message-edit"><b>Edit message</b></label><textarea id="device-message-edit" class="glass-textarea" rows="3">${escapeHtml(plan.message)}</textarea><p>${escapeHtml(matchNote)}</p><div class="message-countdown" id="message-countdown" aria-live="polite">Ready for your 3-second review countdown.</div><div class="device-plan-actions"><button type="button" id="device-confirm-action">Start 3-second countdown</button><button type="button" id="device-find-contact">Find in phone contacts</button><button type="button" id="device-cancel-action">Cancel</button></div><p class="message-safety-note">After the countdown, Bosompem opens a prefilled WhatsApp draft. This web version cannot press WhatsApp's Send button; review the chat and tap Send in WhatsApp.</p>`;
    const confirm=document.getElementById('device-confirm-action');
    const messageEditor=document.getElementById('device-message-edit');
    if(messageEditor)messageEditor.addEventListener('input',()=>{if(window.bosompemMessageCountdownTimer){window.clearInterval(window.bosompemMessageCountdownTimer);window.bosompemMessageCountdownTimer=null;if(confirm){confirm.disabled=false;confirm.textContent='Start 3-second countdown';}const countdown=document.getElementById('message-countdown');if(countdown)countdown.textContent='Message changed. Review it and start a new 3-second countdown.';}});
    confirm.onclick=()=>{
      const edit=document.getElementById('device-message-edit');const edited=(edit?.value||'').trim();if(!edited){setDeviceActionStatus('The message is empty. Edit it before continuing.');edit?.focus();return;}
      confirm.disabled=true;const cancelButton=document.getElementById('device-cancel-action');let remaining=3;const countdown=document.getElementById('message-countdown');
      if(countdown)countdown.textContent=`Opening message draft in ${remaining}… You can cancel now.`;
      window.clearInterval(window.bosompemMessageCountdownTimer);
      window.bosompemMessageCountdownTimer=window.setInterval(()=>{
        remaining--;
        if(remaining>0){if(countdown)countdown.textContent=`Opening message draft in ${remaining}… You can cancel now.`;return;}
        window.clearInterval(window.bosompemMessageCountdownTimer);window.bosompemMessageCountdownTimer=null;
        const phone=(plan.phone||'').replace(/[^+\d]/g,'').replace(/^\+/,'');const url=phone?`https://wa.me/${phone}?text=${encodeURIComponent(edited)}`:`https://wa.me/?text=${encodeURIComponent(edited)}`;
        announceRecipient(plan.recipient,'Message');launchExternal(url);setDeviceActionStatus(`Opened a prefilled WhatsApp draft for ${plan.recipient}. Check the chat and tap Send yourself.`,true);
        if(countdown)countdown.textContent='Countdown complete. WhatsApp draft opened; message not sent by Bosompem.';
        confirm.disabled=false;confirm.textContent='Start countdown again';
      },1000);
    };
    const find=document.getElementById('device-find-contact');find.onclick=async()=>{window.clearInterval(window.bosompemMessageCountdownTimer);window.bosompemMessageCountdownTimer=null;await pickPhoneContact();const n=document.getElementById('favorite-contact-name')?.value||'';if(n)setDeviceActionStatus(`Phone contact ${n} selected. Tap Add in Favourite contacts, then prepare the command again to match it.`);};
  }else{
    const descriptions={open:'Open WhatsApp',maps:plan.query?`Open Maps for “${plan.query}”`:'Open Google Maps',call:plan.number?`Call ${plan.recipient} (${plan.number})`:`Call ${plan.recipient}`,settings:'Open Android settings',location:'Get your location and prepare a shareable map link',app:`Open ${plan.app}`,'playstore-updates':'Open Play Store app updates',url:`Open ${plan.url}`,'generic-app':`Try to open ${plan.appName}`};
    const isCall=plan.kind==='call';
    panel.innerHTML=`<h4>${isCall?'<i class="fa-solid fa-phone"></i> Review call recipient':'Review device action'}</h4><p><b>${isCall?'Recipient':'Action'}:</b> ${escapeHtml(descriptions[plan.kind]||'Run action')}</p>${isCall?`<p>${plan.number?'Check the saved number before continuing.':'No phone number is saved for this contact. Add it to Favourite contacts first.'}</p>`:'<p>This will open an app or prepare an action; Android may ask you to choose an app or grant permission.</p>'}<div class="device-plan-actions"><button type="button" id="device-confirm-action" ${isCall&&!plan.number?'disabled':''}>${isCall?'Open dialer':'Continue'}</button>${isCall&&!plan.number?'<button type="button" id="device-find-contact">Find in phone contacts</button>':''}<button type="button" id="device-cancel-action">Cancel</button></div>`;
    if(isCall&&!plan.number){const findCall=document.getElementById('device-find-contact');if(findCall)findCall.onclick=async()=>{await pickPhoneContact();const n=document.getElementById('favorite-contact-name')?.value||'';if(n)setDeviceActionStatus(`Phone contact ${n} selected. Tap Add in Favourite contacts, then prepare the call again.`);};}
    if(isCall&&plan.number)announceRecipient(plan.recipient,'Call');
    document.getElementById('device-confirm-action').onclick=()=>{
      if(plan.kind==='open')runDeviceAction('open-whatsapp');
      else if(plan.kind==='maps')launchExternal('https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(plan.query||''));
      else if(plan.kind==='call'){announceRecipient(plan.recipient,'Call');launchExternal('tel:'+plan.number.replace(/[^+\d]/g,''));setDeviceActionStatus(`Dialer opened for ${plan.recipient}. Review the recipient and press Call yourself.`,true);}
      else if(plan.kind==='settings')runDeviceAction('open-settings');
      else if(plan.kind==='location')prepareLocationShare();
      else if(plan.kind==='app')openNamedApp(plan.app);
      else if(plan.kind==='url'){launchExternal(plan.url);setDeviceActionStatus(`Requested ${plan.url}. The browser or Android will decide how to open it.`,true);}
      else if(plan.kind==='generic-app'){Promise.resolve(DeviceBridge.execute('open-app',{appName:plan.appName})).then(r=>{if(r?.ok)setDeviceActionStatus(`Opened ${plan.appName}.`,true);else setDeviceActionStatus(`Could not directly open ${plan.appName}. No Play Store or browser redirect was opened. Connect the Android companion for direct app launching.`);}).catch(()=>setDeviceActionStatus(`Could not directly open ${plan.appName}. Connect the Android companion for direct app launching.`));}
      else if(plan.kind==='playstore-updates'){const result=DeviceBridge.execute('open-play-store-updates',{});Promise.resolve(result).then(r=>{if(r?.ok)setDeviceActionStatus('Opened Play Store updates.',true);else{launchExternal('market://myapps');setDeviceActionStatus('Requested the Play Store My apps screen. If Android does not open it, open Play Store → profile → Manage apps & device → Updates available. This web version cannot press Update all automatically.',true);}});}
    };
  }
  const cancel=document.getElementById('device-cancel-action');if(cancel)cancel.onclick=()=>{window.clearInterval(window.bosompemMessageCountdownTimer);window.bosompemMessageCountdownTimer=null;panel.classList.add('hidden');setDeviceActionStatus('Command cancelled. No action was taken.');};
  setDeviceActionStatus('Action prepared. Check the recipient name; messages and calls are not submitted automatically.');
}
function openNamedApp(app){
 const packages={youtube:'com.google.android.youtube',gmail:'com.google.android.gm',instagram:'com.instagram.android',facebook:'com.facebook.katana',tiktok:'com.zhiliaoapp.musically',spotify:'com.spotify.music',whatsapp:'com.whatsapp',maps:'com.google.android.apps.maps',chrome:'com.android.chrome'};
 const normalized=String(app||'').toLowerCase().trim();
 if(DeviceBridge.available()){Promise.resolve(DeviceBridge.execute('open-app',{appName:normalized,packageName:packages[normalized]||''})).then(r=>{if(r?.ok)setDeviceActionStatus(`Opened ${normalized}.`,true);else setDeviceActionStatus(`Android could not open ${normalized}. Check that it is installed and supported by the companion.`);}).catch(()=>setDeviceActionStatus(`Could not open ${normalized}.`));return;}
 const schemes={youtube:'youtube://',instagram:'instagram://app',facebook:'fb://',whatsapp:'whatsapp://',spotify:'spotify://',maps:'geo:0,0?q=',phone:'tel:', 'play-store':'market://myapps','google-play':'market://myapps'};
 if(schemes[normalized]){launchExternal(schemes[normalized]);setDeviceActionStatus(`Requested direct launch for ${normalized}. If Android does not open it, this browser cannot launch that app directly; no Play Store search was opened.`,true);return;}
 setDeviceActionStatus(`Direct launch for ${normalized} requires the Bosompem Android companion. No browser or Play Store redirect was opened.`);
}
function prepareLocationShare(){
 if(!navigator.geolocation){setDeviceActionStatus('Location is unavailable in this browser.');return;}
 setDeviceActionStatus('Waiting for your location permission…');
 navigator.geolocation.getCurrentPosition(pos=>{const url=`https://maps.google.com/?q=${pos.coords.latitude},${pos.coords.longitude}`;const panel=document.getElementById('device-command-plan');if(panel){panel.classList.remove('hidden');panel.innerHTML='<h4>Location link ready</h4><p>Review before sharing. Your location has not been sent to anyone.</p><div class="device-plan-actions"><button id="copy-location-link" type="button">Copy map link</button><button id="open-location-map" type="button">Open map</button></div>';document.getElementById('copy-location-link').onclick=async()=>{try{await navigator.clipboard.writeText(url);setDeviceActionStatus('Map link copied. Paste it only into a chat you choose.',true);}catch{setDeviceActionStatus(url);}};document.getElementById('open-location-map').onclick=()=>launchExternal(url);}setDeviceActionStatus('Location obtained. Review the map link before sharing.',true);},err=>setDeviceActionStatus('Location was not obtained: '+(err.message||'permission denied')),{enableHighAccuracy:false,timeout:10000});
}

// Remote Web Push configuration. The public VAPID key is public; the private key stays on the push server.
const BOSOMPEM_PUSH_CONFIG='bosompem_push_config_v1';
function getPushConfig(){try{return Object.assign({serverUrl:'',vapidPublicKey:''},JSON.parse(localStorage.getItem(BOSOMPEM_PUSH_CONFIG)||'{}'));}catch{return{serverUrl:'',vapidPublicKey:''};}}
function savePushConfig(){
  const serverUrl=(document.getElementById('push-server-url')?.value||'').trim().replace(/\/+$/,'');
  const vapidPublicKey=(document.getElementById('push-vapid-public-key')?.value||'').trim();
  if(serverUrl&&!/^https:\/\//i.test(serverUrl)&&!/^http:\/\/localhost(?::\d+)?$/i.test(serverUrl)){alert('Use an HTTPS push server URL (localhost is allowed for development).');return false;}
  try{localStorage.setItem(BOSOMPEM_PUSH_CONFIG,JSON.stringify({serverUrl,vapidPublicKey}));}catch{}
  return true;
}
function urlBase64ToUint8Array(base64String){const padding='='.repeat((4-base64String.length%4)%4);const base64=(base64String+padding).replace(/-/g,'+').replace(/_/g,'/');const raw=atob(base64);return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)));}
async function enableRemotePush(){
  const status=document.getElementById('remote-push-status');
  if(!savePushConfig())return;
  const cfg=getPushConfig();
  if(!('serviceWorker'in navigator)||!('PushManager'in window)){if(status)status.textContent='This browser does not support Web Push.';return;}
  if(!window.isSecureContext){if(status)status.textContent='Web Push requires HTTPS.';return;}
  if(!cfg.serverUrl||!cfg.vapidPublicKey){if(status)status.textContent='Enter the push server URL and VAPID public key first.';return;}
  if(status)status.textContent='Requesting notification permission…';
  try{
    const permission=await Notification.requestPermission();
    if(permission!=='granted')throw new Error('Notification permission was not granted.');
    const registration=await navigator.serviceWorker.ready;
    let subscription=await registration.pushManager.getSubscription();
    if(!subscription)subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(cfg.vapidPublicKey)});
    const response=await fetch(`${cfg.serverUrl}/api/subscribe`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({subscription:subscription.toJSON(),origin:location.origin})});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(payload.error||`Subscription registration failed (${response.status}).`);
    if(status)status.textContent='Remote push enabled on this device. The server can now send notifications even when Bosompem is closed.';
    showBrowserNotification('Bosompem push enabled','This device is subscribed to remote push notifications.');
  }catch(err){if(status)status.textContent=`Could not enable remote push: ${err.message||err}`;}
}
async function disableRemotePush(){
  const status=document.getElementById('remote-push-status');const cfg=getPushConfig();
  try{
    const reg=await navigator.serviceWorker.ready;const sub=await reg.pushManager.getSubscription();
    if(sub){if(cfg.serverUrl){await fetch(`${cfg.serverUrl}/api/unsubscribe`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({endpoint:sub.endpoint,origin:location.origin})}).catch(()=>{});}await sub.unsubscribe();}
    if(status)status.textContent='Remote push subscription removed from this browser.';
  }catch(err){if(status)status.textContent=`Could not remove subscription: ${err.message||err}`;}
}
async function sendPushTest(){
  const status=document.getElementById('remote-push-status');const cfg=getPushConfig();
  const token=(document.getElementById('push-admin-token')?.value||'').trim();
  if(!cfg.serverUrl){if(status)status.textContent='Configure the push server URL first.';return;}
  if(!token){if(status)status.textContent='Enter the server admin token for this one-time test. It is not saved.';return;}
  try{
    if(status)status.textContent='Sending test push…';
    const response=await fetch(`${cfg.serverUrl}/api/send`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:JSON.stringify({title:'Bosompem test notification',body:'Remote push delivery is working on your subscribed device.',url:'./',tag:'bosompem-test'})});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||`Push request failed (${response.status}).`);
    if(status)status.textContent=`Push sent: ${data.sent||0} device(s) reached${data.failed?`; ${data.failed} failed`:''}.`;
    const tokenInput=document.getElementById('push-admin-token');if(tokenInput)tokenInput.value='';
  }catch(err){if(status)status.textContent=`Test push failed: ${err.message||err}`;}
}
function initPushSettings(){const c=getPushConfig();const server=document.getElementById('push-server-url');const key=document.getElementById('push-vapid-public-key');if(server)server.value=c.serverUrl;if(key)key.value=c.vapidPublicKey;}

// Customizable browser notifications. Remote push delivery still requires a push server/service.
const BOSOMPEM_NOTIFICATION_PREFS='bosompem_notification_preferences_v1';
function initNotificationSettings(){const p=getNotificationPreferences();const r=document.getElementById('notify-reminders-toggle');const t=document.getElementById('notify-tasks-toggle');const qs=document.getElementById('quiet-start');const qe=document.getElementById('quiet-end');if(r)r.checked=!!p.reminders;if(t)t.checked=!!p.taskUpdates;if(qs)qs.value=p.quietStart||'22:00';if(qe)qe.value=p.quietEnd||'07:00';}
function getNotificationPreferences(){try{return Object.assign({reminders:true,taskUpdates:true,quietStart:'22:00',quietEnd:'07:00'},JSON.parse(localStorage.getItem(BOSOMPEM_NOTIFICATION_PREFS)||'{}'));}catch{return{reminders:true,taskUpdates:true,quietStart:'22:00',quietEnd:'07:00'};}}
function saveNotificationPreferences(patch){const next={...getNotificationPreferences(),...patch};try{localStorage.setItem(BOSOMPEM_NOTIFICATION_PREFS,JSON.stringify(next));}catch{}return next;}
function showBosompemTaskNotification(title,body,kind='taskUpdates'){const prefs=getNotificationPreferences();if(!prefs[kind])return false; if(!('Notification'in window)||Notification.permission!=='granted')return false;try{const n=new Notification(title,{body,icon:'./icon-192.png',tag:`bosompem-${kind}`});n.onclick=()=>{window.focus();n.close();};return true;}catch{return false;}}
window.Bosompem={state,memoryEngine,DeviceBridge,sendChatMessage,openScreen,classifyRequest,chooseModelForRequest,showBosompemTaskNotification,getNotificationPreferences,saveNotificationPreferences,setRecognitionLanguage,initNotificationSettings,routeDeviceCommand,prepareDeviceCommand};


   

// Games Predictions tools: local-only history and honest statistical summaries.
const GAMES_STORAGE = { aviator:'bosompem_games_aviator_history_v1', bottle:'bosompem_games_bottle_history_v1' };
function switchGamesTab(tab) {
  document.querySelectorAll('[data-game-tab]').forEach(button => {
    const active = button.dataset.gameTab === tab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('.game-panel').forEach(panel => panel.classList.toggle('active', panel.id === `game-panel-${tab}`));
}
function readLocalGameHistory(key) {
  try { const value=JSON.parse(localStorage.getItem(key)||'[]'); return Array.isArray(value)?value:[]; }
  catch (_) { return []; }
}
function saveLocalGameHistory(key, history) {
  try { localStorage.setItem(key,JSON.stringify(history)); }
  catch (error) { console.warn('Bosompem could not save game history locally.',error); }
}
function escapeGameText(value) {
  return String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}
function analyzeAviatorHistory() {
  const input=document.getElementById('aviator-multipliers'), result=document.getElementById('aviator-analysis-result');
  if(!input||!result)return;
  const raw=input.value.trim(), values=raw.split(/[\s,;]+/).filter(Boolean).map(v=>Number(v.replace(/x$/i,'')));
  if(!raw||!values.length||values.some(v=>!Number.isFinite(v)||v<1)) { result.innerHTML='<p class="game-error">Enter valid multipliers of 1.00 or higher, separated by commas or spaces.</p>'; return; }
  if(values.length>500) { result.innerHTML='<p class="game-error">Please analyze up to 500 multipliers at a time.</p>'; return; }
  const sorted=[...values].sort((a,b)=>a-b), mean=values.reduce((s,v)=>s+v,0)/values.length;
  const median=sorted.length%2?sorted[(sorted.length-1)/2]:(sorted[sorted.length/2-1]+sorted[sorted.length/2])/2;
  const pct=t=>100*values.filter(v=>v>=t).length/values.length;
  const record={at:new Date().toISOString(),count:values.length,values:values.slice(-100)};
  const history=readLocalGameHistory(GAMES_STORAGE.aviator); history.unshift(record); saveLocalGameHistory(GAMES_STORAGE.aviator,history.slice(0,20));
  result.innerHTML=`<div class="game-stat-grid"><div class="game-stat"><span>Rounds entered</span><strong>${values.length}</strong></div><div class="game-stat"><span>Median</span><strong>${median.toFixed(2)}x</strong></div><div class="game-stat"><span>Average</span><strong>${mean.toFixed(2)}x</strong></div><div class="game-stat"><span>Below 1.50x</span><strong>${pct(1.5).toFixed(1)}%</strong></div><div class="game-stat"><span>2.00x or higher</span><strong>${pct(2).toFixed(1)}%</strong></div><div class="game-stat"><span>5.00x or higher</span><strong>${pct(5).toFixed(1)}%</strong></div></div><p class="game-note">These figures describe only the ${values.length} rounds entered. They do not reveal the next result; a recent pattern is not a dependable prediction.</p>`;
}
function clearAviatorHistory() {
  const input=document.getElementById('aviator-multipliers'),result=document.getElementById('aviator-analysis-result');
  if(input)input.value=''; if(result)result.innerHTML='<p class="game-empty">Input cleared. Saved analysis summaries remain in local storage.</p>';
}
function spinBottle() {
  const input=document.getElementById('bottle-participants'),picked=document.getElementById('bottle-picked-name'),result=document.getElementById('bottle-result');
  if(!input||!picked||!result)return;
  const raw=input.value.toUpperCase().match(/\b(?:UP|DOWN|MIDDLE)\b/g)||[];
  const values=raw.filter(v=>v==='UP'||v==='DOWN'||v==='MIDDLE');
  if(values.length<18){picked.textContent='Add at least 18 outcomes for a meaningful test';result.classList.add('error');return;}
  const classes=['UP','DOWN','MIDDLE'];
  const predict=(train,method)=>{
    const counts={UP:0,DOWN:0,MIDDLE:0}; train.forEach(v=>counts[v]++);
    if(method==='frequency')return classes.slice().sort((a,b)=>counts[b]-counts[a])[0];
    if(method==='recent'){
      const recent=train.slice(-10), w={UP:0,DOWN:0,MIDDLE:0};
      recent.forEach((v,i)=>w[v]+=i+1);
      return classes.slice().sort((a,b)=>w[b]-w[a])[0];
    }
    if(method==='transition'){
      const last=train[train.length-1], row={UP:0,DOWN:0,MIDDLE:0};
      for(let i=1;i<train.length;i++)if(train[i-1]===last)row[train[i]]++;
      return classes.slice().sort((a,b)=>row[b]-row[a])[0];
    }
    if(method==='inverse'){
      const counts2={UP:0,DOWN:0,MIDDLE:0}; train.forEach(v=>counts2[v]++);
      const base=classes.slice().sort((a,b)=>counts2[b]-counts2[a])[0];
      return base==='UP'?'DOWN':base==='DOWN'?'UP':'UP';
    }
    return 'UP';
  };
  const methods=[['frequency','Overall frequency'],['recent','Recent 10 weighted'],['transition','Previous-outcome transition'],['inverse','Opposite-frequency test']];
  const scores={}; methods.forEach(([id])=>scores[id]={hits:0,tests:0});
  // Walk-forward: each test prediction uses only outcomes before that test round.
  for(let i=12;i<values.length;i++){
    const train=values.slice(0,i), actual=values[i];
    methods.forEach(([id])=>{const guess=predict(train,id);scores[id].tests++;if(guess===actual)scores[id].hits++;});
  }
  const ranked=methods.map(([id,label])=>({id,label,hits:scores[id].hits,tests:scores[id].tests,rate:scores[id].hits/Math.max(1,scores[id].tests)})).sort((a,b)=>b.rate-a.rate);
  const winner=ranked[0];
  const nextGuess=predict(values,winner.id);
  const baseline=ranked.find(m=>m.id==='frequency');
  const enough=winner.tests>=20;
  const margin=winner.rate-baseline.rate;
  const edge=enough&&winner.id!=='frequency'&&margin>=0.05;
  picked.textContent=edge?`${nextGuess} · TEST CANDIDATE: ${winner.label}`:`No reliable edge · candidate ${nextGuess}`;
  result.classList.remove('error');
  const pct=x=>(x*100).toFixed(1)+'%';
  const count={UP:0,DOWN:0,MIDDLE:0};values.forEach(v=>count[v]++);
  const extra=document.getElementById('bottle-analysis-detail');
  const rows=ranked.map(m=>`<div class="game-stat"><span>${escapeGameText(m.label)} (${m.hits}/${m.tests})</span><strong>${pct(m.rate)}</strong></div>`).join('');
  const detail=`<div class="game-stat-grid">${rows}<div class="game-stat"><span>Outcomes supplied</span><strong>${values.length}</strong></div><div class="game-stat"><span>UP / DOWN / MIDDLE</span><strong>${count.UP} / ${count.DOWN} / ${count.MIDDLE}</strong></div><div class="game-stat"><span>Top vs frequency baseline</span><strong>${margin>=0?'+':''}${(margin*100).toFixed(1)} pp</strong></div></div><p class="game-note">Walk-forward test: each historical prediction used only earlier entries. This compares simple methods; it does not prove future results are predictable. ${!enough?'Too few test rounds to choose a method reliably. ':''}${!edge?'No method has shown a strong enough advantage over the frequency baseline, so treat the displayed outcome as an experimental candidate—not a confident prediction.':'The best method beat the frequency baseline in this small historical test; continue testing on new unseen results before trusting it.'} Ensure entries are ordered oldest to newest and are correctly matched to rounds. Include MIDDLE in the sequence; it counts as an outcome, not an automatic UP/DOWN loss.</p>`;
  if(extra)extra.innerHTML=detail; else {const div=document.createElement('div');div.id='bottle-analysis-detail';div.className='game-results';div.innerHTML=detail;result.insertAdjacentElement('afterend',div);}
  const history=readLocalGameHistory(GAMES_STORAGE.bottle);history.unshift({name:nextGuess,at:new Date().toISOString(),n:values.length,confidence:edge?'experimental walk-forward edge':'no reliable edge',method:winner.label});saveLocalGameHistory(GAMES_STORAGE.bottle,history.slice(0,30));renderBottleHistory();
}
function renderBottleHistory() {
  const list=document.getElementById('bottle-history');if(!list)return;
  const history=readLocalGameHistory(GAMES_STORAGE.bottle);
  if(!history.length){list.innerHTML='<li class="game-empty">No spins yet.</li>';return;}
  list.innerHTML=history.slice(0,10).map(item=>{const d=new Date(item.at),when=Number.isNaN(d.getTime())?'':d.toLocaleString();return `<li><span>${escapeGameText(item.name)}${item.confidence?' · '+escapeGameText(item.confidence):''}</span><small>${escapeGameText(when)}</small></li>`;}).join('');
}
function clearBottleHistory() {
  saveLocalGameHistory(GAMES_STORAGE.bottle,[]);renderBottleHistory();
  const result=document.getElementById('bottle-result'),picked=document.getElementById('bottle-picked-name');
  if(picked)picked.textContent='Ready to analyze';if(result)result.classList.remove('error');const detail=document.getElementById('bottle-analysis-detail');if(detail)detail.remove();
}
document.addEventListener('DOMContentLoaded',renderBottleHistory);
