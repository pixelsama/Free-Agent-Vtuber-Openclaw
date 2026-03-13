const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { setTimeout: delay } = require('node:timers/promises');

const { createNanobotBridgeClient } = require('../services/chat/nanobot/nanobotBridgeClient');

function createFakeChildProcess() {
  const child = new EventEmitter();
  child.killed = false;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = {
    destroyed: false,
    write() {},
  };
  child.kill = () => {
    child.killed = true;
    child.emit('exit', null, 'SIGTERM');
  };
  return child;
}

test('nanobot bridge client rejects immediately when bridge exits before ready', async () => {
  const debugEvents = [];
  const client = createNanobotBridgeClient({
    scriptPath: __filename,
    spawnImpl: () => {
      const child = createFakeChildProcess();
      setImmediate(() => {
        child.emit('exit', 2, null);
      });
      return child;
    },
    emitDebugLog: (event) => {
      debugEvents.push(event);
    },
  });

  await assert.rejects(
    Promise.race([
      client.testConnection({ config: {} }),
      delay(200).then(() => {
        throw new Error('bridge did not reject before timeout');
      }),
    ]),
    {
      code: 'nanobot_unreachable',
      message: /Nanobot bridge exited \(code=2, signal=none\)\./,
    },
  );

  assert.equal(debugEvents.some((event) => event.stage === 'bridge-timeout'), false);
});

test('nanobot bridge client times out test request and sends abort', async () => {
  const writes = [];
  const child = createFakeChildProcess();
  child.stdin.write = (chunk) => {
    writes.push(String(chunk || '').trim());
  };

  const client = createNanobotBridgeClient({
    scriptPath: __filename,
    spawnImpl: () => {
      setImmediate(() => {
        child.stdout.emit('data', Buffer.from('{"type":"ready"}\n'));
      });
      return child;
    },
    env: {
      ...process.env,
      NANOBOT_TEST_TIMEOUT_MS: '30',
    },
  });

  await assert.rejects(
    client.testConnection({
      config: {
        provider: 'openrouter',
        model: 'qwen/qwen3.5-flash-02-23',
        apiKey: 'x',
      },
    }),
    {
      code: 'nanobot_test_timeout',
    },
  );

  assert.equal(writes.some((line) => line.includes('"type":"abort"')), true);
  await client.dispose();
});
