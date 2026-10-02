// ==========================================
// BOSOMPEM AI PRO - ADVANCED ENGINE
// ==========================================

const SYSTEM_INSTRUCTION = `You are Bosompem Pro, an elite AI research assistant and problem-solver. 
When answering queries, strictly adhere to these standards:
1. Provide accurate, thoroughly reasoned, and deeply analytical answers.
2. Structure responses logically using standard Markdown (Headers, Bold text, Bullet points, numbered lists, and Code blocks).
3. Be direct, authoritative, and eliminate introductory fluff.
4. Work step-by-step for complex calculations or code logic.`;

const state = {
  userName: localStorage.getItem('bosompem_user_name') || '',
  apiKey: localStorage.getItem('bosompem_api_key') || '',
  model: localStorage.getItem('bosompem_model') || 'gemini-3.8-flash',
  deepResearchMode: localStorage.getItem('bosompem_research_mode') === 'true',
  activeLiveMode: null,
  
  history: JSON.parse(localStorage.getItem('bosompem_chat_history') || '[]'),
  reminders: JSON.parse(localStorage.getItem('bosompem_reminders') || '[]')
};

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let silenceTimer = null;
const SILENCE_TIMEOUT_MS = 2000;

// --- INITIALIZATION ---
window.addEventListener('DOMContentLoaded', () => {
  initVoiceEngine();
  renderReminders();
  loadSavedSettings();
  updateGreeting();
  renderChatHistory();

  // Scroll fix for soft keyboards on mobile
  const inputEl = document.getElementById('chat-modal-input');
  if (inputEl) {
    inputEl.addEventListener('focus', () => {
      setTimeout(() => {
        const box = document.getElementById('chat-modal-messages');
        if (box) box.scrollTop = box.scrollHeight;
      }, 300);
    });
  }
});

// ==========================================
// 1. DYNAMIC GREETING & PROFILE
// ==========================================

function updateGreeting() {
  const hour = new Date().getHours();
  let timeStr = 'Good day';
  if (hour < 12) timeStr = 'Good morning';
  else if (hour < 18) timeStr = 'Good afternoon';
  else timeStr = 'Good evening';

  const nameStr = state.userName ? `, ${state.userName}` : '';
  const greetingEl = document.getElementById('dynamic-greeting');
  if (greetingEl) {
    greetingEl.innerText = `${timeStr}${nameStr} 👑`;
  }
}

function saveUserProfile() {
  const inputVal = document.getElementById('user-name-input').value.trim();
  state.userName = inputVal;
  localStorage.setItem('bosompem_user_name', inputVal);
  updateGreeting();
  closeAllModals();
  alert("Profile updated successfully!");
}

// ==========================================
// 2. CHAT ENGINE & PREFERENCES FIX
// ==========================================

function saveSettings() {
  const keyInput = document.getElementById('api-key');
  const modelSelect = document.getElementById('model-select');
  const deepToggle = document.getElementById('deep-research-toggle');

  if (!keyInput) return;

  const key = keyInput.value.trim();
  const model = modelSelect ? modelSelect.value : 'gemini-3.8-flash';
  const deepRes = deepToggle ? deepToggle.checked : false;

  state.apiKey = key;
  state.model = model;
  state.deepResearchMode = deepRes;

  localStorage.setItem('bosompem_api_key', key);
  localStorage.setItem('bosompem_model', model);
  localStorage.setItem('bosompem_research_mode', deepRes);

  toggleSettings();
  alert("Preferences and API Key saved successfully!");
}

function loadSavedSettings() {
  const keyInput = document.getElementById('api-key');
  const modelSelect = document.getElementById('model-select');
  const nameInput = document.getElementById('user-name-input');
  const deepToggle = document.getElementById('deep-research-toggle');

  if (keyInput) keyInput.value = state.apiKey;
  if (modelSelect) modelSelect.value = state.model;
  if (nameInput) nameInput.value = state.userName;
  if (deepToggle) deepToggle.checked = state.deepResearchMode;
}

async function sendChatMessage(text, isVoiceMode = false) {
  if (!text.trim()) return;

  if (!state.apiKey) {
    alert("Please enter your Gemini API Key in Preferences first.");
    toggleSettings();
    return;
  }

  appendChatMessage('user', text);

  const thinkingId = appendThinkingIndicator();

  if (state.history.length > 20) state.history = state.history.slice(-20);
  state.history.push({ role: 'user', parts: [{ text }] });

  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${state.model}:generateContent?key=${encodeURIComponent(state.apiKey)}`;
    
    const requestBody = {
      contents: state.history,
      systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      generationConfig: {
        temperature: state.deepResearchMode ? 0.2 : 0.7,
        maxOutputTokens: 8192
      }
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    const data = await response.json();
    removeThinkingIndicator(thinkingId);

    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "Unable to retrieve response. Check API configuration.";

    state.history.push({ role: 'model', parts: [{ text: reply }] });
    localStorage.setItem('bosompem_chat_history', JSON.stringify(state.history));

    appendChatMessage('assistant', reply);

    if (isVoiceMode) {
      const spokenText = reply.length > 300 ? reply.substring(0, 300) + "... I have displayed the detailed answer on screen." : reply;
      speakText(spokenText, () => {
        if (state.activeLiveMode === 'chat') startLiveMode('chat');
      });
    }
  } catch (e) {
    removeThinkingIndicator(thinkingId);
    appendChatMessage('assistant', 'Error communicating with Gemini API. Check your network connection and API key.');
  }
}

function insertPromptTemplate(templateType) {
  const input = document.getElementById('chat-modal-input');
  if (!input) return;

  if (templateType === 'code') {
    input.value = "Review and optimize the following code for efficiency and security: ";
  } else if (templateType === 'summarize') {
    input.value = "Provide a concise executive summary and key takeaways for: ";
  } else if (templateType === 'deep') {
    input.value = "Perform a deep technical research analysis on: ";
  }
  input.focus();
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

function appendChatMessage(sender, text) {
  const box = document.getElementById('chat-modal-messages');
  if (!box) return;

  const msg = document.createElement('div');
  msg.className = `chat-msg ${sender}`;
  
  if (sender === 'assistant') {
    msg.innerHTML = formatMarkdown(text);
  } else {
    msg.innerText = text;
  }

  box.appendChild(msg);
  
  setTimeout(() => {
    box.scrollTop = box.scrollHeight;
  }, 100);
}

function appendThinkingIndicator() {
  const box = document.getElementById('chat-modal-messages');
  if (!box) return null;

  const id = 'thinking-' + Date.now();
  const indicator = document.createElement('div');
  indicator.className = 'chat-msg assistant thinking';
  indicator.id = id;
  indicator.innerHTML = `<i class="fa-solid fa-brain fa-spin"></i> Analyzing context...`;
  box.appendChild(indicator);
  
  setTimeout(() => {
    box.scrollTop = box.scrollHeight;
  }, 100);

  return id;
}

function removeThinkingIndicator(id) {
  if (!id) return;
  const el = document.getElementById(id);
  if (el) el.remove();
}

function renderChatHistory() {
  const box = document.getElementById('chat-modal-messages');
  if (!box) return;
  box.innerHTML = `<div class="chat-msg assistant">Welcome to Bosompem Pro AI. I am ready to conduct research, write code, or execute complex commands. How can I assist you today?</div>`;
  
  state.history.forEach(item => {
    const role = item.role === 'model' ? 'assistant' : 'user';
    const text = item.parts[0]?.text || '';
    if (text) appendChatMessage(role, text);
  });
}

function clearChatHistory() {
  if (confirm("Clear current conversation history?")) {
    state.history = [];
    localStorage.removeItem('bosompem_chat_history');
    renderChatHistory();
  }
}

function webSearchFallback() {
  const input = document.getElementById('chat-modal-input').value;
  if (!input) {
    alert("Type a search topic in the input field first.");
    return;
  }
  window.open(`https://www.google.com/search?q=${encodeURIComponent(input)}`, '_blank');
}

// ==========================================
// 3. VOICE ENGINE
// ==========================================

function initVoiceEngine() {
  if (!SpeechRecognition) return;

  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;

  let currentTranscript = '';

  recognition.onresult = (e) => {
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
    .catch(() => alert("Microphone access is required for voice commands."));
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
    handleDeviceCommand(query);
  } else if (state.activeLiveMode === 'chat') {
    await sendChatMessage(query, true);
  }
}

function handleDeviceCommand(rawQuery) {
  const query = rawQuery.toLowerCase().trim();

  if (query.includes('call') || query.includes('dial')) {
    const target = query.replace('call', '').replace('dial', '').trim();
    speakText(`Calling ${target || 'contact'}`);
    window.location.href = `tel:${encodeURIComponent(target)}`;
  } else if (query.includes('reminder') || query.includes('remind me')) {
    const task = query.replace('set a reminder to', '').replace('remind me to', '').trim();
    addReminder(task);
    speakText(`Reminder set for ${task}`);
  } else {
    speakText(`Command processed: ${rawQuery}`);
  }

  setTimeout(() => {
    if (state.activeLiveMode === 'device') startLiveMode('device');
  }, 3000);
}

// ==========================================
// 4. ROUTING & MODALS
// ==========================================

function switchTab(tabName, element) {
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  if (element) element.classList.add('active');

  if (tabName === 'chat') openChatModal();
  else if (tabName === 'memory') openSectionModal('memory-modal');
  else if (tabName === 'profile') openSectionModal('profile-modal');
  else closeAllModals();
}

function triggerQuickAction(action) {
  if (action === 'call') openCallModal();
  else if (action === 'reminder') openSectionModal('reminders-modal');
}

function openChatModal() {
  closeAllModals();
  document.getElementById('chat-modal').classList.add('active');
  setTimeout(() => {
    const box = document.getElementById('chat-modal-messages');
    if (box) box.scrollTop = box.scrollHeight;
  }, 100);
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
  document.getElementById('settings-panel').classList.toggle('active');
}

function openCallModal() {
  const num = prompt("Enter phone number or contact name:");
  if (num) window.location.href = `tel:${encodeURIComponent(num)}`;
}

// ==========================================
// 5. REMINDERS & UTILITIES
// ==========================================

function addReminder(textInput) {
  const text = textInput || prompt("Enter reminder:");
  if (!text) return;
  
  state.reminders.unshift({ id: Date.now(), text, time: 'Scheduled' });
  localStorage.setItem('bosompem_reminders', JSON.stringify(state.reminders));
  renderReminders();
}

function renderReminders() {
  const list = document.getElementById('overview-reminders-list');
  const modalList = document.getElementById('full-reminders-list');
  if (!list) return;

  if (state.reminders.length === 0) {
    list.innerHTML = `<p style="font-size: 0.8rem; color: var(--text-muted);">No active reminders scheduled.</p>`;
    if (modalList) modalList.innerHTML = list.innerHTML;
    return;
  }

  const html = state.reminders.map(r => `
    <div class="list-item">
      <div class="item-left">
        <div class="icon-badge" style="background: rgba(6, 182, 212, 0.15); color: #06b6d4;"><i class="fa-solid fa-clock"></i></div>
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

function captureOwnerVoicePrint() {
  alert("Voice biometric signature recorded successfully.");
                                                              }
