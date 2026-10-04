// ==========================================
// BOSOMPEM AI PRO - ARCHITECTURE ENGINE
// Voice-First Pipeline, Persistent Memory, & Agentic Processing
// ==========================================

const SYSTEM_INSTRUCTION = `You are Bosompem Pro, an advanced AI personal assistant.
Provide clear, accurate, and direct responses using standard Markdown formatting.`;

// --- 1. SPEECH SANITIZER ---
class SpeechSanitizer {
  /**
   * Sanitizes markdown, symbols, URLs, and syntax elements into clear spoken prose.
   * Visual UI output remains unmodified.
   */
  static cleanTextForSpeech(text) {
    if (!text) return '';
    let clean = text;

    clean = clean.replace(/```[\s\S]*?```/g, ' [Code block omitted] ');
    clean = clean.replace(/`([^`]+)`/g, '$1');
    clean = clean.replace(/^#{1,6}\s+(.*)$/gm, '$1. ');
    clean = clean.replace(/(\*\*|__)(.*?)\1/g, '$2');
    clean = clean.replace(/(\*|_)(.*?)\1/g, '$2');
    clean = clean.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    clean = clean.replace(/https?:\/\/\S+/g, '');
    clean = clean.replace(/<[^>]*>/g, '');
    clean = clean.replace(/^\s*[\*\-\+]\s+/gm, ' ');
    clean = clean.replace(/^\s*\d+\.\s+/gm, ' ');
    clean = clean.replace(/\s+/g, ' ').trim();

    return clean;
  }
}

// --- 2. PERSISTENT LONG-TERM MEMORY ENGINE ---
class MemoryVault {
  constructor() {
    this.dbName = 'BosompemMemoryVault';
    this.db = null;
  }

  async init() {
    return new Promise((resolve) => {
      if (!window.indexedDB) return resolve();
      const request = indexedDB.open(this.dbName, 1);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('memories')) {
          db.createObjectStore('memories', { keyPath: 'id' });
        }
      };
      request.onsuccess = (e) => {
        this.db = e.target.result;
        resolve();
      };
      request.onerror = () => resolve();
    });
  }

  generateTokens(text) {
    return text.toLowerCase().replace(/[^\w\s]/gi, '').split(/\s+/).filter(w => w.length > 2);
  }

  async storeMemory(fact) {
    if (!this.db || !fact) return;
    const item = {
      id: 'mem_' + Date.now(),
      fact: fact.trim(),
      tokens: this.generateTokens(fact),
      date: new Date().toISOString()
    };
    return new Promise((resolve) => {
      const tx = this.db.transaction('memories', 'readwrite');
      tx.objectStore('memories').put(item);
      tx.oncomplete = () => resolve(item);
    });
  }

  async retrieveRelevant(query) {
    if (!this.db) return [];
    const qTokens = this.generateTokens(query);
    if (qTokens.length === 0) return [];

    return new Promise((resolve) => {
      const tx = this.db.transaction('memories', 'readonly');
      const store = tx.objectStore('memories');
      store.getAll().onsuccess = (e) => {
        const all = e.target.result || [];
        const matches = all.filter(m => qTokens.some(t => m.tokens.includes(t)));
        resolve(matches.map(m => m.fact));
      };
    });
  }

  async getAllMemories() {
    if (!this.db) return [];
    return new Promise((resolve) => {
      const tx = this.db.transaction('memories', 'readonly');
      tx.objectStore('memories').getAll().onsuccess = (e) => resolve(e.target.result || []);
    });
  }

  async deleteMemory(id) {
    if (!this.db) return;
    return new Promise((resolve) => {
      const tx = this.db.transaction('memories', 'readwrite');
      tx.objectStore('memories').delete(id).oncomplete = () => resolve();
    });
  }
}

// --- 3. DEVICE BRIDGE & AGENT PIPELINE ---
class DeviceBridge {
  static async executeLocalTask(taskName, payload = {}) {
    console.log(`[Device Bridge Dispatch]: ${taskName}`, payload);
    return { status: "success", message: `Task ${taskName} processed locally.` };
  }
}

// --- 4. STATE MANAGEMENT ---
const state = {
  activeScreen: 'chat',
  userName: localStorage.getItem('bosompem_user_name') || '',
  apiKey: localStorage.getItem('bosompem_api_key') || '',
  model: localStorage.getItem('bosompem_model') || 'gemini-2.5-flash',
  deepResearchMode: localStorage.getItem('bosompem_research_mode') === 'true',
  
  sessions: JSON.parse(localStorage.getItem('bosompem_sessions') || '[]'),
  activeSessionId: null,
  
  voiceState: 'IDLE', // 'IDLE' | 'LISTENING' | 'THINKING' | 'SPEAKING'
  isLiveVoiceActive: false,
  isVoiceNoteRecording: false,
  reminders: JSON.parse(localStorage.getItem('bosompem_reminders') || '[]'),
  selectedImageData: null
};

const memoryEngine = new MemoryVault();
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let liveRecognition = null;
let voiceNoteRecognition = null;

// --- INITIALIZATION ---
window.addEventListener('DOMContentLoaded', async () => {
  await memoryEngine.init();
  initVoiceEngines();
  loadSavedSettings();
  updateGreeting();
  renderReminders();
  renderMemoryList();
  updateClock();
  setInterval(updateClock, 30000);

  if (state.sessions.length === 0) {
    createNewChatSession();
  } else {
    loadSession(state.sessions[0].id);
  }
});

// --- STATUS BAR CLOCK ---
function updateClock() {
  const timeEl = document.getElementById('status-time');
  if (!timeEl) return;
  const now = new Date();
  timeEl.innerText = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

// --- SCREEN SWITCHER ---
function openScreen(screenId) {
  state.activeScreen = screenId;

  document.querySelectorAll('.screen-view').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(`screen-${screenId}`);
  if (target) target.classList.add('active');

  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.screen === screenId);
  });

  const titleMap = {
    'chat': 'Chat Studio',
    'live-voice': 'Live Voice Mode',
    'media-lab': 'Photo & Media Lab',
    'memory-vault': 'Memory Vault',
    'tasks': 'Tasks & Reminders',
    'profile': 'User Profile',
    'settings': 'System Settings'
  };
  const titleEl = document.getElementById('active-screen-title');
  if (titleEl) titleEl.innerText = titleMap[screenId] || 'Bosompem AI';

  if (screenId === 'memory-vault') renderMemoryList();
}

// --- NAVIGATION DRAWER ---
function toggleNavDrawer() {
  const drawer = document.getElementById('nav-drawer');
  const overlay = document.getElementById('nav-overlay');
  if (drawer && overlay) {
    drawer.classList.toggle('open');
    overlay.classList.toggle('active');
  }
}

function switchScreenFromDrawer(screenId) {
  openScreen(screenId);
  toggleNavDrawer();
}

// --- TEXTAREA AUTO EXPAND ---
function autoExpandTextarea(el) {
  if (!el) return;
  el.style.height = '24px';
  const newHeight = Math.min(el.scrollHeight, 120);
  el.style.height = newHeight + 'px';
}

function handleTextareaKeyDown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleChatSubmit();
  }
}

// --- SESSIONS & CHAT ---
function createNewChatSession() {
  const newSession = {
    id: 'session-' + Date.now(),
    title: 'New Conversation',
    messages: []
  };

  state.sessions.unshift(newSession);
  saveSessionsToStorage();
  loadSession(newSession.id);
}

function loadSession(sessionId) {
  state.activeSessionId = sessionId;
  const session = getActiveSession();
  const hero = document.getElementById('welcome-hero');
  const messagesBox = document.getElementById('chat-messages-container');

  if (!session || session.messages.length === 0) {
    if (hero) hero.style.display = 'flex';
    if (messagesBox) {
      messagesBox.style.display = 'none';
      messagesBox.innerHTML = '';
    }
  } else {
    if (hero) hero.style.display = 'none';
    if (messagesBox) messagesBox.style.display = 'flex';
    renderMessages();
  }
}

function getActiveSession() {
  return state.sessions.find(s => s.id === state.activeSessionId);
}

function saveSessionsToStorage() {
  localStorage.setItem('bosompem_sessions', JSON.stringify(state.sessions));
}

async function sendChatMessage(text, imageData = null) {
  if (!text || !text.trim()) return;

  if (!state.apiKey) {
    alert("Please set your Gemini API Key in System Settings first.");
    openScreen('settings');
    return;
  }

  const session = getActiveSession();
  if (!session) return;

  if (session.messages.length === 0) {
    session.title = text.length > 25 ? text.substring(0, 25) + '...' : text;
  }

  const hero = document.getElementById('welcome-hero');
  if (hero) hero.style.display = 'none';

  const messagesBox = document.getElementById('chat-messages-container');
  if (messagesBox) messagesBox.style.display = 'flex';

  // Check for memory creation command
  if (text.toLowerCase().startsWith('remember that') || text.toLowerCase().startsWith('remember')) {
    const fact = text.replace(/^remember\s+(that\s+)?/i, '').trim();
    await memoryEngine.storeMemory(fact);
  }

  session.messages.push({ role: 'user', text });
  renderMessages();
  saveSessionsToStorage();

  // Retrieve relevant memories to augment prompt context
  const memories = await memoryEngine.retrieveRelevant(text);
  let memoryContext = '';
  if (memories.length > 0) {
    memoryContext = `[Context from User Memory Vault: ${memories.join('; ')}]\n`;
  }

  // Display Agent Steps UI if research mode active or prompt is long
  if (state.deepResearchMode || text.length > 80) {
    renderAgentSteps(["Extract query intent", "Query Persistent Memory Vault", "Synthesize Gemini reasoning"]);
  }

  setVoiceState('THINKING');
  const thinkingId = appendThinkingIndicator();

  const textarea = document.getElementById('chat-input');
  if (textarea) {
    textarea.value = '';
    autoExpandTextarea(textarea);
  }

  // Build Payload including Multimodal Base64 Image handling and memory context
  const contentsPayload = session.messages.map((m, idx) => {
    const isLatest = idx === session.messages.length - 1;
    const promptText = isLatest && m.role === 'user' ? `${memoryContext}${m.text}` : m.text;
    const parts = [{ text: promptText }];
    
    if (isLatest && imageData) {
      const base64Data = imageData.split(',')[1];
      const mimeType = imageData.substring(imageData.indexOf(':') + 1, imageData.indexOf(';'));
      parts.push({
        inline_data: {
          mime_type: mimeType,
          data: base64Data
        }
      });
    }

    return {
      role: m.role === 'assistant' ? 'model' : 'user',
      parts
    };
  });

  try {
    const selectedModel = state.model || 'gemini-2.5-flash';
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${encodeURIComponent(state.apiKey)}`;
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: contentsPayload,
        systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] }
      })
    });

    const data = await response.json();
    removeThinkingIndicator(thinkingId);
    hideAgentSteps();

    if (data.error) {
      const errText = `API Error: ${data.error.message || 'Check API key or selection.'}`;
      session.messages.push({ role: 'assistant', text: errText });
      setVoiceState('IDLE');
    } else {
      const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "No response received.";
      session.messages.push({ role: 'assistant', text: reply });
      
      if (state.isLiveVoiceActive || state.activeScreen === 'live-voice') {
        speakText(reply);
      } else {
        setVoiceState('IDLE');
      }
    }

    state.selectedImageData = null;
    saveSessionsToStorage();
    renderMessages();

  } catch (err) {
    removeThinkingIndicator(thinkingId);
    hideAgentSteps();
    session.messages.push({ 
      role: 'assistant', 
      text: "Connection error reaching Gemini API." 
    });
    setVoiceState('IDLE');
    saveSessionsToStorage();
    renderMessages();
  }
}

function renderMessages() {
  const box = document.getElementById('chat-messages-container');
  const session = getActiveSession();
  if (!box || !session) return;

  box.innerHTML = session.messages.map((m, idx) => `
    <div class="chat-bubble ${m.role}">
      <div class="bubble-content">
        ${m.role === 'assistant' ? formatMarkdown(m.text) : escapeHtml(m.text)}
        ${m.role === 'assistant' ? `
          <div class="bubble-actions">
            <button class="btn-bubble-action" onclick="speakText(state.sessions.find(s => s.id === '${state.activeSessionId}').messages[${idx}].text)"><i class="fa-solid fa-volume-high"></i> Speak</button>
            <button class="btn-bubble-action" onclick="navigator.clipboard.writeText(state.sessions.find(s => s.id === '${state.activeSessionId}').messages[${idx}].text)"><i class="fa-solid fa-copy"></i> Copy</button>
          </div>
        ` : ''}
      </div>
    </div>
  `).join('');

  scrollToBottom();
}

function handleChatSubmit() {
  const textarea = document.getElementById('chat-input');
  if (!textarea) return;
  sendChatMessage(textarea.value, state.selectedImageData);
}

function usePromptPreset(type) {
  if (type === 'code') sendChatMessage("Write a clean, modular Javascript function for:");
  else if (type === 'deep') sendChatMessage("Provide an architectural and technical deep dive for:");
}

// --- 5. VOICE PIPELINE & ORB CONTROLLER ---
function setVoiceState(newState) {
  state.voiceState = newState;
  const orb = document.getElementById('voice-orb');
  const orbIcon = document.getElementById('orb-icon');
  const speechBar = document.getElementById('speech-state-bar');

  if (orb) {
    orb.className = `voice-orb ${newState.toLowerCase()}`;
  }

  if (orbIcon) {
    if (newState === 'LISTENING') orbIcon.className = 'fa-solid fa-microphone';
    else if (newState === 'THINKING') orbIcon.className = 'fa-solid fa-circle-notch fa-spin';
    else if (newState === 'SPEAKING') orbIcon.className = 'fa-solid fa-waveform';
    else orbIcon.className = 'fa-solid fa-microphone';
  }

  if (speechBar) {
    if (newState === 'SPEAKING') speechBar.classList.remove('hidden');
    else speechBar.classList.add('hidden');
  }
}

function initVoiceEngines() {
  if (!SpeechRecognition) return;

  liveRecognition = new SpeechRecognition();
  liveRecognition.continuous = false;
  liveRecognition.interimResults = true;
  liveRecognition.lang = 'en-US';

  liveRecognition.onstart = () => {
    setVoiceState('LISTENING');
  };

  liveRecognition.onresult = (e) => {
    const transcript = e.results[0][0].transcript;
    const card = document.getElementById('voice-live-transcript');
    if (card) card.innerText = transcript;

    if (e.results[0].isFinal && transcript.trim()) {
      sendChatMessage(transcript);
    }
  };

  liveRecognition.onend = () => {
    if (state.isLiveVoiceActive && state.voiceState !== 'SPEAKING' && state.voiceState !== 'THINKING') {
      setTimeout(() => { try { liveRecognition.start(); } catch(e){} }, 300);
    } else if (!state.isLiveVoiceActive && state.voiceState !== 'SPEAKING' && state.voiceState !== 'THINKING') {
      setVoiceState('IDLE');
    }
  };

  voiceNoteRecognition = new SpeechRecognition();
  voiceNoteRecognition.continuous = true;
  voiceNoteRecognition.interimResults = true;

  voiceNoteRecognition.onresult = (e) => {
    let transcript = '';
    for (let i = e.resultIndex; i < e.results.length; ++i) {
      transcript += e.results[i][0].transcript;
    }
    const input = document.getElementById('chat-input');
    if (input) {
      input.value = transcript;
      autoExpandTextarea(input);
    }
  };
}

function toggleLiveVoiceMode() {
  if (!SpeechRecognition) {
    alert("Voice recognition not supported on this device.");
    return;
  }

  state.isLiveVoiceActive = !state.isLiveVoiceActive;
  const btn = document.getElementById('live-voice-toggle-btn');
  const title = document.getElementById('voice-status-title');

  if (state.isLiveVoiceActive) {
    if (btn) btn.innerHTML = `<i class="fa-solid fa-stop"></i> Stop Live Mode`;
    if (title) title.innerText = "Listening...";
    stopSpeechPlayback();
    try { liveRecognition.start(); } catch(e){}
  } else {
    if (btn) btn.innerHTML = `<i class="fa-solid fa-microphone"></i> Start Live Mode`;
    if (title) title.innerText = "Live Voice Paused";
    try { liveRecognition.stop(); } catch(e){}
    setVoiceState('IDLE');
  }
}

function toggleVoiceNoteRecording() {
  if (!SpeechRecognition) return;
  state.isVoiceNoteRecording = !state.isVoiceNoteRecording;
  const btn = document.getElementById('voice-note-btn');

  if (state.isVoiceNoteRecording) {
    if (btn) btn.style.color = 'var(--accent-rose)';
    try { voiceNoteRecognition.start(); } catch(e){}
  } else {
    if (btn) btn.style.color = 'var(--text-sub)';
    try { voiceNoteRecognition.stop(); } catch(e){}
  }
}

function speakText(rawText) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();

  const cleanSpokenText = SpeechSanitizer.cleanTextForSpeech(rawText);
  if (!cleanSpokenText) return;

  const utterance = new SpeechSynthesisUtterance(cleanSpokenText);
  utterance.rate = 1.0;
  
  utterance.onstart = () => {
    setVoiceState('SPEAKING');
  };

  utterance.onend = () => {
    setVoiceState('IDLE');
    if (state.isLiveVoiceActive) {
      setTimeout(() => { try { liveRecognition.start(); } catch(e){} }, 300);
    }
  };

  utterance.onerror = () => {
    setVoiceState('IDLE');
  };

  window.speechSynthesis.speak(utterance);
}

function stopSpeechPlayback() {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
  setVoiceState('IDLE');
}

// --- 6. AGENT WORKFLOW & AGGREGATION ---
function renderAgentSteps(steps) {
  const card = document.getElementById('agent-planner-card');
  const list = document.getElementById('agent-steps-list');
  if (!card || !list) return;

  list.innerHTML = steps.map((s, idx) => `
    <div class="agent-step-item">
      <i class="fa-solid fa-circle-notch fa-spin"></i> Step ${idx + 1}: ${s}
    </div>
  `).join('');
  card.classList.remove('hidden');
}

function hideAgentSteps() {
  const card = document.getElementById('agent-planner-card');
  if (card) card.classList.add('hidden');
}

// --- PHOTO & MEDIA LAB ---
function handleImageUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    state.selectedImageData = event.target.result;
    const preview = document.getElementById('lab-image-preview');
    const box = document.getElementById('image-preview-box');
    if (preview && box) {
      preview.src = state.selectedImageData;
      box.style.display = 'block';
    }
  };
  reader.readAsDataURL(file);
}

function processMediaLabTask() {
  const promptText = document.getElementById('media-prompt-input')?.value;
  if (!promptText && !state.selectedImageData) {
    alert("Please select an image or enter design instructions.");
    return;
  }

  const query = promptText || "Analyze this image and enhance subject sharpness and focus.";
  openScreen('chat');
  sendChatMessage(`[Media Lab Request]: ${query}`, state.selectedImageData);
}

// --- MEMORY VAULT UI ---
async function addCustomMemory() {
  const input = document.getElementById('memory-add-input');
  if (input && input.value.trim()) {
    await memoryEngine.storeMemory(input.value.trim());
    input.value = '';
    renderMemoryList();
  }
}

async function renderMemoryList() {
  const list = document.getElementById('memory-items-list');
  if (!list) return;

  const memories = await memoryEngine.getAllMemories();
  if (memories.length === 0) {
    list.innerHTML = `<p style="font-size: 0.8rem; color: var(--text-muted);">No facts stored in long-term memory.</p>`;
    return;
  }

  list.innerHTML = memories.map(m => `
    <div class="task-item">
      <span>${escapeHtml(m.fact)}</span>
      <button class="btn-icon-danger" onclick="deleteMemoryIte
