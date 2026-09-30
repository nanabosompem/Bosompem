const PROMPT_PREFIX = "You are Bosompem, an intelligent AI assistant. Provide helpful, accurate, and direct responses.\n\nUser Question: ";

const state = {
  apiKey: localStorage.getItem('bosompem_api_key') || '',
  model: localStorage.getItem('bosompem_model') || 'gemini-3.8-flash',
  speechEnabled: localStorage.getItem('bosompem_speech') !== 'false',
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
const ttsToggle = document.getElementById('tts-toggle');
const micBtn = document.getElementById('mic-btn');
const liveBtn = document.getElementById('live-btn');

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;

if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.onstart = () => micBtn.classList.add('recording');
  recognition.onresult = (e) => {
    userInput.value = e.results[0][0].transcript;
    sendMessage();
  };
  recognition.onend = () => micBtn.classList.remove('recording');
}

window.addEventListener('DOMContentLoaded', () => {
  apiKeyInput.value = state.apiKey;
  modelSelect.value = state.model;
  updateTtsIcon();
  updateStatus();
  renderGallery();
});

function scrollToBottom() {
  setTimeout(() => { 
    chatContainer.scrollTop = chatContainer.scrollHeight; 
  }, 50);
}

function updateStatus() {
  if (state.apiKey && state.apiKey.length > 10) statusIndicator.classList.add('active');
  else statusIndicator.classList.remove('active');
}

function toggleAudio() {
  state.speechEnabled = !state.speechEnabled;
  localStorage.setItem('bosompem_speech', state.speechEnabled);
  if (!state.speechEnabled && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  updateTtsIcon();
}

function updateTtsIcon() {
  ttsToggle.innerHTML = state.speechEnabled ? '<i class="fa-solid fa-volume-high"></i>' : '<i class="fa-solid fa-volume-xmark"></i>';
}

function toggleSettings() { document.getElementById('settings-panel').classList.toggle('active'); }
function toggleGallery() { 
  renderGallery();
  document.getElementById('gallery-panel').classList.toggle('active'); 
}

function toggleLiveMode() {
  state.liveMode = !state.liveMode;
  liveBtn.classList.toggle('active', state.liveMode);
  
  if (state.liveMode) {
    state.speechEnabled = true;
    updateTtsIcon();
    appendSystemMessage("Live Voice Mode active. Speak freely.");
    if (SpeechRecognition) recognition.start();
  } else {
    appendSystemMessage("Live Voice Mode deactivated.");
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }
}

function saveSettings() {
  state.apiKey = apiKeyInput.value.trim();
  state.model = modelSelect.value;
  localStorage.setItem('bosompem_api_key', state.apiKey);
  localStorage.setItem('bosompem_model', state.model);
  updateStatus();
  toggleSettings();
  appendSystemMessage('Settings saved.');
}

function handleFileSelected(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const base64Data = e.target.result.split(',')[1];
    state.attachedImage = {
      base64: base64Data,
      mimeType: file.type || 'image/jpeg',
      previewUrl: e.target.result,
      name: file.name
    };

    document.getElementById('preview-thumb').src = e.target.result;
    document.getElementById('attachment-name').innerText = file.name;
    document.getElementById('attachment-preview').classList.add('active');
  };
  reader.readAsDataURL(file);
}

function clearAttachment() {
  state.attachedImage = null;
  document.getElementById('file-input').value = '';
  document.getElementById('attachment-preview').classList.remove('active');
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
  
  if (window.marked) {
    msg.innerHTML = marked.parse(text);
  } else {
    msg.innerText = text;
  }

  if (imageUrl) {
    const img = document.createElement('img');
    img.src = imageUrl;
    img.className = 'generated-img';
    img.alt = 'Generated Image';
    img.onload = () => scrollToBottom();
    msg.appendChild(img);
    saveToGallery(imageUrl);
  }

  const actions = document.createElement('div');
  actions.className = 'msg-actions';
  actions.innerHTML = `
    <button class="msg-action-btn" onclick="toggleLike(this, 'like')" title="Like"><i class="fa-regular fa-thumbs-up"></i></button>
    <button class="msg-action-btn" onclick="toggleLike(this, 'dislike')" title="Dislike"><i class="fa-regular fa-thumbs-down"></i></button>
    <button class="msg-action-btn" onclick="copyMessageText(this)" title="Copy"><i class="fa-regular fa-copy"></i></button>
    <button class="msg-action-btn" onclick="shareMessageText(this)" title="Share"><i class="fa-solid fa-share-nodes"></i></button>
  `;

  wrapper.appendChild(msg);
  wrapper.appendChild(actions);
  chatContainer.appendChild(wrapper);
  scrollToBottom();
}

function saveToGallery(url) {
  state.gallery.unshift({ url, timestamp: new Date().toISOString() });
  localStorage.setItem('bosompem_gallery', JSON.stringify(state.gallery));
}

function renderGallery() {
  const container = document.getElementById('gallery-container');
  if (state.gallery.length === 0) {
    container.innerHTML = `<p style="color: #9ca3af; grid-column: 1/-1;">No generated images saved yet.</p>`;
    return;
  }

  container.innerHTML = state.gallery.map(item => `
    <div class="gallery-item">
      <a href="${item.url}" target="_blank">
        <img src="${item.url}" alt="Saved Image" />
      </a>
    </div>
  `).join('');
}

function toggleLike(btn, type) {
  const parent = btn.parentElement;
  const likeBtn = parent.children[0];
  const dislikeBtn = parent.children[1];

  if (type === 'like') {
    likeBtn.classList.toggle('liked');
    dislikeBtn.classList.remove('disliked');
  } else {
    dislikeBtn.classList.toggle('disliked');
    likeBtn.classList.remove('liked');
  }
}

function copyMessageText(btn) {
  const msgText = btn.closest('.message-wrapper').querySelector('.message').innerText;
  navigator.clipboard.writeText(msgText).then(() => alert('Copied to clipboard!'));
}

function shareMessageText(btn) {
  const msgText = btn.closest('.message-wrapper').querySelector('.message').innerText;
  if (navigator.share) {
    navigator.share({ title: 'Bosompem AI Response', text: msgText }).catch(() => {});
  } else {
    copyMessageText(btn);
  }
}

function speakText(text, onComplete = null) {
  if (!state.speechEnabled || !('speechSynthesis' in window)) {
    if (onComplete) onComplete();
    return;
  }
  window.speechSynthesis.cancel();
  const cleanText = text.replace(/<[^>]*>/g, '');
  const utterance = new SpeechSynthesisUtterance(cleanText);
  utterance.onend = () => { if (onComplete) onComplete(); };
  window.speechSynthesis.speak(utterance);
}

function toggleVoiceInput() {
  if (!SpeechRecognition) return alert('Speech recognition is not supported in this browser.');
  recognition.start();
}

function handleKeyPress(e) { if (e.key === 'Enter') sendMessage(); }

function isImageRequest(text) {
  const triggerWords = ['generate image', 'create an image', 'draw', 'generate an image', 'show me a picture of', 'make a photo of'];
  return triggerWords.some(word => text.toLowerCase().includes(word));
}

async function callGemini(modelName, formattedContents) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(state.apiKey)}`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: formattedContents,
      generationConfig: { temperature: 0.7 }
    })
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
  clearAttachment();

  const sendBtn = document.getElementById('send-btn');
  sendBtn.disabled = true;

  const thinkingNode = document.createElement('div');
  thinkingNode.className = 'thinking';
  thinkingNode.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i><span>Thinking</span><span class="dots">...</span>`;
  chatContainer.appendChild(thinkingNode);
  scrollToBottom();

  if (text && isImageRequest(text)) {
    try {
      const encodedPrompt = encodeURIComponent(text);
      const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=800&height=800&nologo=true`;
      
      if (chatContainer.contains(thinkingNode)) chatContainer.removeChild(thinkingNode);
      
      const replyText = `Here is the image generated based on your prompt:`;
      appendAssistantMessage(replyText, imageUrl);
      speakText("Here is the image you requested.", () => {
        if (state.liveMode && SpeechRecognition) recognition.start();
      });
    } catch (err) {
      if (chatContainer.contains(thinkingNode)) chatContainer.removeChild(thinkingNode);
      appendSystemMessage(`Image Error: Failed to generate image.`);
    } finally {
      sendBtn.disabled = false;
    }
    return;
  }

  if (!state.apiKey) {
    if (chatContainer.contains(thinkingNode)) chatContainer.removeChild(thinkingNode);
    sendBtn.disabled = false;
    return appendSystemMessage('Please click Settings (⚙️) and enter your Gemini API Key first.');
  }

  if (state.history.length > 6) state.history = state.history.slice(-6);

  const parts = [];
  if (attached) {
    parts.push({
      inlineData: {
        mimeType: attached.mimeType,
        data: attached.base64
      }
    });
  }
  const promptText = state.history.length === 0 ? `${PROMPT_PREFIX}${text || 'Analyze this image.'}` : (text || 'Analyze this image.');
  parts.push({ text: promptText });

  state.history.push({ role: 'user', parts: parts });

  try {
    let reply = '';
    try {
      reply = await callGemini(state.model, state.history);
    } catch (err1) {
      const fallback = state.model === 'gemini-3.8-flash' ? 'gemini-3.5-flash-lite' : 'gemini-3.8-flash';
      reply = await callGemini(fallback, state.history);
    }

    if (chatContainer.contains(thinkingNode)) chatContainer.removeChild(thinkingNode);

    appendAssistantMessage(reply);
    state.history.push({ role: 'model', parts: [{ text: reply }] });

    speakText(reply, () => {
      if (state.liveMode && SpeechRecognition) recognition.start();
    });

  } catch (err) {
    if (chatContainer.contains(thinkingNode)) chatContainer.removeChild(thinkingNode);
    appendSystemMessage(`API Error: ${err.message}`);
  } finally {
    sendBtn.disabled = false;
    scrollToBottom();
  }
  }
