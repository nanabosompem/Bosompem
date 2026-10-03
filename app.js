// ==========================================
// BOSOMPEM AI PRO - ARCHITECTURE ENGINE
// ==========================================

const SYSTEM_INSTRUCTION = `You are Bosompem Pro, an advanced AI personal assistant.
Answer thoroughly, accurately, and directly using clean Markdown formatting.`;

const state = {
  activeScreen: 'chat',
  userName: localStorage.getItem('bosompem_user_name') || '',
  apiKey: localStorage.getItem('bosompem_api_key') || '',
  model: localStorage.getItem('bosompem_model') || 'gemini-2.5-flash',
  deepResearchMode: localStorage.getItem('bosompem_research_mode') === 'true',
  
  sessions: JSON.parse(localStorage.getItem('bosompem_sessions') || '[]'),
  activeSessionId: null,
  
  isLiveVoiceActive: false,
  isVoiceNoteRecording: false,
  reminders: JSON.parse(localStorage.getItem('bosompem_reminders') || '[]'),
  selectedImageData: null
};

// Web Speech API
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let liveRecognition = null;
let voiceNoteRecognition = null;

// --- INITIALIZATION ---
window.addEventListener('DOMContentLoaded', () => {
  initVoiceEngines();
  loadSavedSettings();
  updateGreeting();
  renderReminders();
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
    'tasks': 'Tasks & Reminders',
    'profile': 'User Profile',
    'settings': 'System Settings'
  };
  const titleEl = document.getElementById('active-screen-title');
  if (titleEl) titleEl.innerText = titleMap[screenId] || 'Bosompem AI';
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

  session.messages.push({ role: 'user', text });
  renderMessages();
  saveSessionsToStorage();

  const thinkingId = appendThinkingIndicator();

  const textarea = document.getElementById('chat-input');
  if (textarea) {
    textarea.value = '';
    autoExpandTextarea(textarea);
  }

  // Build Payload including Multimodal Base64 Image handling
  const contentsPayload = session.messages.map((m, idx) => {
    const parts = [{ text: m.text }];
    
    // Attach selected image payload to the latest user prompt if present
    if (idx === session.messages.length - 1 && imageData) {
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

    if (data.error) {
      session.messages.push({ 
        role: 'assistant', 
        text: `API Error: ${data.error.message || 'Check API key or selection.'}` 
      });
    } else {
      const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "No response received.";
      session.messages.push({ role: 'assistant', text: reply });
      
      if (state.isLiveVoiceActive) {
        speakText(reply.length > 250 ? reply.substring(0, 250) + "..." : reply);
      }
    }

    // Reset attached image data post request
    state.selectedImageData = null;

    saveSessionsToStorage();
    renderMessages();

  } catch (err) {
    removeThinkingIndicator(thinkingId);
    session.messages.push({ 
      role: 'assistant', 
      text: "Connection error reaching Gemini API." 
    });
    saveSessionsToStorage();
    renderMessages();
  }
}

function renderMessages() {
  const box = document.getElementById('chat-messages-container');
  const session = getActiveSession();
  if (!box || !session) return;

  box.innerHTML = session.messages.map(m => `
    <div class="chat-bubble ${m.role}">
      <div class="bubble-content">
        ${m.role === 'assistant' ? formatMarkdown(m.text) : escapeHtml(m.text)}
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

// --- LIVE VOICE MODE ---
function initVoiceEngines() {
  if (!SpeechRecognition) return;

  liveRecognition = new SpeechRecognition();
  liveRecognition.continuous = false;
  liveRecognition.interimResults = true;
  liveRecognition.lang = 'en-US';

  liveRecognition.onresult = (e) => {
    const transcript = e.results[0][0].transcript;
    const card = document.getElementById('voice-live-transcript');
    if (card) card.innerText = transcript;

    if (e.results[0].isFinal && transcript.trim()) {
      sendChatMessage(transcript);
    }
  };

  liveRecognition.onend = () => {
    if (state.isLiveVoiceActive) {
      setTimeout(() => { try { liveRecognition.start(); } catch(e){} }, 300);
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
    try { liveRecognition.start(); } catch(e){}
  } else {
    if (btn) btn.innerHTML = `<i class="fa-solid fa-microphone"></i> Start Live Mode`;
    if (title) title.innerText = "Live Voice Paused";
    try { liveRecognition.stop(); } catch(e){}
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

// --- SETTINGS & PROFILE ---
function saveSettings() {
  const keyInput = document.getElementById('api-key');
  const modelSelect = document.getElementById('model-select');
  const deepToggle = document.getElementById('deep-research-toggle');

  if (keyInput) state.apiKey = keyInput.value.trim();
  if (modelSelect) state.model = modelSelect.value;
  if (deepToggle) state.deepResearchMode = deepToggle.checked;

  localStorage.setItem('bosompem_api_key', state.apiKey);
  localStorage.setItem('bosompem_model', state.model);
  localStorage.setItem('bosompem_research_mode', state.deepResearchMode);

  alert("Settings updated!");
}

function loadSavedSettings() {
  const keyInput = document.getElementById('api-key');
  const modelSelect = document.getElementById('model-select');
  const deepToggle = document.getElementById('deep-research-toggle');
  const nameInput = document.getElementById('user-name-input');

  if (keyInput) keyInput.value = state.apiKey;
  if (modelSelect) modelSelect.value = state.model;
  if (deepToggle) deepToggle.checked = state.deepResearchMode;
  if (nameInput) nameInput.value = state.userName;
}

function switchModel(val) {
  state.model = val;
  localStorage.setItem('bosompem_model', val);
}

function saveUserProfile() {
  const nameInput = document.getElementById('user-name-input');
  if (nameInput) {
    state.userName = nameInput.value.trim();
    localStorage.setItem('bosompem_user_name', state.userName);
    updateGreeting();
  }
  alert("Profile saved!");
}

function updateGreeting() {
  const greetingEl = document.getElementById('dynamic-greeting');
  const drawerUserEl = document.getElementById('drawer-user-name');
  
  if (greetingEl) {
    greetingEl.innerText = `Hello${state.userName ? ', ' + state.userName : ''}`;
  }
  if (drawerUserEl && state.userName) {
    drawerUserEl.innerText = state.userName;
  }
}

// --- REMINDERS & UTILITIES ---
function addReminder() {
  const text = prompt("Enter task or reminder:");
  if (text) {
    state.reminders.unshift({ id: Date.now(), text });
    localStorage.setItem('bosompem_reminders', JSON.stringify(state.reminders));
    renderReminders();
  }
}

function renderReminders() {
  const list = document.getElementById('full-reminders-list');
  if (!list) return;
  if (state.reminders.length === 0) {
    list.innerHTML = `<p style="font-size: 0.8rem; color: var(--text-muted);">No scheduled tasks.</p>`;
    return;
  }
  list.innerHTML = state.reminders.map(r => `
    <div class="task-item">
      <span>${escapeHtml(r.text)}</span>
      <i class="fa-solid fa-check" style="color:var(--accent-cyan)"></i>
    </div>
  `).join('');
}

function scrollToBottom() {
  const box = document.getElementById('chat-messages-container');
  if (box) box.scrollTop = box.scrollHeight;
}

function appendThinkingIndicator() {
  const box = document.getElementById('chat-messages-container');
  if (!box) return null;
  const id = 'thinking-' + Date.now();
  const el = document.createElement('div');
  el.className = 'chat-bubble assistant';
  el.id = id;
  el.innerHTML = `<div class="bubble-content" style="color: var(--accent-cyan);"><i class="fa-solid fa-brain fa-spin"></i> Processing...</div>`;
  box.appendChild(el);
  scrollToBottom();
  return id;
}

function removeThinkingIndicator(id) {
  if (!id) return;
  const el = document.getElementById(id);
  if (el) el.remove();
}

function formatMarkdown(str) {
  return str
    .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/\n\n/g, '<br><br>')
    .replace(/\n- /g, '<br>• ');
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function webSearchFallback() {
  const input = document.getElementById('chat-input');
  if (input && input.value) {
    window.open(`https://www.google.com/search?q=${encodeURIComponent(input.value)}`, '_blank');
  }
}

function speakText(text) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  window.speechSynthesis.speak(u);
}
  
