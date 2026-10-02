// ==========================================
// BOSOMPEM AI PRO - ENGINE & CONTROLLERS
// ==========================================

const SYSTEM_INSTRUCTION = `You are Bosompem Pro, an advanced AI assistant.
Answer thoroughly, accurately, and directly using clean Markdown formatting.`;

const state = {
  userName: localStorage.getItem('bosompem_user_name') || '',
  apiKey: localStorage.getItem('bosompem_api_key') || '',
  model: localStorage.getItem('bosompem_model') || 'gemini-2.5-flash',
  deepResearchMode: localStorage.getItem('bosompem_research_mode') === 'true',
  
  sessions: JSON.parse(localStorage.getItem('bosompem_sessions') || '[]'),
  activeSessionId: null,
  
  isLiveVoiceActive: false,
  isVoiceNoteRecording: false,
  reminders: JSON.parse(localStorage.getItem('bosompem_reminders') || '[]')
};

// Web Speech APIs
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let liveRecognition = null;
let voiceNoteRecognition = null;

// --- INITIALIZATION ---
window.addEventListener('DOMContentLoaded', () => {
  initVoiceEngines();
  loadSavedSettings();
  updateGreeting();
  renderReminders();

  if (state.sessions.length === 0) {
    createNewChatSession();
  } else {
    loadSession(state.sessions[0].id);
  }
});

// --- SIDEBAR TOGGLE ---
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (sidebar) sidebar.classList.toggle('open');
}

// --- AUTO-EXPANDING TEXTAREA ---
function autoExpandTextarea(el) {
  if (!el) return;
  el.style.height = 'auto';
  const newHeight = Math.min(el.scrollHeight, 160);
  el.style.height = newHeight + 'px';
  
  const consoleBox = document.getElementById('console-box');
  if (consoleBox) {
    consoleBox.style.alignItems = newHeight > 32 ? 'flex-end' : 'center';
  }
}

function handleTextareaKeyDown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleChatSubmit();
  }
}

// --- SESSION MANAGEMENT ---
function createNewChatSession() {
  const newSession = {
    id: 'session-' + Date.now(),
    title: 'New Conversation',
    messages: []
  };

  state.sessions.unshift(newSession);
  saveSessionsToStorage();
  loadSession(newSession.id);
  
  const sidebar = document.getElementById('sidebar');
  if (sidebar) sidebar.classList.remove('open');
}

function loadSession(sessionId) {
  state.activeSessionId = sessionId;
  renderHistorySidebar();

  const session = getActiveSession();
  const welcomeScreen = document.getElementById('welcome-screen');
  const messagesBox = document.getElementById('chat-messages-container');

  if (!session || session.messages.length === 0) {
    if (welcomeScreen) welcomeScreen.style.display = 'flex';
    if (messagesBox) {
      messagesBox.style.display = 'none';
      messagesBox.innerHTML = '';
    }
  } else {
    if (welcomeScreen) welcomeScreen.style.display = 'none';
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

function renderHistorySidebar() {
  const container = document.getElementById('history-list');
  if (!container) return;

  container.innerHTML = state.sessions.map(s => `
    <div class="history-item ${s.id === state.activeSessionId ? 'active' : ''}" onclick="loadSession('${s.id}')">
      <i class="fa-regular fa-message"></i>
      <span>${escapeHtml(s.title)}</span>
    </div>
  `).join('');
}

function clearCurrentChat() {
  const session = getActiveSession();
  if (session && confirm("Clear current thread messages?")) {
    session.messages = [];
    session.title = "New Conversation";
    saveSessionsToStorage();
    loadSession(session.id);
  }
}

// --- CHAT API & MESSAGING ---
async function sendChatMessage(text) {
  if (!text.trim()) return;

  if (!state.apiKey) {
    alert("Please set your Gemini API Key in Settings first.");
    toggleSettings();
    return;
  }

  const session = getActiveSession();
  if (!session) return;

  if (session.messages.length === 0) {
    session.title = text.length > 28 ? text.substring(0, 28) + '...' : text;
  }

  const welcomeScreen = document.getElementById('welcome-screen');
  if (welcomeScreen) welcomeScreen.style.display = 'none';

  const messagesBox = document.getElementById('chat-messages-container');
  if (messagesBox) messagesBox.style.display = 'flex';

  session.messages.push({ role: 'user', text });
  renderMessages();
  saveSessionsToStorage();

  const thinkingId = appendThinkingIndicator();

  // Reset textarea
  const textarea = document.getElementById('chat-input');
  if (textarea) {
    textarea.value = '';
    autoExpandTextarea(textarea);
  }

  const contentsPayload = session.messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.text }]
  }));

  try {
    // Dynamic Model Selection based on dropdown/state
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
        text: `API Error (${data.error.code || '404'}): ${data.error.message || 'Model not found or request denied.'}` 
      });
    } else {
      const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "No response content received.";
      session.messages.push({ role: 'assistant', text: reply });
      
      if (state.isLiveVoiceActive) {
        speakText(reply.length > 250 ? reply.substring(0, 250) + "..." : reply);
      }
    }

    saveSessionsToStorage();
    renderMessages();

  } catch (err) {
    removeThinkingIndicator(thinkingId);
    session.messages.push({ 
      role: 'assistant', 
      text: "Network error calling Gemini API. Please check your connection or API key." 
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
  const text = textarea.value;
  if (!text.trim()) return;
  sendChatMessage(text);
}

function usePromptPreset(type) {
  if (type === 'code') sendChatMessage("Write a clean code snippet and explain its structure:");
  else if (type === 'deep') sendChatMessage("Provide a deep technical breakdown on:");
  else if (type === 'summarize') sendChatMessage("Extract actionable summary points for:");
}

function insertPromptTemplate(type) {
  const input = document.getElementById('chat-input');
  if (!input) return;
  if (type === 'deep') input.value = "Conduct deep technical research on: ";
  input.focus();
  autoExpandTextarea(input);
}

// --- VOICE RECOGNITION ---
function initVoiceEngines() {
  if (!SpeechRecognition) return;

  liveRecognition = new SpeechRecognition();
  liveRecognition.continuous = false;
  liveRecognition.onresult = (e) => {
    const transcript = e.results[0][0].transcript;
    if (transcript) sendChatMessage(transcript);
  };
  liveRecognition.onend = () => {
    if (state.isLiveVoiceActive) liveRecognition.start();
  };

  voiceNoteRecognition = new SpeechRecognition();
  voiceNoteRecognition.continuous = false;
  voiceNoteRecognition.onresult = (e) => {
    const transcript = e.results[0][0].transcript;
    const input = document.getElementById('chat-input');
    if (input) {
      input.value += (input.value ? ' ' : '') + transcript;
      autoExpandTextarea(input);
    }
  };
  voiceNoteRecognition.onend = () => {
    state.isVoiceNoteRecording = false;
    const btn = document.getElementById('voice-note-btn');
    if (btn) btn.classList.remove('recording');
  };
}

function toggleLiveVoiceMode() {
  if (!SpeechRecognition) {
    alert("Speech recognition is not supported in this browser.");
    return;
  }

  state.isLiveVoiceActive = !state.isLiveVoiceActive;
  const chip = document.getElementById('voice-mode-trigger');
  const bar = document.getElementById('listening-indicator');

  if (state.isLiveVoiceActive) {
    if (chip) chip.classList.add('active');
    if (bar) bar.classList.add('active');
    liveRecognition.start();
  } else {
    if (chip) chip.classList.remove('active');
    if (bar) bar.classList.remove('active');
    liveRecognition.stop();
  }
}

function toggleVoiceNoteRecording() {
  if (!SpeechRecognition) {
    alert("Speech recognition is not supported in this browser.");
    return;
  }

  const btn = document.getElementById('voice-note-btn');
  if (state.isVoiceNoteRecording) {
    voiceNoteRecognition.stop();
  } else {
    state.isVoiceNoteRecording = true;
    if (btn) btn.classList.add('recording');
    voiceNoteRecognition.start();
  }
}

// --- MODALS & SETTINGS ---
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

  const label = document.getElementById('active-model-label');
  if (label && modelSelect) {
    label.innerText = modelSelect.options[modelSelect.selectedIndex].text.split('(')[0];
  }

  toggleSettings();
  alert("Preferences saved successfully!");
}

function loadSavedSettings() {
  const keyInput = document.getElementById('api-key');
  const modelSelect = document.getElementById('model-select');
  const deepToggle = document.getElementById('deep-research-toggle');
  const nameInput = document.getElementById('user-name-input');
  const label = document.getElementById('active-model-label');

  if (keyInput) keyInput.value = state.apiKey;
  if (modelSelect) modelSelect.value = state.model;
  if (deepToggle) deepToggle.checked = state.deepResearchMode;
  if (nameInput) nameInput.value = state.userName;
  if (label && modelSelect && modelSelect.selectedIndex >= 0) {
    label.innerText = modelSelect.options[modelSelect.selectedIndex].text.split('(')[0];
  }
}

function switchModel(val) {
  state.model = val;
  localStorage.setItem('bosompem_model', val);
  const label = document.getElementById('active-model-label');
  if (label) label.innerText = val;
}

function updateGreeting() {
  const greetingEl = document.getElementById('dynamic-greeting');
  if (greetingEl) {
    greetingEl.innerText = `Hello${state.userName ? ', ' + state.userName : ''}`;
  }
}

function saveUserProfile() {
  const nameInput = document.getElementById('user-name-input');
  if (nameInput) {
    const val = nameInput.value.trim();
    state.userName = val;
    localStorage.setItem('bosompem_user_name', val);
    updateGreeting();
  }
  closeAllModals();
}

function openModal(id) {
  closeAllModals();
  const target = document.getElementById(id);
  if (target) target.classList.add('active');
}

function closeAllModals() {
  document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
}

function toggleSettings() {
  const panel = document.getElementById('settings-panel');
  if (panel) panel.classList.toggle('active');
}

function scrollToBottom() {
  const box = document.getElementById('chat-viewport');
  if (box) box.scrollTop = box.scrollHeight;
}

function appendThinkingIndicator() {
  const box = document.getElementById('chat-messages-container');
  if (!box) return null;
  const id = 'thinking-' + Date.now();
  const el = document.createElement('div');
  el.className = 'chat-bubble assistant';
  el.id = id;
  el.innerHTML = `<div class="bubble-content" style="color: var(--accent-cyan);"><i class="fa-solid fa-brain fa-spin"></i> Thinking...</div>`;
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
    .replace(/```([\s\S]*?)
  
