// --- Bosompem Assistant Core State ---
const state = {
  apiKey: localStorage.getItem('bosompem_api_key') || '',
  model: localStorage.getItem('bosompem_model') || 'gemini-3.8-flash',
  speaker: localStorage.getItem('bosompem_speaker') || '',
  speed: parseFloat(localStorage.getItem('bosompem_speed') || '1.0'),
  liveMode: false,
  wakeWordListening: true,
  history: [],
  reminders: JSON.parse(localStorage.getItem('bosompem_reminders') || '[]'),
  tasks: JSON.parse(localStorage.getItem('bosompem_tasks') || '[]'),
  activeTab: 'home'
};

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let wakeWordRecognizer = null;

// --- Initialize Hands-Free Voice Engine ---
function initVoiceEngine() {
  if (!SpeechRecognition) {
    console.warn('Speech Recognition API not supported in this environment.');
    return;
  }

  // Active Command Recognizer
  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = true;

  recognition.onstart = () => {
    updateListeningUI(true);
  };

  recognition.onresult = (e) => {
    let interim = '';
    let finalTranscript = '';

    for (let i = e.resultIndex; i < e.results.length; ++i) {
      if (e.results[i].isFinal) {
        finalTranscript += e.results[i][0].transcript;
      } else {
        interim += e.results[i][0].transcript;
      }
    }

    const liveTextNode = document.getElementById('voice-status-text');
    if (liveTextNode) liveTextNode.innerText = interim || finalTranscript || "Listening...";

    if (finalTranscript) {
      handleVoiceCommand(finalTranscript);
    }
  };

  recognition.onerror = (e) => {
    updateListeningUI(false);
    if (state.liveMode) restartWakeWordDetection();
  };

  recognition.onend = () => {
    updateListeningUI(false);
    if (state.liveMode) {
      // Re-enable background wake-word listener if hands-free live mode stays active
      restartWakeWordDetection();
    }
  };

  // Background Wake Word Detector ("Hey Bosompem")
  wakeWordRecognizer = new SpeechRecognition();
  wakeWordRecognizer.continuous = true;
  wakeWordRecognizer.interimResults = true;

  wakeWordRecognizer.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; ++i) {
      const phrase = e.results[i][0].transcript.toLowerCase();
      if (phrase.includes('hey bosompem') || phrase.includes('bosompem')) {
        wakeWordRecognizer.stop();
        speakText("I'm listening", () => {
          activateLiveMode();
        });
        break;
      }
    }
  };

  wakeWordRecognizer.onend = () => {
    if (state.wakeWordListening && !state.liveMode) {
      try { wakeWordRecognizer.start(); } catch (err) {}
    }
  };

  startWakeWordDetection();
}

function startWakeWordDetection() {
  if (wakeWordRecognizer && state.wakeWordListening && !state.liveMode) {
    try { wakeWordRecognizer.start(); } catch (err) {}
  }
}

function restartWakeWordDetection() {
  setTimeout(() => { startWakeWordDetection(); }, 1000);
}

// --- Live Chat Mode Switcher ---
function toggleLiveMode() {
  if (state.liveMode) {
    deactivateLiveMode();
  } else {
    activateLiveMode();
  }
}

function activateLiveMode() {
  state.liveMode = true;
  if (wakeWordRecognizer) {
    try { wakeWordRecognizer.stop(); } catch (err) {}
  }

  const micBtn = document.getElementById('main-mic-btn');
  if (micBtn) micBtn.classList.add('active');

  const liveTextNode = document.getElementById('voice-status-text');
  if (liveTextNode) liveTextNode.innerText = "Listening... Speak your command";

  if (recognition) {
    try { recognition.start(); } catch (err) {}
  }
}

function deactivateLiveMode() {
  state.liveMode = false;
  const micBtn = document.getElementById('main-mic-btn');
  if (micBtn) micBtn.classList.remove('active');

  const liveTextNode = document.getElementById('voice-status-text');
  if (liveTextNode) liveTextNode.innerText = 'or just say "Hey Bosompem"';

  if (recognition) {
    try { recognition.stop(); } catch (err) {}
  }

  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  startWakeWordDetection();
}

function updateListeningUI(isListening) {
  const statusIndicator = document.getElementById('listening-indicator');
  if (statusIndicator) {
    if (isListening) statusIndicator.classList.add('active');
    else statusIndicator.classList.remove('active');
  }
}

// --- Device Control & Command Processor ---
async function handleVoiceCommand(rawQuery) {
  const query = rawQuery.toLowerCase().trim();

  // 1. Phone Call Intent
  if (query.startsWith('call ') || query.includes('make a call')) {
    const contact = query.replace('call', '').replace('make a call to', '').trim();
    const target = contact || 'Contacts';
    speakText(`Initiating phone call to ${target}`);
    window.location.href = `tel:${encodeURIComponent(target)}`;
    return;
  }

  // 2. Messaging Intent
  if (query.startsWith('send a message') || query.startsWith('text ')) {
    const msg = query.replace('send a message to', '').replace('text', '').trim();
    speakText("Opening messaging interface");
    window.location.href = `sms:?body=${encodeURIComponent(msg)}`;
    return;
  }

  // 3. Web Search Intent
  if (query.startsWith('search the web') || query.startsWith('search for')) {
    const searchTerm = query.replace('search the web for', '').replace('search for', '').trim();
    speakText(`Searching the web for ${searchTerm}`);
    window.open(`https://www.google.com/search?q=${encodeURIComponent(searchTerm)}`, '_blank');
    return;
  }

  // 4. Set Reminder Intent
  if (query.includes('remind me') || query.startsWith('set a reminder')) {
    const reminderText = query.replace('set a reminder to', '').replace('remind me to', '').trim();
    addReminder(reminderText || 'New Voice Reminder');
    speakText(`Reminder set for: ${reminderText || 'New Voice Reminder'}`);
    return;
  }

  // 5. Open Apps Intent
  if (query.startsWith('open ')) {
    const appName = query.replace('open', '').trim();
    speakText(`Opening ${appName}`);
    openAppAction(appName);
    return;
  }

  // Default: Process via Gemini LLM Engine
  await processAssistantQuery(rawQuery);
}

// --- Gemini API Handler ---
async function processAssistantQuery(text) {
  if (!state.apiKey) {
    const notice = "Gemini API Key is required. Please set your key in Settings.";
    speakText(notice);
    alert(notice);
    return;
  }

  const PROMPT_PREFIX = "You are Bosompem, a smart personal assistant capable of hands-free device automation and natural conversation. Keep answers concise and direct for spoken output.\n\nUser: ";
  
  state.history.push({ role: 'user', parts: [{ text: `${PROMPT_PREFIX}${text}` }] });

  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${state.model}:generateContent?key=${encodeURIComponent(state.apiKey)}`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: state.history })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'API Request failed');

    const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || "I couldn't process that request.";
    state.history.push({ role: 'model', parts: [{ text: responseText }] });

    appendChatMessage('assistant', responseText);

    speakText(responseText, () => {
      if (state.liveMode) {
        // Automatically listen again for hands-free loop
        if (recognition) try { recognition.start(); } catch (e) {}
      }
    });

  } catch (err) {
    const errText = `Sorry, I ran into an error: ${err.message}`;
    speakText(errText);
    console.error(errText);
  }
}

// --- Text To Speech Output ---
function speakText(text, onComplete = null) {
  if (!('speechSynthesis' in window)) {
    if (onComplete) onComplete();
    return;
  }

  window.speechSynthesis.cancel();
  const cleanText = text.replace(/<[^>]*>/g, '');
  const utterance = new SpeechSynthesisUtterance(cleanText);

  utterance.rate = state.speed || 1.0;

  const voices = window.speechSynthesis.getVoices();
  const selectedVoice = voices.find(v => v.name === state.speaker);
  if (selectedVoice) utterance.voice = selectedVoice;

  utterance.onend = () => { if (onComplete) onComplete(); };
  utterance.onerror = () => { if (onComplete) onComplete(); };

  window.speechSynthesis.speak(utterance);
}

// --- UI Interaction Handlers for All Buttons & Cards ---

function switchTab(tabName, element) {
  state.activeTab = tabName;
  document.querySelectorAll('.nav-tab').forEach(el => el.classList.remove('active'));
  if (element) element.classList.add('active');

  if (tabName === 'chat') {
    openChatModal();
  } else if (tabName === 'apps') {
    triggerQuickAction('apps');
  } else if (tabName === 'memory') {
    showMemoryOverview();
  } else if (tabName === 'profile') {
    toggleSettings();
  }
}

function openChatModal() {
  const chatModal = document.getElementById('chat-modal');
  if (chatModal) chatModal.classList.add('active');
}

function closeChatModal() {
  const chatModal = document.getElementById('chat-modal');
  if (chatModal) chatModal.classList.remove('active');
}

function triggerQuickAction(actionType) {
  switch (actionType) {
    case 'call':
      const name = prompt('Enter recipient name or phone number:');
      if (name) {
        speakText(`Calling ${name}`);
        window.location.href = `tel:${encodeURIComponent(name)}`;
      }
      break;
    case 'message':
      const target = prompt('Enter message text:');
      if (target) {
        speakText("Opening messages");
        window.location.href = `sms:?body=${encodeURIComponent(target)}`;
      }
      break;
    case 'reminder':
      const rem = prompt('What should I remind you about?');
      if (rem) {
        addReminder(rem);
        speakText(`Reminder added: ${rem}`);
      }
      break;
    case 'tasks':
      const taskText = prompt('Enter new task detail:');
      if (taskText) {
        addTask(taskText);
        speakText(`Task added: ${taskText}`);
      }
      break;
    case 'search':
      const query = prompt('Search query:');
      if (query) {
        speakText(`Searching for ${query}`);
        window.open(`https://www.google.com/search?q=${encodeURIComponent(query)}`, '_blank');
      }
      break;
    case 'apps':
      alert('Available Apps & Commands:\n- Camera\n- Settings\n- Calendar\n- Web Browser\n- Music');
      break;
  }
}

function openAppAction(appName) {
  const app = appName.toLowerCase();
  if (app.includes('camera')) {
    window.open('about:blank', '_blank');
  } else if (app.includes('web') || app.includes('browser')) {
    window.open('https://google.com', '_blank');
  } else {
    alert(`Opening ${appName}`);
  }
}

function addReminder(text) {
  state.reminders.unshift({ id: Date.now(), text, time: new Date().toLocaleTimeString() });
  localStorage.setItem('bosompem_reminders', JSON.stringify(state.reminders));
  renderRemindersUI();
}

function addTask(text) {
  state.tasks.unshift({ id: Date.now(), text, completed: false });
  localStorage.setItem('bosompem_tasks', JSON.stringify(state.tasks));
}

function renderRemindersUI() {
  const container = document.getElementById('overview-reminders-list');
  if (!container) return;

  if (state.reminders.length === 0) {
    container.innerHTML = `
      <div class="list-item">
        <div class="item-left">
          <div class="icon-badge" style="background: rgba(34, 197, 94, 0.2); color: #22c55e;"><i class="fa-solid fa-check"></i></div>
          <div class="item-details">
            <p>No upcoming reminders</p>
            <span>You're all caught up!</span>
          </div>
        </div>
      </div>`;
    return;
  }

  container.innerHTML = state.reminders.slice(0, 3).map(r => `
    <div class="list-item">
      <div class="item-left">
        <div class="icon-badge" style="background: rgba(56, 189, 248, 0.2); color: #38bdf8;"><i class="fa-solid fa-clock"></i></div>
        <div class="item-details">
          <p>${r.text}</p>
          <span>${r.time}</span>
        </div>
      </div>
      <i class="fa-solid fa-chevron-right" style="font-size: 0.7rem; color: var(--text-muted);"></i>
    </div>
  `).join('');
}

function showMemoryOverview() {
  alert(`Bosompem Memory Status:\n\nActive History Items: ${state.history.length}\nSaved Reminders: ${state.reminders.length}\nSaved Tasks: ${state.tasks.length}`);
}

function appendChatMessage(role, text) {
  const container = document.getElementById('chat-modal-messages');
  if (!container) return;

  const wrapper = document.createElement('div');
  wrapper.className = `chat-msg ${role}`;
  wrapper.innerText = text;
  container.appendChild(wrapper);
  container.scrollTop = container.scrollHeight;
}

function handleChatSubmit() {
  const input = document.getElementById('chat-modal-input');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;

  appendChatMessage('user', text);
  input.value = '';
  processAssistantQuery(text);
}

function toggleSettings() {
  const panel = document.getElementById('settings-panel');
  if (panel) panel.classList.toggle('active');
}

function saveSettings() {
  const keyInput = document.getElementById('api-key');
  const modelSelect = document.getElementById('model-select');

  if (keyInput) state.apiKey = keyInput.value.trim();
  if (modelSelect) state.model = modelSelect.value;

  localStorage.setItem('bosompem_api_key', state.apiKey);
  localStorage.setItem('bosompem_model', state.model);

  toggleSettings();
  speakText("Settings saved successfully");
}

// --- Initial Startup Lifecycle ---
window.addEventListener('DOMContentLoaded', () => {
  initVoiceEngine();
  renderRemindersUI();

  const keyInput = document.getElementById('api-key');
  const modelSelect = document.getElementById('model-select');
  if (keyInput) keyInput.value = state.apiKey;
  if (modelSelect) modelSelect.value = state.model;
});
      
