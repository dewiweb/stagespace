"use strict";
/**
 * HOLOFLOW Backend - TypeScript
 * API REST minimaliste pour LiveSimple
 * Utilise le Rust core via IPC Unix socket
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const rust_client_1 = require("./rust-client");
const app = (0, express_1.default)();
const PORT = 8100;
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// Active sessions
const sessions = new Map();
// ── Health check ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
    res.json({
        name: 'HOLOFLOW Backend',
        version: '1.0.0',
        status: 'running',
        rust_core: 'connected'
    });
});
// ── Play endpoint ────────────────────────────────────────────────────────────
app.post('/api/play', async (req, res) => {
    try {
        console.log('Play request:', req.body);
        const { engine, profile, host, port, fps, params } = req.body;
        if (!engine || !profile || !host || !port || !fps) {
            console.error('Missing required fields');
            return res.status(400).json({ error: 'Missing required fields' });
        }
        console.log('Connecting to Rust core...');
        const rustClient = await (0, rust_client_1.getRustClient)();
        console.log('Sending play request to Rust core...');
        const result = await rustClient.play({
            engine,
            profile,
            host,
            port,
            fps,
            params: params || {}
        });
        const sessionId = result.session_id;
        console.log('Session created:', sessionId);
        sessions.set(sessionId, {
            engine,
            profile,
            host,
            port,
            startedAt: new Date()
        });
        res.json({
            session_id: sessionId,
            status: 'playing'
        });
    }
    catch (error) {
        console.error('Play error:', error);
        res.status(500).json({ error: error.message });
    }
});
// ── Stop endpoint ────────────────────────────────────────────────────────────
app.post('/api/stop', async (req, res) => {
    try {
        const rustClient = await (0, rust_client_1.getRustClient)();
        await rustClient.stop();
        sessions.clear();
        res.json({ status: 'stopped' });
    }
    catch (error) {
        console.error('Stop error:', error);
        res.status(500).json({ error: error.message });
    }
});
// ── Macros endpoint ─────────────────────────────────────────────────────────
app.post('/api/macros/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { speed, turbulence, scale } = req.body;
        if (!sessions.has(sessionId)) {
            return res.status(404).json({ error: 'Session not found' });
        }
        const rustClient = await (0, rust_client_1.getRustClient)();
        if (speed !== undefined) {
            await rustClient.setMacro(sessionId, 'speed', speed);
        }
        if (turbulence !== undefined) {
            await rustClient.setMacro(sessionId, 'turbulence', turbulence);
        }
        if (scale !== undefined) {
            await rustClient.setMacro(sessionId, 'scale', scale);
        }
        res.json({ status: 'ok' });
    }
    catch (error) {
        console.error('Macro error:', error);
        res.status(500).json({ error: error.message });
    }
});
// ── Sessions endpoint ────────────────────────────────────────────────────────
app.get('/api/sessions', (req, res) => {
    const sessionList = Array.from(sessions.entries()).map(([id, data]) => ({
        id,
        ...data
    }));
    res.json(sessionList);
});
// ── Engines endpoint ────────────────────────────────────────────────────────
app.get('/api/engines', (req, res) => {
    const engines = [
        'circular', 'spiral', 'lissajous', 'figure8', 'linear',
        'elliptical', 'oscillation', 'perlin_noise', 'formation',
        'converge', 'pendulum', 'rose_curve', 'helix',
        'bouncing', 'avoidance', 'spring', 'follow', 'swarm'
    ];
    res.json(engines);
});
// ── Profiles endpoint ────────────────────────────────────────────────────────
app.get('/api/profiles', (req, res) => {
    const profiles = [
        { id: 'holophonix', label: 'Holophonix' },
        { id: 'adm_osc', label: 'ADM-OSC' },
        { id: 'generic_cartesian', label: 'Générique' },
        { id: 'iem', label: 'IEM' }
    ];
    res.json(profiles);
});
// ── Start server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`HOLOFLOW Backend listening on http://localhost:${PORT}`);
});
// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down...');
    process.exit(0);
});
