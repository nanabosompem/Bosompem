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

// --- DYNAMIC AUTO-EXPANDING INPUT BOX ---
function autoExpandTextarea(el) {
  if (!el) return;
  el.style.height = '28px'; // Reset base height for recalculation
  const newHeight = Math.min(el.scrollHeight, 180);
  el.style.height = newHeight + 'px';
  
  const consoleBox = document.getElementById('console-box');
  if (consoleBox) {
    consoleBox.style.alignItems = newHeight > 40 ? 'flex-end' : 'center';
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
  if (!text || !text.trim()) return;

  if (!state.apiKey) {
    alert("Please enter your Gemini API Key in System Preferences first.");
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

  // Reset textarea dynamically
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
        text: `API Error (${data.error.code || '404'}): ${data.error.message || 'Selected model not found or invalid API key.'}` 
      });
    } else {
      const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "No response content received.";
      session.messages.push({ role: 'assistant', text: reply });
      
      if (state.isLiveVoiceActive) {
        speakText(reply.length > 300 ? reply.substring(0, 300) + "..." : reply);
      }
    }

    saveSessionsToStorage();
    renderMessages();

  } catch (err) {
    removeThinkingIndicator(thinkingId);
    session.messages.push({ 
      role: 'assistant', 
      text: "Network connection error calling Gemini API." 
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
  if (type === 'code') sendChatMessage("Write a clean, optimized code module and explain its implementation:");
  else if (type === 'deep') sendChatMessage("Provide a deep technical and architectural research breakdown on:");
  else if (type === 'summarize') sendChatMessage("Extract actionable summary points and key takeaways for:");
}

function insertPromptTemplate(type) {
  const input = document.getElementById('chat-input');
  if (!input) return;
  if (type === 'deep') input.value = "Conduct deep technical research on: ";
  input.focus();
  autoExpandTextarea(input);
}

// --- IMPROVED LIVE & RECORD VOICE ENGINES ---
function initVoiceEngines() {
  if (!SpeechRecognition) return;

  // 1. Live Interactive Voice Mode
  liveRecognition = new SpeechRecognition();
  liveRecognition.continuous = false;
  liveRecognition.interimResults = false;
  liveRecognition.lang = 'en-US';

  liveRecognition.onresult = (e) => {
    const transcript = e.results[0][0].transcript;
    if (transcript && transcript.trim()) {
      sendChatMessage(transcript);
    }
  };

  liveRecognition.onend = () => {
    if (state.isLiveVoiceActive) {
      setTimeout(() => {
        try { liveRecognition.start(); } catch(err){}
      }, 300);
    }
  };

  // 2. Voice Dictation Engine
  voiceNoteRecognition = new SpeechRecognition();
  voiceNoteRecognition.continuous = true;
  voiceNoteRecognition.interimResults = true;
  voiceNoteRecognition.lang = 'en-US';

  let baseText = '';

  voiceNoteRecognition.onstart = () => {
    const input = document.getElementById('chat-input');
    baseText = input ? input.value : '';
  };

  voiceNoteRecognition.onresult = (e) => {
    let interimTranscript = '';
    let finalTranscript = '';

    for (let i = e.resultIndex; i < e.results.length; ++i) {
      if (e.results[i].isFinal) {
        finalTranscript += e.results[i][0].transcript;
      } else {
        interimTranscript += e.results[i][0].transcript;
      }
    }

    const input = document.getElementById('chat-input');
    if (input) {
      input.value = (baseText + ' ' + finalTranscript + ' ' + interimTranscript).trim();
      autoExpandTextarea(input);
    }
  };

  voiceNoteRecognition.onerror = () => {
    stopVoiceNoteRecording();
  };

  voiceNoteRecognition.onend = () => {
    stopVoiceNoteRecording();
  };
}

function toggleLiveVoiceMode() {
  if (!SpeechRecognition) {
    alert("Voice recognition is not supported on this device/browser.");
    return;
  }

  state.isLiveVoiceActive = !state.isLiveVoiceActive;
  const chip = document.getElementById('voice-mode-trigger');
  const bar = document.getElementById('listening-indicator');

  if (state.isLiveVoiceActive) {
    if (chip) chip.classList.add('active');
    if (bar) bar.classList.add('active');
    try { liveRecognition.start(); } catch(e){}
  } else {
    if (chip) chip.classList.remove('active');
    if (bar) bar.classList.remove('active');
    try { liveRecognition.stop(); } catch(e){}
  }
}

function toggleVoiceNoteRecording() {
  if (!SpeechRecognition) {
    alert("Voice dictation is not supported on this browser.");
    return;
  }

  if (state.isVoiceNoteRecording) {
    stopVoiceNoteRecording();
  } else {
    startVoiceNoteRecording();
  }
}

function startVoiceNoteRecording() {
  state.isVoiceNoteRecording = true;
  const btn = document.getElementById('voice-note-btn');
  if (btn) btn.classList.add('recording');
  try { voiceNoteRecognition.start(); } catch(e){}
}

function stopVoiceNoteRecording() {
  state.isVoiceNoteRecording = false;
  const btn = document.getElementById('voice-note-btn');
  if (btn) btn.classList.remove('recording');
  try { voiceNoteRecognition.stop(); } catch(e){}
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

  syncModelSelectDropdowns(state.model);
  toggleSettings();
  alert("Preferences saved successfully!");
}

function loadSavedSettings() {
  const keyInput = document.getElementById('api-key');
  const deepToggle = document.getElementById('deep-research-toggle');
  const nameInput = document.getElementById('user-name-input');

  if (keyInput) keyInput.value = state.apiKey;
  if (deepToggle) deepToggle.checked = state.deepResearchMode;
  if (nameInput) nameInput.value = state.userName;

  syncModelSelectDropdowns(state.model);
}

function switchModel(val) {
  state.model = val;
  localStorage.setItem('bosompem_model', val);
  syncModelSelectDropdowns(val);
}

function syncModelSelectDropdowns(val) {
  const topbarSelect = document.getElementById('topbar-model-select');
  const modalSelect = document.getElementById('model-select');
  const label = document.getElementById('active-model-label');

  if (topbarSelect) topbarSelect.value = val;
  if (modalSelect) modalSelect.value = val;
  
  if (label && topbarSelect && topbarSelect.selectedIndex >= 0) {
    label.innerText = topbarSelect.options[topbarSelect.selectedIndex].text;
  }
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
    state.userName = nameInput.value.trim();
    localStorage.setItem('bosompem_user_name', state.userName);
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

function addReminder() {
  const text = prompt("Enter new task:");
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
    list.innerHTML = `<p style="font-size: 0.85rem; color: var(--text-muted);">No scheduled tasks.</p>`;
    return;
  }
  list.innerHTML = state.reminders.map(r => `
    <div style="padding: 10px; background: rgba(255,255,255,0.03); border-radius: 8px; font-size:0.85rem; margin-bottom: 6px;">
      <strong>${escapeHtml(r.text)}</strong>
    </div>
  `).join('');
}

function speakText(text) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  window.speechSynthesis.speak(u);
                           }
