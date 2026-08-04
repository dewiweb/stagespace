"use strict";
/**
 * Rust Core IPC Client
 * Communique avec le Rust core via Unix socket (JSON newline-delimited)
 * Protocole : IpcMessage avec champ "type"
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RustCoreClient = void 0;
exports.getRustClient = getRustClient;
const net_1 = require("net");
const SOCKET_PATH = '/tmp/holoflow.sock';
class RustCoreClient {
    socket = null;
    pendingRequests = new Map();
    async connect() {
        return new Promise((resolve, reject) => {
            this.socket = (0, net_1.createConnection)(SOCKET_PATH, () => {
                console.log('Connected to Rust core via Unix socket');
                resolve();
            });
            this.socket.on('data', (data) => {
                this.handleResponse(data.toString());
            });
            this.socket.on('error', (error) => {
                console.error('Rust core socket error:', error);
                reject(error);
            });
            this.socket.on('close', () => {
                console.log('Rust core socket closed');
                this.socket = null;
            });
        });
    }
    handleResponse(data) {
        const lines = data.trim().split('\n');
        for (const line of lines) {
            try {
                const response = JSON.parse(line);
                if (response.type === 'Response') {
                    // Find pending request by session_id or resolve all
                    if (response.success && response.data) {
                        // Resolve pending requests
                        for (const [_, pending] of this.pendingRequests) {
                            pending.resolve(response.data);
                        }
                        this.pendingRequests.clear();
                    }
                    else if (response.error) {
                        // Reject pending requests
                        for (const [_, pending] of this.pendingRequests) {
                            pending.reject(new Error(response.error));
                        }
                        this.pendingRequests.clear();
                    }
                }
            }
            catch (e) {
                console.error('Failed to parse Rust core response:', e);
            }
        }
    }
    async sendMessage(msg) {
        if (!this.socket) {
            throw new Error('Not connected to Rust core');
        }
        return new Promise((resolve, reject) => {
            this.pendingRequests.set('request', { resolve, reject });
            this.socket.write(JSON.stringify(msg) + '\n');
            // Timeout after 5 seconds
            setTimeout(() => {
                if (this.pendingRequests.has('request')) {
                    this.pendingRequests.delete('request');
                    reject(new Error('Request timeout'));
                }
            }, 5000);
        });
    }
    async play(req) {
        const sessionId = `session-${Date.now()}`;
        // Map profile to OSC address template
        const oscAddressTemplate = this.profileToTemplate(req.profile);
        await this.sendMessage({
            type: 'StartPlayback',
            session_id: sessionId,
            trajectory_type: req.engine,
            params: req.params,
            osc_host: req.host,
            osc_port: req.port,
            osc_address_template: oscAddressTemplate,
            target_fps: req.fps
        });
        return { session_id: sessionId, status: 'playing' };
    }
    async stop(sessionId) {
        // If no sessionId provided, stop all (use a dummy session)
        const id = sessionId || 'all';
        await this.sendMessage({
            type: 'StopPlayback',
            session_id: id
        });
    }
    async setMacro(sessionId, macro, value) {
        // Map macro names to params
        const paramMap = {
            speed: 'speed',
            turbulence: 'turbulence',
            scale: 'scale'
        };
        const paramName = paramMap[macro] || macro;
        await this.sendMessage({
            type: 'UpdateParams',
            session_id: sessionId,
            params: { [paramName]: value }
        });
    }
    profileToTemplate(profile) {
        const templates = {
            holophonix: '/track/{}/xyz',
            adm_osc: '/adm/obj/{}/cartpos',
            generic_cartesian: '/object/{}/xyz',
            iem: '/MultiEncoder/{}/aed'
        };
        return templates[profile] || '/track/{}/xyz';
    }
    disconnect() {
        if (this.socket) {
            this.socket.destroy();
            this.socket = null;
        }
    }
}
exports.RustCoreClient = RustCoreClient;
// Singleton instance
let rustClient = null;
async function getRustClient() {
    if (!rustClient) {
        rustClient = new RustCoreClient();
        await rustClient.connect();
    }
    return rustClient;
}
