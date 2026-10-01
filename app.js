// ==========================================
// BOSOMPEM AI - CORE ENGINE & DUAL LIVE CONTROLLER
// ==========================================

const state = {
  apiKey: localStorage.getItem('bosompem_api_key') || '',
  model: localStorage.getItem('bosompem_model') || 'gemini-3.8-flash',
  activeLiveMode: null, // 'device' or 'chat'
  
  // Voice Verification
  ownerVoicePrint: JSON.parse(localStorage.getItem('bosompem_voice_print') || 'null'),
  
  // App Storage
  history: JSON.parse(localStorage.getItem('bosompem_chat_history') || '[]'),
  reminders: JSON.parse(localStorage.getItem('bosompem_reminders') || [
    { id: 1, text: 'Call Cousin', time: '10:00 AM' },
    { id: 2, text: 'Review App Design', time: '02:30 PM' }
  ]),
  tasks: JSON.parse(localStorage.getItem('bosompem_tasks') || [
    { id: 1, text: 'Complete Bosompem Setup', done: false }
  ])
};

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let silenceTimer = null;
const SILENCE_TIMEOUT_MS = 2000; // 2 Seconds response trigger

// --- INITIALIZATION ---
window.addEventListener('DOMContentLoaded', () => {
  initVoiceEngine();
  renderReminders();
  renderTasks();
  loadSavedSettings();
});

// ==========================================
// 1. VOICE ENGINE (2-SECOND RESPONSE SILENCE DETECTOR)
// ==========================================

function initVoiceEngine() {
  if (!SpeechRecognition) return;

  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;

  let currentTranscript = '';

  recognition.onresult = (e) => {
    // Reset silence timer every time user is actively speaking
    clearTimeout(silenceTimer);

    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; ++i) {
      if (e.results[i].isFinal) {
        currentTranscript += e.results[i][0].transcript + ' ';
      } else {
        interim += e.results[i][0].transcript;
      }
    }

    const liveText = interim || currentTranscript || "Listening...";
    updateVoiceStatusText(liveText);

    // Set 2-second timer: Executes response 2 seconds after speech pauses
    silenceTimer = setTimeout(() => {
      const queryToProcess = (currentTranscript + ' ' + interim).trim();
      if (queryToProcess.length > 0) {
        recognition.stop();
        processLiveQuery(queryToProcess);
        currentTranscript = '';
      }
    }, SILENCE_TIMEOUT_MS);
  };

  recognition.onstart = () => updateListeningUI(true);
  recognition.onend = () => updateListeningUI(false);
}

function startLiveMode(modeType) {
  if (!state.apiKey && modeType === 'chat') {
    alert("Please set your Gemini API key in Preferences first.");
    toggleSettings();
    return;
  }

  state.activeLiveMode = modeType;
  updateLiveCardUI(modeType);

  navigator.mediaDevices.getUserMedia({ audio: true })
    .then(() => {
      if (recognition) {
        try { recognition.start(); } catch (e) {}
      }
    })
    .catch(() => alert("Microphone permission is required for Live Mode."));
}

function stopLiveMode() {
  state.activeLiveMode = null;
  if (recognition) try { recognition.stop(); } catch (e) {}
  clearTimeout(silenceTimer);
  resetLiveCardUI();
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}

async function processLiveQuery(query) {
  if (state.activeLiveMode === 'device') {
    // Execute direct hardware/device tasks
    handleDeviceCommand(query);
  } else if (state.activeLiveMode === 'chat') {
    // Execute instant AI streaming chat answer
    await sendChatMessage(query, true);
  }
}

// ==========================================
// 2. DEVICE CONTROL ENGINE (LIVE MODE 1)
// ==========================================

function handleDeviceCommand(rawQuery) {
  const query = rawQuery.toLowerCase().trim();

  if (query.includes('call') || query.includes('dial')) {
    const target = query.replace('call', '').replace('dial', '').trim();
    speakText(`Initiating call to ${target || 'contact'}`);
    window.location.href = `tel:${encodeURIComponent(target)}`;
  } 
  else if (query.includes('message') || query.includes('text')) {
    const parts = query.replace('send a message to', '').replace('text', '').trim().split('saying');
    const recipient = parts[0] ? parts[0].trim() : '';
    const msg = parts[1] ? parts[1].trim() : '';
    speakText(`Opening SMS to ${recipient}`);
    window.location.href = `sms:${encodeURIComponent(recipient)}?body=${encodeURIComponent(msg)}`;
  }
  else if (query.includes('open chat') || query.includes('talk to ai')) {
    speakText("Opening AI Chat");
    openChatModal();
  }
  else if (query.includes('open app') || query.includes('launch')) {
    const app = query.replace('open app', '').replace('open', '').replace('launch', '').trim();
    speakText(`Opening ${app}`);
    openAppCategory(app);
  }
  else if (query.includes('reminder') || query.includes('remind me')) {
    const task = query.replace('set a reminder to', '').replace('remind me to', '').trim();
    addReminder(task);
    speakText(`Reminder added for ${task}`);
  }
  else if (query.includes('search')) {
    const term = query.replace('search for', '').replace('search the web for', '').replace('search', '').trim();
    speakText(`Searching the web for ${term}`);
    window.open(`https://www.google.com/search?q=${encodeURIComponent(term)}`, '_blank');
  }
  else {
    speakText(`Command received: ${rawQuery}. Processing device action.`);
  }

  // Resume listening after voice response finishes
  setTimeout(() => {
    if (state.activeLiveMode === 'device') startLiveMode('device');
  }, 3000);
}

// ==========================================
// 3. AI CHAT ENGINE (LIVE MODE 2 & CHAT MODAL)
// ==========================================

async function sendChatMessage(text, isVoiceMode = false) {
  if (!text.trim()) return;

  if (!state.apiKey) {
    alert("Please enter your Gemini API Key in Settings.");
    toggleSettings();
    return;
  }

  appendChatMessage('user', text);

  // Context windowing (keep recent turns)
  if (state.history.length > 20) state.history = state.history.slice(-20);
  
  state.history.push({ role: 'user', parts: [{ text }] });

  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${state.model}:generateContent?key=${encodeURIComponent(state.apiKey)}`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: state.history })
    });

    const data = await response.json();
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "I'm ready for your next question.";

    state.history.push({ role: 'model', parts: [{ text: reply }] });
    localStorage.setItem('bosompem_chat_history', JSON.stringify(state.history));

    appendChatMessage('assistant', reply);

    if (isVoiceMode) {
      speakText(reply, () => {
        if (state.activeLiveMode === 'chat') startLiveMode('chat');
      });
    }
  } catch (e) {
    appendChatMessage('assistant', 'Error fetching response. Please check your API key.');
  }
}

// ==========================================
// 4. UI MODALS & NAVIGATION ROUTER
// ==========================================

function switchTab(tabName, element) {
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  if (element) element.classList.add('active');

  if (tabName === 'chat') openChatModal();
  else if (tabName === 'apps') openSectionModal('apps-modal');
  else if (tabName === 'memory') openSectionModal('memory-modal');
  else if (tabName === 'profile') openSectionModal('profile-modal');
  else closeAllModals();
}

function triggerQuickAction(action) {
  if (action === 'chat') openChatModal();
  else if (action === 'call') openCallModal();
  else if (action === 'reminder') openSectionModal('reminders-modal');
  else if (action === 'tasks') openSectionModal('tasks-modal');
  else if (action === 'apps') openSectionModal('apps-modal');
  else if (action === 'message') openMessageModal();
  else if (action === 'search') openSearchModal();
}

function openChatModal() {
  closeAllModals();
  document.getElementById('chat-modal').classList.add('active');
}

function closeChatModal() {
  document.getElementById('chat-modal').classList.remove('active');
}

function openSectionModal(modalId) {
  closeAllModals();
  const el = document.getElementById(modalId);
  if (el) el.classList.add('active');
}

function closeAllModals() {
  document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
}

function toggleSettings() {
  const panel = document.getElementById('settings-panel');
  panel.classList.toggle('active');
}

// --- QUICK MODAL ACTION HELPERS ---
function openCallModal() {
  const num = prompt("Enter phone number or contact name to call:");
  if (num) window.location.href = `tel:${encodeURIComponent(num)}`;
}

function openMessageModal() {
  const num = prompt("Recipient phone number:");
  if (num) {
    const body = prompt("Type your message:");
    window.location.href = `sms:${encodeURIComponent(num)}?body=${encodeURIComponent(body || '')}`;
  }
}

function openSearchModal() {
  const term = prompt("Enter search query:");
  if (term) window.open(`https://www.google.com/search?q=${encodeURIComponent(term)}`, '_blank');
}

function openAppCategory(appName) {
  alert(`Launching ${appName}...`);
}

// ==========================================
// 5. REMINDERS & TASKS STORAGE RENDERING
// ==========================================

function addReminder(textInput) {
  const text = textInput || prompt("Enter reminder details:");
  if (!text) return;
  
  state.reminders.unshift({ id: Date.now(), text, time: 'Just now' });
  localStorage.setItem('bosompem_reminders', JSON.stringify(state.reminders));
  renderReminders();
}

function renderReminders() {
  const list = document.getElementById('overview-reminders-list');
  const modalList = document.getElementById('full-reminders-list');
  if (!list) return;

  if (state.reminders.length === 0) {
    list.innerHTML = `<p style="font-size: 0.8rem; color: var(--text-muted);">No upcoming reminders.</p>`;
    if (modalList) modalList.innerHTML = list.innerHTML;
    return;
  }

  const html = state.reminders.map(r => `
    <div class="list-item">
      <div class="item-left">
        <div class="icon-badge" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8;"><i class="fa-solid fa-clock"></i></div>
        <div class="item-details">
          <p>${r.text}</p>
          <span>${r.time}</span>
        </div>
      </div>
    </div>
  `).join('');

  list.innerHTML = html;
  if (modalList) modalList.innerHTML = html;
}

function addTask() {
  const text = prompt("Enter task title:");
  if (!text) return;
  state.tasks.unshift({ id: Date.now(), text, done: false });
  localStorage.setItem('bosompem_tasks', JSON.stringify(state.tasks));
  renderTasks();
}

function renderTasks() {
  const modalList = document.getElementById('full-tasks-list');
  if (!modalList) return;

  modalList.innerHTML = state.tasks.map(t => `
    <div class="list-item">
      <div class="item-left">
        <div class="icon-badge" style="background: rgba(251, 146, 60, 0.15); color: #fb923c;"><i class="fa-solid fa-check"></i></div>
        <div class="item-details"><p>${t.text}</p></div>
      </div>
    </div>
  `).join('');
}

// ==========================================
// 6. UI STATE HELPERS
// ==========================================

function updateLiveCardUI(mode) {
  const btn1 = document.getElementById('live-device-btn');
  const btn2 = document.getElementById('live-chat-btn');
  
  if (mode === 'device') {
    btn1.classList.add('active');
    btn2.classList.remove('active');
  } else {
    btn2.classList.add('active');
    btn1.classList.remove('active');
  }
}

function resetLiveCardUI() {
  document.getElementById('live-device-btn').classList.remove('active');
  document.getElementById('live-chat-btn').classList.remove('active');
  document.getElementById('voice-status-text').innerText = "Select a Live mode above to speak";
}

function updateVoiceStatusText(msg) {
  const el = document.getElementById('voice-status-text');
  if (el) el.innerText = msg;
}

function updateListeningUI(active) {
  const bar = document.getElementById('listening-indicator');
  if (bar) {
    if (active) bar.classList.add('active');
    else bar.classList.remove('active');
  }
}

function appendChatMessage(sender, text) {
  const box = document.getElementById('chat-modal-messages');
  if (!box) return;
  const msg = document.createElement('div');
  msg.className = `chat-msg ${sender}`;
  msg.innerText = text;
  box.appendChild(msg);
  box.scrollTop = box.scrollHeight;
}

function handleChatSubmit() {
  const input = document.getElementById('chat-modal-input');
  const text = input.value;
  if (!text) return;
  input.value = '';
  sendChatMessage(text, false);
}

function speakText(text, onEndCallback) {
  if (!('speechSynthesis' in window)) {
    if (onEndCallback) onEndCallback();
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.onend = () => { if (onEndCallback) onEndCallback(); };
  utterance.onerror = () => { if (onEndCallback) onEndCallback(); };
  window.speechSynthesis.speak(utterance);
}

function saveSettings() {
  const key = document.getElementById('api-key').value;
  const model = document.getElementById('model-select').value;
  state.apiKey = key;
  state.model = model;
  localStorage.setItem('bosompem_api_key', key);
  localStorage.setItem('bosompem_model', model);
  toggleSettings();
  alert("Preferences saved successfully!");
}

function loadSavedSettings() {
  if (document.getElementById('api-key')) document.getElementById('api-key').value = state.apiKey;
  if (document.getElementById('model-select')) document.getElementById('model-select').value = state.model;
}

async function captureOwnerVoicePrint() {
  alert("Voice biometric signature capture initialized. Say 'Hey Bosompem' when prompted.");
           }
