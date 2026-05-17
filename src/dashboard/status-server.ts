import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { NovaAgent } from '../nova-agent';
import { ROLE_PRESETS } from '../types';

export function startDashboard(agent: NovaAgent, port = 3900): void {
  const bus = agent.bus;
  const ROLE_KEYS = Object.keys(ROLE_PRESETS);
  const htmlPath = path.join(__dirname, 'dashboard.html');

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://localhost:${port}`);
    const json = (data: any, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(data));
    };

    try {
      // Status API
      if (url.pathname === '/api/status') {
        const energy = bus.getEnergyStats();
        const heart = bus.getHeartbeatState();
        const waste = bus.waste;
        const st = agent.getStatus();
        const modelName = (agent.nervous as any).currentModel || 'fast';
        const sysPrompt = (agent.nervous as any).systemPrompt || '';
        const currentRole = ROLE_KEYS.find(k => sysPrompt.includes(ROLE_PRESETS[k].prompt.substring(0, 20))) || 'default';
        const roleName = currentRole === 'default' ? '通用' : (ROLE_PRESETS[currentRole]?.name || currentRole);
        json({
          stage: st.stage, uptime: st.uptime, actions: st.actionCount,
          energy, heart, model: modelName, role: roleName,
          waste: { total: waste.total, h: waste.hallucinationWaste, e: waste.errorWaste, s: waste.staleKnowledge },
          systems: st.biometrics.map(b => ({ name: b.system.replace('System', ''), status: b.status, load: Math.round(b.load * 100) })),
          upgrades: agent.Upgrades.map((u: any) => u.name),
          availableUpgrades: agent.getAvailableUpgrades().map((u: any) => ({ id: u.id, name: u.name, description: u.description, cost: u.cost })),
          wisdom: agent.Wisdom, personality: agent.Personality,
          foraging: agent.foraging.getStats(),
          learning: agent.learning.getStats()
        });
        return;
      }

      // SSE: biometrics stream
      if (url.pathname === '/api/biometrics-stream') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*'
        });
        const sendStatus = () => {
          const energy = bus.getEnergyStats();
          const heart = bus.getHeartbeatState();
          const waste = bus.waste;
          const st = agent.getStatus();
          const sysPrompt = (agent.nervous as any).systemPrompt || '';
          const roleName = '通用';
          const modelName = (agent.nervous as any).currentModel || 'fast';
          const data = JSON.stringify({
            stage: st.stage, uptime: st.uptime, wisdom: agent.Wisdom,
            energy, heart, model: modelName, role: roleName,
            waste: { total: waste.total },
            biometrics: st.biometrics,
            learning: agent.learning.getStats()
          });
          try { res.write(`data: ${data}\n\n`); } catch {}
        };
        sendStatus();
        const timer = setInterval(sendStatus, 2000);
        req.on('close', () => clearInterval(timer));
        return;
      }

      // SSE: event bus pulse (thought chunks)
      if (url.pathname === '/api/event-bus-pulse') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*'
        });
        const onChunk = (event: any) => {
          if (event.origin === 'NervousSystem') {
            try { res.write(`event: thought:chunk\ndata: ${JSON.stringify({ chunk: event.payload?.chunk || '' })}\n\n`); } catch {}
          }
        };
        const onPerceived = () => {
          try { res.write(`event: thought:perceived\ndata: {}\n\n`); } catch {}
        };
        bus.on('thought:chunk', onChunk);
        bus.on('thought:perceived', onPerceived);
        req.on('close', () => {
          bus.removeListener('thought:chunk', onChunk);
          bus.removeListener('thought:perceived', onPerceived);
        });
        return;
      }

      // POST: chat input
      if (url.pathname === '/api/input' && req.method === 'POST') {
        let body = '';
        req.on('data', (c) => body += c);
        req.on('end', () => {
          try {
            const { text } = JSON.parse(body);
            if (text) {
              const memory = (agent as any).memory;
              if (memory) memory.addMessage('user', text);
              agent.bus.pulse('input:raw', { text }, 'Dashboard');
              json({ ok: true });
            } else { json({ ok: false }, 400); }
          } catch { json({ ok: false }, 400); }
        });
        return;
      }

      // OpenCode provider import
      if (url.pathname === '/api/opencode-key') {
        try {
          const auth = JSON.parse(fs.readFileSync(path.join(require('os').homedir(), '.hermes', 'auth.json'), 'utf-8'));
          const pool = auth?.credential_pool || {};
          const providers: any[] = [];
          const map: Record<string, { name: string; baseUrl: string }> = {
            deepseek: { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com' },
            anthropic: { name: 'Anthropic', baseUrl: 'https://api.anthropic.com' },
            openai: { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
            copilot: { name: 'GitHub Copilot', baseUrl: 'https://api.githubcopilot.com' },
            gemini: { name: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com' },
            'opencode-go': { name: 'OpenCode Go', baseUrl: 'https://opencode.ai/zen/go/v1' }
          };
          for (const [key, creds] of Object.entries(pool)) {
            const info = map[key] || { name: key, baseUrl: '' };
            const arr = creds as any[];
            for (const c of arr) {
              if (c.access_token && c.access_token.length > 10) {
                providers.push({
                  name: info.name,
                  baseUrl: c.base_url || info.baseUrl,
                  model: c.label?.replace('_API_KEY', '').toLowerCase() || 'default',
                  apiKey: c.access_token
                });
                break;
              }
            }
          }
          json({ providers });
        } catch { json({ providers: [] }); }
        return;
      }

      // Model switch
      if (url.pathname === '/api/model' && req.method === 'POST') {
        const m = url.searchParams.get('m');
        if (m && ['fast', 'reflective', 'deep'].includes(m)) {
          (agent.nervous as any).currentModel = m;
          json({ ok: true, model: m });
          return;
        }
        json({ ok: false }, 400);
        return;
      }

      // Role switch
      if (url.pathname === '/api/role' && req.method === 'POST') {
        const r = url.searchParams.get('r');
        if (r && ROLE_PRESETS[r]) {
          const role = ROLE_PRESETS[r];
          agent.nervous.setSystemPrompt(role.prompt);
          if (role.personality) {
            for (const [k, v] of Object.entries(role.personality)) {
              (agent as any).personality[k] = v;
            }
          }
          json({ ok: true, role: r });
          return;
        }
        json({ ok: false }, 400);
        return;
      }

      // Tasks
      if (url.pathname === '/api/tasks') {
        const taskFile = path.join(require('os').homedir(), '.nova', 'tasks.json');
        try { json(JSON.parse(fs.readFileSync(taskFile, 'utf-8'))); } catch { json([]); }
        return;
      }

      if (url.pathname === '/api/task/add' && req.method === 'POST') {
        const t = url.searchParams.get('t');
        if (t) {
          const taskFile = path.join(require('os').homedir(), '.nova', 'tasks.json');
          let tasks: any[] = [];
          try { tasks = JSON.parse(fs.readFileSync(taskFile, 'utf-8')); } catch {}
          tasks.push({ id: Date.now().toString(36), content: t, done: false, created: Date.now() });
          fs.writeFileSync(taskFile, JSON.stringify(tasks, null, 2));
          json({ ok: true });
          return;
        }
        json({ ok: false }, 400);
        return;
      }

      if (url.pathname === '/api/task/done' && req.method === 'POST') {
        const n = parseInt(url.searchParams.get('n') || '0');
        const taskFile = path.join(require('os').homedir(), '.nova', 'tasks.json');
        try {
          let tasks = JSON.parse(fs.readFileSync(taskFile, 'utf-8'));
          if (n > 0 && n <= tasks.length) { tasks[n-1].done = !tasks[n-1].done; fs.writeFileSync(taskFile, JSON.stringify(tasks, null, 2)); json({ ok: true }); return; }
        } catch {}
        json({ ok: false }, 400);
        return;
      }

      if (url.pathname === '/api/task/del' && req.method === 'POST') {
        const n = parseInt(url.searchParams.get('n') || '0');
        const taskFile = path.join(require('os').homedir(), '.nova', 'tasks.json');
        try {
          let tasks = JSON.parse(fs.readFileSync(taskFile, 'utf-8'));
          if (n > 0 && n <= tasks.length) { tasks.splice(n-1, 1); fs.writeFileSync(taskFile, JSON.stringify(tasks, null, 2)); json({ ok: true }); return; }
        } catch {}
        json({ ok: false }, 400);
        return;
      }

      // Apply upgrade
      if (url.pathname === '/api/upgrade' && req.method === 'POST') {
        const id = url.searchParams.get('id') || '';
        const ok = agent.applyUpgrade(id);
        json({ ok });
        return;
      }

      // Chat (simple JSON)
      if (url.pathname === '/api/chat') {
        const msg = url.searchParams.get('msg') || '';
        if (!msg) { json({ response: '' }); return; }

        const memory = (agent as any).memory;
        if (memory) memory.addMessage('user', msg);

        let responded = false;
        const timer = setTimeout(() => {
          if (!responded) { responded = true; json({ response: '[timeout]' }); }
        }, 60000);

        const handler = (event: any) => {
          if (responded) return;
          responded = true;
          clearTimeout(timer);
          const resp = event.payload?.response || '';
          if (memory && resp) memory.addMessage('assistant', resp);
          json({ response: resp });
        };

        agent.bus.once('thought:complete', handler);
        agent.bus.pulse('input:raw', { text: msg }, 'Dashboard');
        return;
      }

      // Logs
      if (url.pathname === '/api/logs') {
        const log = bus.getEventLog().slice(-200);
        json(log.map((m: any) => ({
          event: Object.keys(m.payload || {}).join(' '),
          origin: m.origin,
          timestamp: m.timestamp
        })));
        return;
      }

      // Chat history
      if (url.pathname === '/api/chat/history') {
        const memory = (agent as any).memory;
        if (memory) {
          const msgs = memory.getRecentMessages(20);
          json(msgs.map((m: any) => ({ role: m.role, content: m.content })));
          return;
        }
        json([]);
        return;
      }

      // Conversations
      if (url.pathname === '/api/convs') {
        const memory = (agent as any).memory;
        if (memory) {
          const convs = memory.getConversations().slice(0, 20);
          json(convs.map((c: any) => ({ id: c.id, name: c.name, msgs: c.messageCount, current: c.id === memory.getCurrentConversationId() })));
          return;
        }
        json([]);
        return;
      }

      if (url.pathname === '/api/conv/switch' && req.method === 'POST') {
        const id = url.searchParams.get('id') || '';
        const memory = (agent as any).memory;
        if (memory) { memory.switchConversation(id); json({ ok: true }); return; }
        json({ ok: false }, 400);
        return;
      }
    } catch (e: any) { json({ error: e.message }, 500); return; }

    // Serve dashboard HTML
    try {
      const html = fs.readFileSync(htmlPath, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch {
      res.writeHead(500);
      res.end('Dashboard HTML not found. Run: npm run build');
    }
  });

  server.listen(port, () => {
    console.log(`  Nova Dashboard: http://localhost:${port}`);
  });
}
