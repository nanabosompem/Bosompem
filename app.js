const PROMPT_PREFIX = "You are Bosompem, an advanced AI assistant capable of photo editing, high-definition text generation, and clear conversation.\n\nUser Request: ";

const state = {
  apiKey: localStorage.getItem('bosompem_api_key') || '',
  model: localStorage.getItem('bosompem_model') || 'gemini-2.5-flash',
  speechEnabled: localStorage.getItem('bosompem_speech') !== 'false',
  speaker: localStorage.getItem('bosompem_speaker') || '',
  speed: parseFloat(localStorage.getItem('bosompem_speed') || '1.0'),
  liveMode: false,
  history: [],
  gallery: JSON.parse(localStorage.getItem('bosompem_gallery') || '[]'),
  attachedImage: null
};

const chatContainer = document.getElementById('chat-container');
const userInput = document.getElementById('user-input');
const statusIndicator = document.getElementById('status-indicator');
const apiKeyInput = document.getElementById('api-key');
const modelSelect = document.getElementById('model-select');
const speakerSelect = document.getElementById('speaker-select');
const speedSelect = document.getElementById('speed-select');
const micBtn = document.getElementById('mic-btn');
const liveBtn = document.getElementById('live-btn');
const listeningIndicator = document.getElementById('listening-indicator');

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;

if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = true;
  
  recognition.onstart = () => {
    listeningIndicator.classList.add('active');
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

    if (interim) userInput.value = interim;
    if (finalTranscript) {
      userInput.value = finalTranscript;
      sendMessage();
    }
  };

  recognition.onerror = () => {
    listeningIndicator.classList.remove('active');
  };
  
  recognition.onend = () => {
    listeningIndicator.classList.remove('active');
  };
}

function loadVoices() {
  if (!('speechSynthesis' in window)) return;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return;

  speakerSelect.innerHTML = '';
  
  voices.forEach((v) => {
    const opt = document.createElement('option');
    opt.value = v.name;
    opt.innerText = `${v.name} (${v.lang})`;
    if (v.name === state.speaker || (!state.speaker && v.default)) {
      opt.selected = true;
      state.speaker = v.name;
    }
    speakerSelect.appendChild(opt);
  });
}

if ('speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = loadVoices;
}

window.addEventListener('DOMContentLoaded', () => {
  apiKeyInput.value = state.apiKey;
  modelSelect.value = state.model;
  speedSelect.value = state.speed;
  document.getElementById('speed-val').innerText = state.speed;
  
  loadVoices();
  setTimeout(loadVoices, 500);
  
  updateStatus();
  renderGallery();
});

/* Collapsible Developer Panel Toggle */
function toggleDevPanel() {
  const panel = document.getElementById('dev-panel');
  const chevron = document.getElementById('dev-chevron');

  if (panel.classList.contains('active')) {
    panel.classList.remove('active');
    chevron.className = 'fa-solid fa-chevron-down';
  } else {
    panel.classList.add('active');
    chevron.className = 'fa-solid fa-chevron-up';
  }
}

/* Dynamic Text Expansion */
function autoExpandInput(element) {
  element.style.height = 'auto';
  element.style.height = Math.min(element.scrollHeight, 200) + 'px';
}

function handleKeyDown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

function scrollToBottom() {
  setTimeout(() => { chatContainer.scrollTop = chatContainer.scrollHeight; }, 50);
}

function updateStatus() {
  if (state.apiKey && state.apiKey.length > 10) statusIndicator.classList.add('active');
  else statusIndicator.classList.remove('active');
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('active');
  document.getElementById('sidebar-overlay').classList.toggle('active');
}

function startNewChat() {
  state.history = [];
  chatContainer.innerHTML = `
    <div class="message-wrapper assistant">
      <div class="message assistant">New conversation started. How can I help you today?</div>
    </div>`;
  toggleSidebar();
  appendSystemMessage("Chat reset successfully.");
}

function toggleSettings() { 
  loadVoices();
  document.getElementById('settings-panel').classList.toggle('active'); 
}

function toggleGallery() { 
  renderGallery(); 
  document.getElementById('gallery-panel').classList.toggle('active'); 
}

function toggleLiveMode() {
  state.liveMode = !state.liveMode;
  liveBtn.classList.toggle('active', state.liveMode);
  
  if (state.liveMode) {
    state.speechEnabled = true;
    appendSystemMessage("Live Voice Mode active.");
    if (SpeechRecognition) recognition.start();
  } else {
    appendSystemMessage("Live Voice Mode deactivated.");
    listeningIndicator.classList.remove('active');
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }
}

function saveSettings() {
  state.apiKey = apiKeyInput.value.trim();
  state.model = modelSelect.value;
  state.speaker = speakerSelect.value;
  state.speed = parseFloat(speedSelect.value);

  localStorage.setItem('bosompem_api_key', state.apiKey);
  localStorage.setItem('bosompem_model', state.model);
  localStorage.setItem('bosompem_speaker', state.speaker);
  localStorage.setItem('bosompem_speed', state.speed);

  updateStatus();
  toggleSettings();
  appendSystemMessage('Preferences saved.');
}

function handleFileSelected(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    state.attachedImage = {
      base64: e.target.result.split(',')[1],
      mimeType: file.type || 'image/jpeg',
      previewUrl: e.target.result,
      name: file.name
    };

    document.getElementById('preview-thumb').src = e.target.result;
    document.getElementById('attachment-name').innerText = file.name;
    document.getElementById('attachment-preview').style.display = 'flex';
  };
  reader.readAsDataURL(file);
}

function clearAttachment() {
  state.attachedImage = null;
  document.getElementById('file-input').value = '';
  document.getElementById('attachment-preview').style.display = 'none';
}

function appendSystemMessage(text) {
  const msgNode = document.createElement('div');
  msgNode.className = 'message system';
  msgNode.innerText = text;
  chatContainer.appendChild(msgNode);
  scrollToBottom();
}

function appendUserMessage(text, attachedImg = null) {
  const wrapper = document.createElement('div');
  wrapper.className = 'message-wrapper user';

  const msg = document.createElement('div');
  msg.className = 'message user';

  if (attachedImg) {
    const img = document.createElement('img');
    img.src = attachedImg.previewUrl;
    img.className = 'attached-preview-img';
    msg.appendChild(img);
  }

  if (text) {
    const textSpan = document.createElement('span');
    textSpan.innerText = text;
    msg.appendChild(textSpan);
  }

  wrapper.appendChild(msg);
  chatContainer.appendChild(wrapper);
  scrollToBottom();
}

function appendAssistantMessage(text, imageUrl = null) {
  const wrapper = document.createElement('div');
  wrapper.className = 'message-wrapper assistant';

  const msg = document.createElement('div');
  msg.className = 'message assistant';
  
  if (window.marked) msg.innerHTML = marked.parse(text);
  else msg.innerText = text;

  if (imageUrl) {
    const img = document.createElement('img');
    img.src = imageUrl;
    img.className = 'generated-img';
    img.onload = () => scrollToBottom();
    msg.appendChild(img);
    saveToGallery(imageUrl);
  }

  wrapper.appendChild(msg);

  // Response Liquid Glass Action Bar
  const actionBar = document.createElement('div');
  actionBar.className = 'response-action-bar';

  const rawText = text.replace(/<[^>]*>/g, '');

  actionBar.innerHTML = `
    <button class="liquid-glass-btn action-icon-btn" onclick="speakSpecificText('${encodeURIComponent(rawText)}', this)" title="Listen to text">
      <i class="fa-solid fa-volume-high"></i>
    </button>
    <button class="liquid-glass-btn action-icon-btn" onclick="copyResponseText('${encodeURIComponent(rawText)}', this)" title="Copy text">
      <i class="fa-regular fa-copy"></i>
    </button>
    <button class="liquid-glass-btn action-icon-btn" onclick="toggleFeedback(this, 'like')" title="Good response">
      <i class="fa-regular fa-thumbs-up"></i>
    </button>
    <button class="liquid-glass-btn action-icon-btn" onclick="toggleFeedback(this, 'dislike')" title="Bad response">
      <i class="fa-regular fa-thumbs-down"></i>
    </button>
  `;

  wrapper.appendChild(actionBar);
  chatContainer.appendChild(wrapper);
  scrollToBottom();
}

function speakSpecificText(encodedText, btnNode) {
  const text = decodeURIComponent(encodedText);
  if (!('speechSynthesis' in window)) return;

  if (window.speechSynthesis.speaking) {
    window.speechSynthesis.cancel();
    btnNode.classList.remove('active');
    return;
  }

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = state.speed || 1.0;
  
  const voices = window.speechSynthesis.getVoices();
  const selectedVoice = voices.find(v => v.name === state.speaker);
  if (selectedVoice) utterance.voice = selectedVoice;

  btnNode.classList.add('active');

  utterance.onend = () => { btnNode.classList.remove('active'); };
  utterance.onerror = () => { btnNode.classList.remove('active'); };

  window.speechSynthesis.speak(utterance);
}

/* Functional Clipboard Copy Handler */
async function copyResponseText(encodedText, btnNode) {
  const text = decodeURIComponent(encodedText);
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
    }
    
    const originalIcon = btnNode.innerHTML;
    btnNode.innerHTML = `<i class="fa-solid fa-check" style="color: #10b981;"></i>`;
    setTimeout(() => { btnNode.innerHTML = originalIcon; }, 2000);
  } catch (err) {
    console.error('Failed to copy: ', err);
  }
}

function toggleFeedback(btnNode, type) {
  const parent = btnNode.parentElement;
  const buttons = parent.querySelectorAll('.action-icon-btn');
  
  buttons.forEach(btn => {
    if (btn === btnNode) {
      btn.classList.toggle('active');
    } else if (btn.title.includes('Good') || btn.title.includes('Bad')) {
      btn.classList.remove('active');
    }
  });
}

function saveToGallery(url) {
  state.gallery.unshift({ url, timestamp: new Date().toISOString() });
  localStorage.setItem('bosompem_gallery', JSON.stringify(state.gallery));
}

function renderGallery() {
  const container = document.getElementById('gallery-container');
  if (state.gallery.length === 0) {
    container.innerHTML = `<p style="color: #9ca3af; grid-column: 1/-1;">No saved images yet.</p>`;
    return;
  }
  container.innerHTML = state.gallery.map(item => `
    <div class="gallery-item">
      <a href="${item.url}" target="_blank"><img src="${item.url}" alt="Image" /></a>
    </div>
  `).join('');
}

function speakText(text, onComplete = null) {
  if (!state.speechEnabled || !('speechSynthesis' in window)) {
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
  window.speechSynthesis.speak(utterance);
}

function toggleVoiceInput() {
  if (!SpeechRecognition) return alert('Speech recognition is not supported on this browser.');
  recognition.start();
}

function isImageGenerationRequest(text) {
  const triggers = ['generate image', 'create an image', 'draw', 'make a picture', 'show me a photo of', 'picture of'];
  return triggers.some(t => text.toLowerCase().includes(t));
}

function isPhotoEditRequest(text, attached) {
  const triggers = ['edit', 'change background', 'sharpen', 'add light', 'filter', 'modify', 'braid', 'enhance'];
  return attached || triggers.some(t => text.toLowerCase().includes(t));
}

async function callGemini(modelName, formattedContents) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(state.apiKey)}`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: formattedContents })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);
  return data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response received.';
}

async function sendMessage() {
  const text = userInput.value.trim();
  const attached = state.attachedImage;

  if (!text && !attached) return;

  appendUserMessage(text, attached);
  userInput.value = '';
  userInput.style.height = '44px';
  clearAttachment();

  const sendBtn = document.getElementById('send-btn');
  sendBtn.disabled = true;

  if (isImageGenerationRequest(text) || (attached && isPhotoEditRequest(text, attached))) {
    try {
      const cleanPrompt = text ? text.replace(/(generate|create|draw|make|show me a photo of)/gi, '').trim() : 'professional studio photograph, crisp detail, cinematic studio lighting, high resolution';
      const enhancedPrompt = attached 
        ? `HD professional photograph edit, clear face, detailed lighting, sharp focus, ${cleanPrompt}`
        : `ultra-clean realistic photograph, high resolution 8k, detailed composition, studio quality: ${cleanPrompt}`;

      const seed = Math.floor(Math.random() * 1000000);
      const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(enhancedPrompt)}?width=1024&height=1024&seed=${seed}&nologo=true&enhance=true`;
      
      const reply = attached ? "Here is your edited photo:" : "Here is your clean generated photo:";
      
      appendAssistantMessage(reply, imageUrl);
      speakText(reply, () => {
        if (state.liveMode && SpeechRecognition) recognition.start();
      });
    } catch (err) {
      appendSystemMessage("Image processing error.");
    } finally {
      sendBtn.disabled = false;
    }
    return;
  }

  if (!state.apiKey) {
    sendBtn.disabled = false;
    return appendSystemMessage('Please configure your Gemini API Key under Settings > Developer & API Settings.');
  }

  const parts = [];
  if (attached) {
    parts.push({ inlineData: { mimeType: attached.mimeType, data: attached.base64 } });
  }
  parts.push({ text: `${PROMPT_PREFIX}${text}` });

  state.history.push({ role: 'user', parts: parts });

  try {
    let reply = await callGemini(state.model, state.history);
    appendAssistantMessage(reply);
    state.history.push({ role: 'model', parts: [{ text: reply }] });

    speakText(reply, () => {
      if (state.liveMode && SpeechRecognition) recognition.start();
    });
  } catch (err) {
    appendSystemMessage(`API Error: ${err.message}`);
  } finally {
    sendBtn.disabled = false;
    scrollToBottom();
  }
}
  
