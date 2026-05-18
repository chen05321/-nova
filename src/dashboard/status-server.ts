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
      // GET: 读取本地配置文件提供给前端回显
      if (url.pathname === '/api/control/config' && req.method === 'GET') {
        try {
          const configPath = path.join(process.cwd(), 'nova.config.json');
          let currentConfig = { provider: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash', hasKey: false };
          
          if (fs.existsSync(configPath)) {
            try {
              const fileData = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
              currentConfig.provider = fileData.llm?.fast?.provider || 'deepseek';
              currentConfig.baseUrl = fileData.llm?.fast?.baseUrl || 'https://api.deepseek.com';
              currentConfig.model = fileData.llm?.fast?.model || 'deepseek-v4-flash';
              currentConfig.hasKey = !!fileData.llm?.fast?.apiKey;
            } catch {}
          }
          json({ success: true, config: currentConfig });
        } catch (err) { json({ success: false, error: String(err) }, 500); }
        return;
      }

      // POST: 持久化保存前端输入的渠道及模型，并向看门狗发信号执行有丝分裂热重启
      if (url.pathname === '/api/control/config/save' && req.method === 'POST') {
        let body = '';
        req.on('data', (c) => body += c);
        req.on('end', () => {
          try {
            const { provider, baseUrl, model, apiKey } = JSON.parse(body);
            const configPath = path.join(process.cwd(), 'nova.config.json');
            let baseConfig = { llm: { fast: {}, reflective: {}, deep: {} } } as any;
            
            if (fs.existsSync(configPath)) {
              try { baseConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8')); } catch {}
            }

            const finalKey = (apiKey === '••••••••••••••••••••••••' || !apiKey)
              ? baseConfig.llm?.fast?.apiKey : apiKey;

            ['fast', 'reflective', 'deep'].forEach((tier) => {
              if (!baseConfig.llm[tier]) baseConfig.llm[tier] = {};
              baseConfig.llm[tier].provider = provider;
              baseConfig.llm[tier].baseUrl = baseUrl;
              
              if (tier === 'deep' && provider === 'deepseek' && model === 'deepseek-v4-flash') {
                baseConfig.llm[tier].model = 'deepseek-v4-pro';
              } else {
                baseConfig.llm[tier].model = model;
              }
              if (finalKey) baseConfig.llm[tier].apiKey = finalKey;
            });

            fs.writeFileSync(configPath, JSON.stringify(baseConfig, null, 2), 'utf-8');
            json({ success: true });

            setTimeout(() => {
              bus.pulse('system:reincarnation_ready', { trigger: 'api_config_changed' }, 'DashboardServer');
            }, 1000);
          } catch (err) { json({ success: false, error: String(err) }, 400); }
        });
        return;
      }

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
          learning: agent.learning.getStats(),
          waste: { total: waste.total, h: waste.hallucinationWaste, e: waste.errorWaste, s: waste.staleKnowledge },
          systems: st.biometrics.map(b => ({ name: b.system.replace('System', ''), status: b.status, load: Math.round(b.load * 100) })),
          upgrades: agent.Upgrades.map((u: any) => u.name),
          availableUpgrades: agent.getAvailableUpgrades().map((u: any) => ({ id: u.id, name: u.name, description: u.description, cost: u.cost })),
          wisdom: agent.Wisdom, personality: agent.Personality,
          foraging: agent.foraging.getStats(),
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
          const modelName = (agent.nervous as any).currentModel || 'fast';
          const data = JSON.stringify({
            stage: st.stage, uptime: st.uptime, wisdom: agent.Wisdom,
            energy, heart, model: modelName, role: '通用',
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

      // SSE: event bus pulse
      if (url.pathname === '/api/event-bus-pulse') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*'
        });
        const onChunk = (event: any) => {
          if (event.origin === 'NervousSystem') {
            try { res.write(`event: thought:chunk\ndata: ${JSON.stringify({ chunk: event.payload?.chunk || '', isReasoning: event.payload?.isReasoning ?? false })}\n\n`); } catch {}
          }
        };
        const onPerceived = () => {
          try { res.write(`event: thought:perceived\ndata: {}\n\n`); } catch {}
        };
        const onLearning = (event: any) => {
          try {
            const p = event.payload || {};
            const msg = p.error ? `❌ ${p.error}` : `📖 学习了: ${(p.learned || []).join(', ')}`;
            res.write(`event: learning:cycle\ndata: ${JSON.stringify({ message: msg, error: !!p.error })}\n\n`);
          } catch {}
        };
        bus.on('thought:chunk', onChunk);
        bus.on('thought:perceived', onPerceived);
        bus.on('learning:cycle', onLearning);
        req.on('close', () => {
          bus.removeListener('thought:chunk', onChunk);
          bus.removeListener('thought:perceived', onPerceived);
          bus.removeListener('learning:cycle', onLearning);
        });
        return;
      }

      // Control: model override，支持解除硬锁定，退回自动模式
      if (url.pathname === '/api/control/model' && req.method === 'POST') {
        let body = '';
        req.on('data', (c) => body += c);
        req.on('end', () => {
          try {
            const { mode } = JSON.parse(body);
            if (mode === 'auto') {
              (agent.nervous as any).isModelLocked = false;
              (agent.nervous as any).currentModel = 'reflective';
              json({ ok: true });
            } else if (mode && ['fast', 'reflective', 'deep'].includes(mode)) {
              (agent.nervous as any).currentModel = mode;
              (agent.nervous as any).isModelLocked = true;
              json({ ok: true });
            } else { json({ ok: false }, 400); }
          } catch { json({ ok: false }, 400); }
        });
        return;
      }

      // Control: physiology
      if (url.pathname === '/api/control/physiology' && req.method === 'POST') {
        let body = '';
        req.on('data', (c) => body += c);
        req.on('end', () => {
          try {
            const { action } = JSON.parse(body);
            if (action === 'sleep') { agent.isSleeping = true; json({ ok: true }); }
            else if (action === 'flush') { bus.flushWaste(100); json({ ok: true }); }
            else { json({ ok: false }, 400); }
          } catch { json({ ok: false }, 400); }
        });
        return;
      }

      // Control: upgrade
      if (url.pathname === '/api/control/upgrade' && req.method === 'POST') {
        let body = '';
        req.on('data', (c) => body += c);
        req.on('end', () => {
          try {
            const { id } = JSON.parse(body);
            const ok = agent.applyUpgrade(id);
            json({ ok });
          } catch { json({ ok: false }, 400); }
        });
        return;
      }

      // ── Debug: manually trigger learn cycle ──
      if (url.pathname === '/api/learn' && (req.method === 'POST' || req.method === 'GET')) {
        agent.learning.learnCycle().then(results => {
          json({ ok: true, results });
        }).catch(err => {
          json({ ok: false, error: err.message }, 500);
        });
        return;
      }

      // ── Chat: proxy to Hermes agent (with tools!) ──
      if (url.pathname === '/api/chat' && req.method === 'POST') {
        let body = '';
        req.on('data', (c) => body += c);
        req.on('end', async () => {
          try {
            const { text } = JSON.parse(body);
            if (!text) { json({ ok: false }, 400); return; }

            // Call Hermes dashboard chat bridge (port 9119) — it now returns SSE directly
            const http = require('http');
            const bridgePayload = JSON.stringify({ message: text });

            const bridgeReq = http.request({
              hostname: '127.0.0.1',
              port: 9119,
              path: '/api/chat/bridge',
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(bridgePayload)
              }
            }, (bridgeRes: any) => {
              // Pipe Hermes SSE stream straight through to the client
              res.writeHead(bridgeRes.statusCode || 200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*'
              });
              bridgeRes.pipe(res);
              bridgeRes.on('error', () => { if (!res.writableEnded) res.end(); });
            });
            bridgeReq.on('error', (err: any) => {
              json({ error: `Cannot reach Hermes dashboard (port 9119): ${err.message}. Is Hermes running?` }, 502);
            });
            bridgeReq.write(bridgePayload);
            bridgeReq.end();
          } catch (err: any) { json({ error: err.message }, 400); }
        });
        return;
      }

      // POST: chat input (saves response to memory on thought:complete)
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
              // Save assistant response to memory once complete
              const onComplete = (event: any) => {
                const resp = event.payload?.response || '';
                if (memory && resp) memory.addMessage('assistant', resp);
                agent.bus.removeListener('thought:complete', onComplete);
              };
              agent.bus.once('thought:complete', onComplete);
              json({ ok: true });
            } else { json({ ok: false }, 400); }
          } catch { json({ ok: false }, 400); }
        });
        return;
      }

      // POST: create new session
      if (url.pathname === '/api/session/new' && req.method === 'POST') {
        const memory = (agent as any).memory;
        if (memory) {
          const name = url.searchParams.get('name') || `会话 ${new Date().toLocaleTimeString()}`;
          const id = memory.createConversation(name);
          json({ ok: true, id });
          return;
        }
        json({ ok: false }, 400);
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
            gemini: { name: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com' }
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

      // Conversations 历史流：为未命名线程增加自然数索引优雅降级
      if (url.pathname === '/api/convs') {
        const memory = (agent as any).memory;
        if (memory) {
          const convs = memory.getConversations().slice(0, 20);
          json(convs.map((c: any, idx: number) => ({
            id: c.id,
            name: c.name || `意图线程 #${idx + 1}`, 
            msgs: c.messageCount || 0,
            current: c.id === memory.getCurrentConversationId()
          })));
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
    } catch (e: any) { json({ error: e.message }, 500); return; }

    try {
      const html = fs.readFileSync(htmlPath, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch {
      res.writeHead(500);
      res.end('Dashboard HTML not found.');
    }
  });

  server.listen(port, () => {
    console.log(`  Nova Dashboard: http://localhost:${port}`);
  });
}
