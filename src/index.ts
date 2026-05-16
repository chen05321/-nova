import { NovaAgent } from './nova-agent';

async function main() {
  console.log('╔══════════════════════════════════════╗');
  console.log('║     超体 - Self-Evolving Agent     ║');
  console.log('║   Framework based on 8 Body Systems  ║');
  console.log('╚══════════════════════════════════════╝\n');

  const agent = new NovaAgent();
  await agent.boot();

  // Stage 1: Newborn - Basic interaction
  console.log('\n─── Stage: NEWBORN ───');
  await agent.input('Hello, what can you do?');

  for (let i = 0; i < 6; i++) {
    await agent.input(`Simple task ${i + 1}`);
    agent.bus.pulse('action:completed', { task: i }, 'Demo');
  }

  // Stage 2: Child - Tool use
  agent.registerTool(
    'search',
    'Search the web for information',
    async (q: string) => `Results for: ${q}`
  );

  console.log('\n─── Stage: CHILD ───');
  for (let i = 0; i < 20; i++) {
    await agent.input(`Exploration task ${i + 1}`);
    agent.bus.pulse('action:completed', { task: i + 7 }, 'Demo');
  }

  // Stage 3: Adolescent - Knowledge building
  agent.registerTool(
    'analyze',
    'Analyze data and extract insights',
    async (d: string) => `Analysis of: ${d}`
  );
  agent.registerTool(
    'summarize',
    'Summarize long text',
    async (t: string) => `Summary of: ${t.substring(0, 50)}`
  );

  console.log('\n─── Stage: ADOLESCENT ───');
  for (let i = 0; i < 10; i++) {
    agent.bus.pulse('learning:new', { id: `k${i}`, content: `Knowledge ${i}` }, 'Demo');
  }

  for (let i = 0; i < 25; i++) {
    await agent.input(`Knowledge task ${i + 1}`);
    agent.bus.pulse('action:completed', { task: i + 27 }, 'Demo');
  }

  // Show status
  const status = agent.getStatus();
  console.log('\n─── 超体 STATUS ───');
  console.log(JSON.stringify({
    stage: status.stage,
    uptime: `${(status.uptime / 1000).toFixed(0)}s`,
    actions: status.actionCount,
    systems: status.biometrics.map((b: { system: string; status: string; load: number }) => ({
      name: b.system,
      status: b.status,
      load: b.load.toFixed(2)
    })),
    transitions: status.transitions
  }, null, 2));

  console.log('\n─── Growth Summary ───');
  for (const t of status.transitions) {
    const date = new Date(t.timestamp);
    console.log(`  ${date.toISOString().substring(11, 19)}: ${t.from} → ${t.to} (${t.trigger})`);
  }

  console.log(`\nCurrent stage: ${status.stage}`);
  console.log('超体 framework is running successfully.');
}

main().catch(console.error);
