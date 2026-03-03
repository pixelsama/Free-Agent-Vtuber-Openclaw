const assert = require('node:assert/strict');
const test = require('node:test');

const { registerVoiceSessionIpc } = require('../ipc/voiceSession');

function createIpcMainMock() {
  const handlers = new Map();

  return {
    handle(channel, handler) {
      handlers.set(channel, handler);
    },
    removeHandler(channel) {
      handlers.delete(channel);
    },
    async invoke(channel, payload) {
      const handler = handlers.get(channel);
      if (!handler) {
        throw new Error(`Missing handler for ${channel}`);
      }
      return handler({}, payload);
    },
  };
}

test('voice session start -> chunk -> commit emits state and asr events', async () => {
  const ipcMain = createIpcMainMock();
  const emitted = [];

  registerVoiceSessionIpc({
    ipcMain,
    emitEvent: (event) => emitted.push(event),
    createAsrServiceImpl: () => ({
      transcribe: async ({ onPartial }) => {
        onPartial('hel');
        return { text: 'hello' };
      },
    }),
  });

  const started = await ipcMain.invoke('voice:session:start', {
    sessionId: 's1',
    mode: 'vad',
  });
  assert.equal(started.ok, true);
  assert.equal(started.status, 'listening');

  const chunkResult = await ipcMain.invoke('voice:audio:chunk', {
    sessionId: 's1',
    seq: 1,
    chunkId: 1,
    pcmChunk: Buffer.from([1, 2, 3, 4]),
    sampleRate: 16000,
    channels: 1,
    sampleFormat: 'pcm_s16le',
    isSpeech: true,
  });
  assert.equal(chunkResult.ok, true);

  const committed = await ipcMain.invoke('voice:input:commit', {
    sessionId: 's1',
    finalSeq: 1,
  });
  assert.equal(committed.ok, true);
  assert.equal(committed.text, 'hello');

  const eventTypes = emitted.map((event) => event.type);
  assert.deepEqual(eventTypes, ['state', 'state', 'asr-partial', 'asr-final', 'done', 'state']);
  assert.equal(emitted[3].text, 'hello');
});

test('voice playback ack emits flow-control pause/resume', async () => {
  const ipcMain = createIpcMainMock();
  const flowEvents = [];

  registerVoiceSessionIpc({
    ipcMain,
    emitEvent: () => {},
    emitFlowControl: (event) => flowEvents.push(event),
  });

  await ipcMain.invoke('voice:session:start', { sessionId: 's2' });
  await ipcMain.invoke('voice:playback:ack', {
    sessionId: 's2',
    ackSeq: 1,
    bufferedMs: 2500,
  });
  await ipcMain.invoke('voice:playback:ack', {
    sessionId: 's2',
    ackSeq: 2,
    bufferedMs: 300,
  });

  assert.equal(flowEvents.length, 2);
  assert.equal(flowEvents[0].action, 'pause');
  assert.equal(flowEvents[1].action, 'resume');
});

test('voice commit is serialized and does not mix chunks across turns', async () => {
  const ipcMain = createIpcMainMock();
  const chunkSeqsPerCommit = [];
  let resolveFirstCommit;

  registerVoiceSessionIpc({
    ipcMain,
    emitEvent: () => {},
    createAsrServiceImpl: () => ({
      transcribe: async ({ audioChunks }) => {
        chunkSeqsPerCommit.push(audioChunks.map((chunk) => chunk.seq));
        if (chunkSeqsPerCommit.length === 1) {
          return new Promise((resolve) => {
            resolveFirstCommit = () => resolve({ text: 'first' });
          });
        }

        return { text: 'second' };
      },
    }),
  });

  await ipcMain.invoke('voice:session:start', {
    sessionId: 's3',
    mode: 'vad',
  });

  await ipcMain.invoke('voice:audio:chunk', {
    sessionId: 's3',
    seq: 1,
    chunkId: 1,
    pcmChunk: Buffer.from([1, 2]),
    sampleRate: 16000,
    channels: 1,
    sampleFormat: 'pcm_s16le',
    isSpeech: true,
  });

  const firstCommitPromise = ipcMain.invoke('voice:input:commit', {
    sessionId: 's3',
    finalSeq: 1,
  });
  await Promise.resolve();

  await ipcMain.invoke('voice:audio:chunk', {
    sessionId: 's3',
    seq: 2,
    chunkId: 2,
    pcmChunk: Buffer.from([3, 4]),
    sampleRate: 16000,
    channels: 1,
    sampleFormat: 'pcm_s16le',
    isSpeech: true,
  });

  const overlappingCommit = await ipcMain.invoke('voice:input:commit', {
    sessionId: 's3',
    finalSeq: 2,
  });
  assert.equal(overlappingCommit.ok, false);
  assert.equal(overlappingCommit.reason, 'transcribing_in_progress');

  resolveFirstCommit();
  const firstCommit = await firstCommitPromise;
  assert.equal(firstCommit.ok, true);
  assert.equal(firstCommit.text, 'first');

  const secondCommit = await ipcMain.invoke('voice:input:commit', {
    sessionId: 's3',
    finalSeq: 2,
  });
  assert.equal(secondCommit.ok, true);
  assert.equal(secondCommit.text, 'second');

  assert.deepEqual(chunkSeqsPerCommit, [[1], [2]]);
});
