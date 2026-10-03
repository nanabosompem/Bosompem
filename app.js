/**
 * BOSOMPEM PRO ARCHITECTURE ENGINE
 * Edge-Cloud Hybrid Multimodal Assistant Layer
 */

class SecureMemoryStore {
    constructor() {
        this.dbName = 'BosompemEncryptedVault';
        this.db = null;
        this.key = null;
    }

    async init() {
        this.key = await this.getOrCreateKey();
        return new Promise((resolve, reject) => {
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
            request.onerror = reject;
        });
    }

    async getOrCreateKey() {
        // Secure key storage initialization using WebCrypto
        return await window.crypto.subtle.generateKey(
            { name: "AES-GCM", length: 256 },
            true,
            ["encrypt", "decrypt"]
        );
    }

    async saveMemory(id, data) {
        const enc = new TextEncoder();
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const encrypted = await window.crypto.subtle.encrypt(
            { name: "AES-GCM", iv: iv },
            this.key,
            enc.encode(JSON.stringify(data))
        );

        return new Promise((resolve) => {
            const tx = this.db.transaction('memories', 'readwrite');
            const store = tx.objectStore('memories');
            store.put({ id, data: encrypted, iv });
            tx.oncomplete = resolve;
        });
    }
}

class OrchestrationPlanner {
    constructor() {
        this.sensitiveActions = ['payment', 'delete_file', 'send_external_msg', 'modify_system'];
    }

    parseIntent(input) {
        // Deconstruct query into action pipeline steps
        const steps = [];
        const isMultiStep = input.includes('and') || input.includes('then');
        
        if (isMultiStep) {
            const parts = input.split(/and|then/g);
            parts.forEach((part, index) => {
                steps.push({
                    step: index + 1,
                    action: part.trim(),
                    isSensitive: this.checkSensitivity(part)
                });
            });
        } else {
            steps.push({
                step: 1,
                action: input.trim(),
                isSensitive: this.checkSensitivity(input)
            });
        }
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
        await this.memory.init();
        console.log("Bosompem Core: Secure Local Vault & Engine Initialized.");
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

        this.ui.sendBtn.addEventListener('click', () => this.handleUserSubmit());
        this.ui.cameraBtn.addEventListener('click', () => this.toggleCameraStream());
    }

    initNetworkMonitoring() {
        window.addEventListener('online', () => this.updateNodeState(true));
        window.addEventListener('offline', () => this.updateNodeState(false));
    }

    updateNodeState(online) {
        this.isOnline = online;
        if (online) {
            this.ui.nodeIndicator.className = "telemetry-badge cloud";
            this.ui.nodeIndicator.innerHTML = `<i class="fa-solid fa-cloud"></i> HYBRID CLOUD`;
        } else {
            this.ui.nodeIndicator.className = "telemetry-badge edge";
            this.ui.nodeIndicator.innerHTML = `<i class="fa-solid fa-microchip"></i> EDGE LOCAL`;
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
                    this.appendChatBubble('assistant', `Execution aborted for step ${task.step}: ${task.action}`);
                    return;
                }
            }

            // Route execution between local edge vs cloud processing engine
            const executionNode = this.isOnline ? "CLOUD ENGINE" : "EDGE ON-DEVICE";
            this.appendChatBubble('assistant', `[${executionNode}] Executing Step ${task.step}: "${task.action}"`);
            
            // Persist encrypted action history
            await this.memory.saveMemory(Date.now().toString(), { task: task.action, timestamp: Date.now() });
        }
    }

    requestUserConfirmation(actionDescription) {
        return new Promise((resolve) => {
            this.ui.dialogMsg.innerText = `Bosompem requires confirmation to execute sensitive intent: "${actionDescription}"`;
            this.ui.dialog.classList.remove('hidden');

            const onConfirm = () => {
                cleanup();
                resolve(true);
            };

            const onCancel = () => {
                cleanup();
                resolve(false);
            };

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
                alert("Camera Multimodal Stream inaccessible: " + err.message);
            }
        }
    }

    appendChatBubble(sender, text) {
        const bubble = document.createElement('div');
        bubble.className = `chat-bubble ${sender}`;
        bubble.innerText = text;
        this.ui.chatThread.appendChild(bubble);
        this.ui.chatThread.scrollTop = this.ui.chatThread.scrollHeight;
    }
}

// Register Service Worker and Boot System Core
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => console.error("SW Registration failed", err));
}

window.addEventListener('DOMContentLoaded', () => {
    window.Bosompem = new BosompemProCore();
    window.Bosompem.init();
});
