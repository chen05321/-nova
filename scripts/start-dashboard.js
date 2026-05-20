/**
 * Nova Dashboard — 独立启动入口
 */
const { StatusServer } = require('./dist/dashboard/status-server');
const { NovaAgent } = require('./dist/nova-agent');

async function main() {
  const agent = new NovaAgent();
  await agent.boot();

  const server = new StatusServer(3456);
  server.setNovaAgentRef(agent);
  server.start();
}

main().catch(err => {
  console.error('[Dashboard] Fatal:', err);
  process.exit(1);
});
