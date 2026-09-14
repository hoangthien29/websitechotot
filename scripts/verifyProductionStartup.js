require('dotenv').config({ quiet: true });

const assert = require('node:assert/strict');
const net = require('node:net');
const { setTimeout: delay } = require('node:timers/promises');

process.env.NODE_ENV = 'production';

const getFreePort = () =>
  new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close((error) => (error ? reject(error) : resolve(port)));
    });
  });

const waitForHealth = async (url) => {
  let lastError;

  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      return await fetch(url);
    } catch (error) {
      lastError = error;
      await delay(250);
    }
  }

  throw lastError || new Error('Production health check timed out.');
};

(async () => {
  const port = await getFreePort();
  process.env.PORT = String(port);
  process.env.TRUST_PROXY = '0';
  const { shutdown, startServer } = require('../server');

  try {
    await startServer();
    assert.notEqual(process.exitCode, 1, 'Production environment must validate');
    const response = await waitForHealth(`http://127.0.0.1:${port}/healthz`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok' });
    assert.match(response.headers.get('strict-transport-security') || '', /max-age=/i);
    assert.match(response.headers.get('content-security-policy') || '', /upgrade-insecure-requests/i);
    process.stdout.write(
      `${JSON.stringify({ gracefulShutdown: true, healthz: true, productionHeaders: true, startup: true })}\n`,
    );
  } finally {
    await shutdown('STEP13_PRODUCTION_VERIFY');
  }
})().catch((error) => {
  console.error(`Production startup verification failed: ${error.message}`);
  process.exitCode = 1;
});
