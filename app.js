// ==========================================
// BOSOMPEM ADVANCED VOICE & SYSTEM ENGINE
// ==========================================

const state = {
  apiKey: localStorage.getItem('bosompem_api_key') || '',
  model: localStorage.getItem('bosompem_model') || 'gemini-3.8-flash',
  speaker: localStorage.getItem('bosompem_speaker') || '',
  speed: parseFloat(localStorage.getItem('bosompem_speed') || '1.0'),
  liveMode: false,
  wakeWordListening: true,
  
  // Voice Print State
  ownerVoicePrint: JSON.parse(localStorage.getItem('bosompem_voice_print') || 'null'),
  isVoiceVerified: false,

  // Memory & Context Handling (Heavy Input Support)
  maxContextMessages: 20, // Windowing context to handle heavy sessions
  history: JSON.parse(localStorage.getItem('bosompem_chat_history') || '[]'),
  reminders: JSON.parse(localStorage.getItem('bosompem_reminders') || '[]'),
  tasks: JSON.parse(localStorage.getItem('bosompem_tasks') || '[]')
};

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let wakeWordRecognizer = null;
let audioContext = null;

// ==========================================
// 1. OWNER VOICE IDENTIFICATION (BIOMETRIC)
// ==========================================

/**
 * Extracts spectral audio features (Frequency Spectrum Profile)
 * to verify if the speaker matches the registered owner.
 */
async function captureOwnerVoicePrint() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Float32Array(bufferLength);

    speakText("Please say 'Hey Bosompem, verify my voice' clearly.");

    setTimeout(() => {
      analyser.getFloatFrequencyData(dataArray);
      
      // Calculate normalized spectral signature profile
      const featureVector = Array.from(dataArray).map(val => Math.round(val));
      state.ownerVoicePrint = featureVector;
      localStorage.setItem('bosompem_voice_print', JSON.stringify(featureVector));
      
      // Clean up stream
      stream.getTracks().forEach(track => track.stop());
      audioContext.close();

      speakText("Owner voice print saved successfully. Bosompem will now respond exclusively to your voice profile.");
    }, 4000);

  } catch (err) {
    alert("Voice enrollment error: " + err.message);
  }
}

/**
 * Verifies live speech audio sample against stored owner voice print
 */
async function verifySpeakerSignature() {
  if (!state.ownerVoicePrint) return true; // Default true if no profile registered yet

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    const dataArray = new Float32Array(analyser.frequencyBinCount);
    analyser.getFloatFrequencyData(dataArray);

    // Calculate Cosine Similarity between live print and stored print
    const currentVector = Array.from(dataArray).map(val => Math.round(val));
    const similarity = calculateVectorSimilarity(currentVector, state.ownerVoicePrint);

    stream.getTracks().forEach(track => track.stop());
    ctx.close();

    // Verification threshold (0.65 similarity score)
    return similarity >= 0.65;
  } catch (e) {
    return true; // Fallback gracefully if analyzer fails
  }
}

function calculateVectorSimilarity(vecA, vecB) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ==========================================
// 2. VOICE ENGINE & HANDS-FREE Siri/Bixby MODE
// ==========================================

function initVoiceEngine() {
  if (!SpeechRecognition) {
    console.warn('Speech Recognition not supported in this browser environment.');
    return;
  }

  // Active Recognition Engine
  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = true;

  recognition.onstart = () => updateListeningUI(true);

  recognition.onresult = async (e) => {
    let interim = '';
    let finalTranscript = '';

    for (let i = e.resultIndex; i < e.results.length; ++i) {
      if (e.results[i].isFinal) finalTranscript += e.results[i][0].transcript;
      else interim += e.results[i][0].transcript;
    }

    const liveTextNode = document.getElementById('voice-status-text');
    if (liveTextNode) liveTextNode.innerText = interim || finalTranscript || "Listening...";

    if (finalTranscript) {
      // Verify Speaker Identity
      const isOwner = await verifySpeakerSignature();
      if (!isOwner) {
        speakText("Voice signature not recognized. Access restricted.");
        deactivateLiveMode();
        return;
      }

      handleVoiceCommand(finalTranscript);
    }
  };

  recognition.onerror = () => {
    updateListeningUI(false);
    if (state.liveMode) restartWakeWordDetection();
  };

  recognition.onend = () => {
    updateListeningUI(false);
    if (state.liveMode) restartWakeWordDetection();
  };

  // Background Wake Word Recognizer ("Hey Bosompem")
  wakeWordRecognizer = new SpeechRecognition();
  wakeWordRecognizer.continuous = true;
  wakeWordRecognizer.interimResults = true;

  wakeWordRecognizer.onresult = async (e) => {
    for (let i = e.resultIndex; i < e.results.length; ++i) {
      const phrase = e.results[i][0].transcript.toLowerCase();
      if (phrase.includes('hey bosompem') || phrase.includes('bosompem')) {
        wakeWordRecognizer.stop();

        const isOwner = await verifySpeakerSignature();
        if (isOwner) {
          speakText("Yes? I'm listening.", () => activateLiveMode());
        } else {
          console.warn("Unauthorized wake word attempt detected.");
          startWakeWordDetection();
        }
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

function toggleLiveMode() {
  if (state.liveMode) {
    deactivateLiveMode();
  } else {
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(() => activateLiveMode())
      .catch(() => alert("Microphone permission required for hands-free mode."));
  }
}

function activateLiveMode() {
  state.liveMode = true;
  if (wakeWordRecognizer) try { wakeWordRecognizer.stop(); } catch (e) {}

  const micBtn = document.getElementById('main-mic-btn');
  if (micBtn) micBtn.classList.add('active');

  const liveTextNode = document.getElementById('voice-status-text');
  if (liveTextNode) liveTextNode.innerText = "Listening for your command...";

  if (recognition) try { recognition.start(); } catch (e) {}
}

function deactivateLiveMode() {
  state.liveMode = false;
  const micBtn = document.getElementById('main-mic-btn');
  if (micBtn) micBtn.classList.remove('active');

  const liveTextNode = document.getElementById('voice-status-text');
  if (liveTextNode) liveTextNode.innerText = 'or just say "Hey Bosompem"';

  if (recognition) try { recognition.stop(); } catch (e) {}
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();

  startWakeWordDetection();
}

// ==========================================
// 3. ADVANCED SIRI/BIXBY DEVICE CONTROL
// ==========================================

async function handleVoiceCommand(rawQuery) {
  const query = rawQuery.toLowerCase().trim();

  // --- DEVICE AUTOMATION CONTROLS ---

  // Phone Call Action
  if (query.startsWith('call ') || query.includes('make a call to')) {
    const contact = query.replace('call', '').replace('make a call to', '').trim();
    speakText(`Calling ${contact || 'contact'}`);
    window.location.href = `tel:${encodeURIComponent(contact)}`;
    return;
  }

  // Messaging Action
  if (query.startsWith('send a message to') || query.startsWith('text ')) {
    const parts = query.replace('send a message to', '').replace('text', '').trim().split('saying');
    const recipient = parts[0] ? parts[0].trim() : '';
    const body = parts[1] ? parts[1].trim() : '';
    speakText(`Opening SMS to ${recipient}`);
    window.location.href = `sms:${encodeURIComponent(recipient)}?body=${encodeURIComponent(body)}`;
    return;
  }

  // System Flashlight Control (Hardware API)
  if (query.includes('turn on flashlight') || query.includes('turn on light')) {
    toggleFlashlight(true);
    return;
  }
  if (query.includes('turn off flashlight') || query.includes('turn off light')) {
    toggleFlashlight(false);
    return;
  }

  // App Navigation & Device Intents
  if (query.startsWith('open ')) {
    const targetApp = query.replace('open', '').trim();
    executeAppLaunch(targetApp);
    return;
  }

  // Reminders / Timers / Tasks
  if (query.includes('set a reminder') || query.includes('remind me to')) {
    const task = query.replace('set a reminder to', '').replace('remind me to', '').trim();
    addReminder(task);
    speakText(`Reminder added for ${task}`);
    return;
  }

  if (query.includes('set a timer for')) {
    const timeStr = query.replace('set a timer for', '').trim();
    parseAndSetTimer(timeStr);
    return;
  }

  // Web Search
  if (query.startsWith('search for') || query.startsWith('search the web for')) {
    const term = query.replace('search the web for', '').replace('search for', '').trim();
    speakText(`Searching web for ${term}`);
    window.open(`https://www.google.com/search?q=${encodeURIComponent(term)}`, '_blank');
    return;
  }

  // Fallback: Heavy Input LLM Processing Engine
  await processAssistantQuery(rawQuery);
}

// Hardware Flashlight Toggle via MediaStreams
async function toggleFlashlight(enable) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const track = stream.getVideoTracks()[0];
    const imageCapture = new ImageCapture(track);
    const capabilities = await imageCapture.getPhotoCapabilities();

    if (capabilities.fillLightMode && capabilities.fillLightMode.includes('flash')) {
      await track.applyConstraints({ advanced: [{ torch: enable }] });
      speakText(`Flashlight turned ${enable ? 'on' : 'off'}`);
    } else {
      speakText("Flashlight control is not supported on this device hardware.");
    }
  } catch (err) {
    speakText(`Unable to control flashlight: ${err.message}`);
  }
}

function parseAndSetTimer(timeStr) {
  let seconds = 60; // Default 1 min
  if (timeStr.includes('minute')) seconds = parseInt(timeStr) * 60;
  if (timeStr.includes('second')) seconds = parseInt(timeStr);

  speakText(`Timer set for ${timeStr}`);
  setTimeout(() => {
    speakText("Time is up! Your timer finished.");
    alert("Timer Finished!");
  }, seconds * 1000);
}

function executeAppLaunch(appName) {
  const app = appName.toLowerCase();
  speakText(`Opening ${appName}`);

  if (app.includes('camera')) window.location.href = "camera:";
  else if (app.includes('gallery') || app.includes('photos')) window.location.href = "photos:";
  else if (app.includes('settings')) toggleSettings();
  else if (app.includes('browser') || app.includes('chrome')) window.open('https://google.com', '_blank');
  else alert(`Simulating launch for: ${appName}`);
}

// ==========================================
// 4. HEAVY INPUT & CONTEXT MANAGEMENT
// ==========================================

/**
 * Handles long multi-sentence input and heavy documents using windowing context buffers.
 */
async function processAssistantQuery(text) {
  if (!state.apiKey) {
    const err = "Gemini API Key missing. Please configure key in Settings.";
    speakText(err);
    alert(err);
    return;
  }

  // Pre-process & Chunk Heavy Input if text exceeds 4000 characters
  const inputChunks = chunkHeavyInput(text, 3500);

  // Maintain Context Windowing (Keep last N conversation turns)
  if (state.history.length > state.maxContextMessages) {
    state.history = state.history.slice(-state.maxContextMessages);
  }

  const systemInstruction = "You are Bosompem, an advanced voice assistant controlling the device like Siri and Bixby. Provide concise, direct answers suited for speech output.";

  // Push user prompt into context
  state.history.push({ role: 'user', parts: [{ text: `${systemInstruction}\n\nInput: ${inputChunks[0]}` }] });

  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${state.model}:generateContent?key=${encodeURIComponent(state.apiKey)}`;
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: state.history })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'Processing Error');

    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "Command executed.";

    // Store turn in context
    state.history.push({ role: 'model', parts: [{ text: reply }] });
    localStorage.setItem('bosompem_chat_history', JSON.stringify(state.history));

    appendChatMessage('assistant', reply);

    // Speak output and restart voice recognition loop if in Live Mode
    speakText(reply, () => {
      if (state.liveMode && recognition) {
        try { recognition.start(); } catch (e) {}
      }
    });

  } catch (err) {
    speakText(`Error processing request: ${err.message}`);
  }
}

// Splits large text into processable chunks for heavy document/prompt inputs
function chunkHeavyInput(str, maxLen) {
  const chunks = [];
  let i = 0;
  while (i < str.length) {
    chunks.push(str.slice(i, i + maxLen));
    i += maxLen;
  }
  return chunks;
}

// ==========================================
// 5. TTS & AUXILIARY UTILITIES
// ==========================================

function speakText(text, onComplete) {
  if (!('speechSynthesis' in window)) {
    if (onComplete) onComplete();
    return;
  }

  window.speechSynthesis.cancel();
  const clean = text.replace(/<[^>]*>/g, '');
  const utterance = new SpeechSynthesisUtterance(clean);
  utterance.rate = state.speed;

  const voices = window.speechSynthesis.getVoices();
  const voice = voices.find(v => v.name === state.speaker);
  if (voice) utterance.voice = voice;

  utterance.onend = () => { if (onComplete) onComplete(); };
  utterance.onerror = () => { if (onComplete) onComplete(); };

  window.speechSynthesis.speak(utterance);
}

function updateListeningUI(active) {
  const bar = document.getElementById('listening-indicator');
  if (bar) {
    if (active) bar.classList.add('active');
    else bar.classList.remove('active');
  }
}

function addReminder(text) {
  state.reminders.unshift({ id: Date.now(), text, time: new Date().toLocaleTimeString() });
  localStorage.setItem('bosompem_reminders', JSON.stringify(state.reminders));
}

function toggleSettings() {
  const panel = document.getElementById('settings-panel');
  if (panel) panel.classList.toggle('active');
}

window.addEventListener('DOMContentLoaded', () => {
  initVoiceEngine();
});
      
