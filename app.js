// ==========================================
// BOSOMPEM AI PRO - FULL APP ENGINE
// ==========================================

const SYSTEM_INSTRUCTION = `You are Bosompem Pro, an elite standalone AI assistant.
Answer thoroughly, accurately, and directly using standard Markdown (Headers, Code blocks, bullet points).
Execute technical logic step-by-step.`;

const state = {
  userName: localStorage.getItem('bosompem_user_name') || '',
  apiKey: localStorage.getItem('bosompem_api_key') || '',
  model: localStorage.getItem('bosompem_model') || 'gemini-3.8-flash',
  deepResearchMode: localStorage.getItem('bosompem_research_mode') === 'true',
  
  sessions: JSON.parse(localStorage.getItem('bosompem_sessions') || '[]'),
  activeSessionId: null,
  
  isVoiceActive: false,
  reminders: JSON.parse(localStorage.getItem('bosompem_reminders') || '[]')
};

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;

// --- INITIALIZATION ---
window.addEventListener('DOMContentLoaded', () => {
  initVoiceEngine();
  loadSavedSettings();
  updateGreeting();
  renderReminders();

  if (state.sessions.length === 0) {
    createNewChatSession();
  } else {
    loadSession(state.sessions[0].id);
  }
});

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
}

function loadSession(sessionId) {
  state.activeSessionId = sessionId;
  renderHistorySidebar();

  const session = getActiveSession();
  const welcomeScreen = document.getElementById('welcome-screen');
  const messagesBox = document.getElementById('chat-messages-container');

  if (!session || session.messages.length === 0) {
    welcomeScreen.style.display = 'flex';
    messagesBox.style.display = 'none';
    messagesBox.innerHTML = '';
  } else {
    welcomeScreen.style.display = 'none';
    messagesBox.style.display = 'flex';
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
      <span>${s.title}</span>
    </div>
  `).join('');
}

function clearCurrentChat() {
  const session = getActiveSession();
  if (session && confirm("Clear current thread history?")) {
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
    alert("Please set your Gemini API Key in System Preferences first.");
    toggleSettings();
    return;
  }

  const session = getActiveSession();
  if (!session) return;

  // Set session title from first prompt
  if (session.messages.length === 0) {
    session.title = text.length > 28 ? text.substring(0, 28) + '...' : text;
  }

  // Hide welcome view
  document.getElementById('welcome-screen').style.display = 'none';
  const messagesBox = document.getElementById('chat-messages-container');
  messagesBox.style.display = 'flex';

  // Push user message
  session.messages.push({ role: 'user', text });
  renderMessages();
  saveSessionsToStorage();

  const thinkingId = appendThinkingIndicator();

  // Build payload history
  const contentsPayload = session.messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.text }]
  }));

  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${state.model}:generateContent?key=${encodeURIComponent(state.apiKey)}`;
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: contentsPayload,
        systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        generationConfig: { temperature: state.deepResearchMode ? 0.2 : 0.7 }
      })
    });

    const data = await response.json();
    removeThinkingIndicator(thinkingId);

    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "Unable to get response from Gemini API.";

    session.messages.push({ role: 'assistant', text: reply });
    saveSessionsToStorage();
    renderMessages();

    if (state.isVoiceActive) {
      speakText(reply.length > 250 ? reply.substring(0, 250) + "..." : reply);
    }

  } catch (err) {
    removeThinkingIndicator(thinkingId);
    session.messages.push({ role: 'assistant', text: "Error calling Gemini API. Please check your network and API key." });
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
  const input = document.getElementById('chat-input');
  const text = input.value;
  if (!text) return;
  input.value = '';
  sendChatMessage(text);
}

function usePromptPreset(type) {
  if (type === 'code') sendChatMessage("Review and optimize this code structure:");
  else if (type === 'deep') sendChatMessage("Provide a deep logical research analysis on:");
  else if (type === 'summarize') sendChatMessage("Provide an executive summary for:");
}

function insertPromptTemplate(type) {
  const input = document.getElementById('chat-input');
  if (type === 'deep') input.value = "Conduct deep technical research on: ";
  input.focus();
}

// --- VOICE ENGINE ---

function initVoiceEngine() {
  if (!SpeechRecognition) return;

  recognition = new SpeechRecognition();
  recognition.continuous = false;

  recognition.onresult = (e) => {
    const transcript = e.results[0][0].transcript;
    if (transcript) sendChatMessage(transcript);
  };

  recognition.onstart = () => updateVoiceUI(true);
  recognition.onend = () => updateVoiceUI(false);
}

function toggleLiveVoiceMode() {
  if (state.isVoiceActive) {
    state.isVoiceActive = false;
    if (recognition) recognition.stop();
  } else {
    state.isVoiceActive = true;
    if (recognition) recognition.start();
  }
}

function updateVoiceUI(active) {
  const chip = document.getElementById('voice-mode-trigger');
  const bar = document.getElementById('listening-indicator');
  if (active) {
    chip.classList.add('active');
    bar.classList.add('active');
  } else {
    chip.classList.remove('active');
    bar.classList.remove('active');
  }
}

// --- SETTINGS & HELPERS ---

function saveSettings() {
  const keyInput = document.getElementById('api-key');
  const modelSelect = document.getElementById('model-select');
  const deepToggle = document.getElementById('deep-research-toggle');

  state.apiKey = keyInput.value.trim();
  state.model = modelSelect.value;
  state.deepResearchMode = deepToggle.checked;

  localStorage.setItem('bosompem_api_key', state.apiKey);
  localStorage.setItem('bosompem_model', state.model);
  localStorage.setItem('bosompem_research_mode', state.deepResearchMode);

  document.getElementById('active-model-label').innerText = modelSelect.options[modelSelect.selectedIndex].text.split('(')[0];
  toggleSettings();
  alert("Preferences saved successfully!");
}

function loadSavedSettings() {
  document.getElementById('api-key').value = state.apiKey;
  document.getElementById('model-select').value = state.model;
  document.getElementById('deep-research-toggle').checked = state.deepResearchMode;
  document.getElementById('user-name-input').value = state.userName;
}

function switchModel(val) {
  state.model = val;
  localStorage.setItem('bosompem_model', val);
  document.getElementById('active-model-label').innerText = val;
}

function updateGreeting() {
  const hour = new Date().getHours();
  let timeStr = 'Good day';
  if (hour < 12) timeStr = 'Good morning';
  else if (hour < 18) timeStr = 'Good afternoon';
  else timeStr = 'Good evening';

  const greetingEl = document.getElementById('dynamic-greeting');
  if (greetingEl) {
    greetingEl.innerText = `${timeStr}${state.userName ? ', ' + state.userName : ''} 👑`;
  }
}

function saveUserProfile() {
  const val = document.getElementById('user-name-input').value.trim();
  state.userName = val;
  localStorage.setItem('bosompem_user_name', val);
  updateGreeting();
  closeAllModals();
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

function openModal(id) {
  closeAllModals();
  document.getElementById(id).classList.add('active');
}

function closeAllModals() {
  document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
}

function toggleSettings() {
  const panel = document.getElementById('settings-panel');
  panel.classList.toggle('active');
}

function scrollToBottom() {
  const box = document.getElementById('chat-viewport');
  if (box) box.scrollTop = box.scrollHeight;
}

function appendThinkingIndicator() {
  const box = document.getElementById('chat-messages-container');
  const id = 'thinking-' + Date.now();
  const el = document.createElement('div');
  el.className = 'chat-bubble assistant';
  el.id = id;
  el.innerHTML = `<div class="bubble-content" style="color: var(--accent-cyan);"><i class="fa-solid fa-brain fa-spin"></i> Reasoning...</div>`;
  box.appendChild(el);
  scrollToBottom();
  return id;
}

function removeThinkingIndicator(id) {
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
  const val = document.getElementById('chat-input').value;
  if (val) window.open(`https://www.google.com/search?q=${encodeURIComponent(val)}`, '_blank');
}

function triggerDeviceAction(action) {
  if (action === 'call') {
    const num = prompt("Enter phone number or contact name:");
    if (num) window.location.href = `tel:${encodeURIComponent(num)}`;
  }
}

function addReminder() {
  const text = prompt("Enter new task:");
  if (text) {
    state.reminders.unshift({ id: Date.now(), text, time: 'Scheduled' });
    localStorage.setItem('bosompem_reminders', JSON.stringify(state.reminders));
    renderReminders();
  }
}

function renderReminders() {
  const list = document.getElementById('full-reminders-list');
  if (!list) return;
  if (state.reminders.length === 0) {
    list.innerHTML = `<p style="font-size: 0.85rem; color: var(--text-muted);">No active tasks.</p>`;
    return;
  }
  list.innerHTML = state.reminders.map(r => `
    <div style="padding: 10px; background: rgba(255,255,255,0.03); border-radius: 8px; font-size:0.85rem; margin-bottom: 6px;">
      <strong>${r.text}</strong>
    </div>
  `).join('');
}

function speakText(text) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  window.speechSynthesis.speak(u);
                             }
