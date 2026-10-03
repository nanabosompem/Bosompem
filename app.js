/**
 * BOSOMPEM PRO CORE ENGINE
 * Safe Initialization & Multimodal Engine Layer
 */

class SecureMemoryStore {
    constructor() {
        this.dbName = 'BosompemEncryptedVault';
        this.db = null;
        this.key = null;
    }

    async init() {
        try {
            if (window.crypto && window.crypto.subtle) {
                this.key = await this.getOrCreateKey();
            }
        } catch (e) {
            console.warn("WebCrypto restricted, running non-encrypted memory mode:", e);
        }

        return new Promise((resolve) => {
            if (!window.indexedDB) {
                console.warn("IndexedDB not available.");
                return resolve();
            }
            const request = indexedDB.open(this.dbName, 1);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('memories')) {
                    db.createObjectStore('memories', { keyPath: 'id' });
                }
            };
            request.onsuccess = (e) => {
                this.db = e.target.result;
                resolve();
            };
            request.onerror = () => {
                console.warn("IndexedDB init failed.");
                resolve();
            };
        });
    }

    async getOrCreateKey() {
        return await window.crypto.subtle.generateKey(
            { name: "AES-GCM", length: 256 },
            true,
            ["encrypt", "decrypt"]
        );
    }

    async saveMemory(id, data) {
        if (!this.db) return;
        try {
            const tx = this.db.transaction('memories', 'readwrite');
            const store = tx.objectStore('memories');
            if (this.key) {
                const enc = new TextEncoder();
                const iv = window.crypto.getRandomValues(new Uint8Array(12));
                const encrypted = await window.crypto.subtle.encrypt(
                    { name: "AES-GCM", iv: iv },
                    this.key,
                    enc.encode(JSON.stringify(data))
                );
                store.put({ id, data: encrypted, iv });
            } else {
                store.put({ id, data: JSON.stringify(data) });
            }
        } catch (e) {
            console.error("Memory write error:", e);
        }
    }
}

class OrchestrationPlanner {
    constructor() {
        this.sensitiveActions = ['payment', 'delete', 'send_msg', 'system_setting', 'clear'];
    }

    parseIntent(input) {
        const steps = [];
        const parts = input.split(/and|then/g);
        parts.forEach((part, index) => {
            steps.push({
                step: index + 1,
                action: part.trim(),
                isSensitive: this.checkSensitivity(part)
            });
        });
        return steps;
    }

    checkSensitivity(text) {
        return this.sensitiveActions.some(action => text.toLowerCase().includes(action));
    }
}

class BosompemProCore {
    constructor() {
        this.memory = new SecureMemoryStore();
        this.planner = new OrchestrationPlanner();
        this.isOnline = navigator.onLine;
        this.mediaStream = null;

        this.initUI();
        this.initNetworkMonitoring();
    }

    async init() {
        try {
            await this.memory.init();
            console.log("Bosompem Engine operational.");
        } catch (e) {
            console.error("Initialization warning:", e);
        }
    }

    initUI() {
        this.ui = {
            userInput: document.getElementById('user-input'),
            sendBtn: document.getElementById('btn-send'),
            voiceBtn: document.getElementById('btn-voice'),
            cameraBtn: document.getElementById('btn-camera'),
            chatThread: document.getElementById('chat-thread'),
            nodeIndicator: document.getElementById('node-indicator'),
            cameraStream: document.getElementById('camera-stream'),
            viewport: document.getElementById('multimodal-viewport'),
            dialog: document.getElementById('confirmation-dialog'),
            dialogMsg: document.getElementById('dialog-message'),
            confirmBtn: document.getElementById('btn-confirm-action'),
            cancelBtn: document.getElementById('btn-cancel-action')
        };

        if (this.ui.sendBtn) {
            this.ui.sendBtn.addEventListener('click', () => this.handleUserSubmit());
        }
        if (this.ui.userInput) {
            this.ui.userInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.handleUserSubmit();
                }
            });
        }
        if (this.ui.cameraBtn) {
            this.ui.cameraBtn.addEventListener('click', () => this.toggleCameraStream());
        }
    }

    initNetworkMonitoring() {
        window.addEventListener('online', () => this.updateNodeState(true));
        window.addEventListener('offline', () => this.updateNodeState(false));
    }

    updateNodeState(online) {
        this.isOnline = online;
        if (!this.ui.nodeIndicator) return;
        if (online) {
            this.ui.nodeIndicator.className = "telemetry-badge cloud";
            this.ui.nodeIndicator.innerHTML = `☁️ HYBRID CLOUD`;
        } else {
            this.ui.nodeIndicator.className = "telemetry-badge edge";
            this.ui.nodeIndicator.innerHTML = `⚡ EDGE LOCAL`;
        }
    }

    async handleUserSubmit() {
        const query = this.ui.userInput.value.trim();
        if (!query) return;

        this.appendChatBubble('user', query);
        this.ui.userInput.value = '';

        const plan = this.planner.parseIntent(query);
        await this.executeTaskPlan(plan);
    }

    async executeTaskPlan(plan) {
        for (const task of plan) {
            if (task.isSensitive) {
                const confirmed = await this.requestUserConfirmation(task.action);
                if (!confirmed) {
                    this.appendChatBubble('assistant', `Step ${task.step} cancelled.`);
                    return;
                }
            }

            const executionNode = this.isOnline ? "CLOUD" : "EDGE LOCAL";
            this.appendChatBubble('assistant', `[${executionNode}] Processing: "${task.action}"`);
            await this.memory.saveMemory(Date.now().toString(), { task: task.action, timestamp: Date.now() });
        }
    }

    requestUserConfirmation(actionDescription) {
        return new Promise((resolve) => {
            if (!this.ui.dialog) return resolve(true);
            this.ui.dialogMsg.innerText = `Confirm execution: "${actionDescription}"`;
            this.ui.dialog.classList.remove('hidden');

            const onConfirm = () => { cleanup(); resolve(true); };
            const onCancel = () => { cleanup(); resolve(false); };

            const cleanup = () => {
                this.ui.confirmBtn.removeEventListener('click', onConfirm);
                this.ui.cancelBtn.removeEventListener('click', onCancel);
                this.ui.dialog.classList.add('hidden');
            };

            this.ui.confirmBtn.addEventListener('click', onConfirm);
            this.ui.cancelBtn.addEventListener('click', onCancel);
        });
    }

    async toggleCameraStream() {
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
            this.ui.viewport.classList.add('hidden');
        } else {
            try {
                this.mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
                this.ui.cameraStream.srcObject = this.mediaStream;
                this.ui.viewport.classList.remove('hidden');
            } catch (err) {
                alert("Camera access unavailable: " + err.message);
            }
        }
    }

    appendChatBubble(sender, text) {
        if (!this.ui.chatThread) return;
        const bubble = document.createElement('div');
        bubble.className = `chat-bubble ${sender}`;
        bubble.innerText = text;
        this.ui.chatThread.appendChild(bubble);
        this.ui.chatThread.scrollTop = this.ui.chatThread.scrollHeight;
    }
}

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => console.error("SW issue:", err));
}

window.addEventListener('DOMContentLoaded', () => {
    window.Bosompem = new BosompemProCore();
    window.Bosompem.init();
});
