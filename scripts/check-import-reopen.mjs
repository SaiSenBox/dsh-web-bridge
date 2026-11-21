// Run with the DSH runtime under test; uses only synthetic conversations and
// its own temporary log directory. See CONTRIBUTING.md.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildSeed } from '../lib/index.js';

const runtime = process.argv[2];
assert.ok(runtime, 'provide the path to the installed DSH node_modules/@deepseek-ai');
const load = name => import(pathToFileURL(resolve(runtime, name, 'lib/index.js')));
const [{ Context }, sessionRuntime, backend, { createSystemMessage, createUserMessage }] = await Promise.all([
  load('cordis'),
  load('dsh-session'),
  load('dsh-session-persistence-jsonl'),
  load('dsh-llm')
]);
const { Session, SESSION_FORMAT_VERSION } = sessionRuntime;
const root = await mkdtemp(join(tmpdir(), 'dsh-web-reopen-'));
const withPersistence = async run => {
  const ctx = new Context();
  const plugin = ctx.plugin(backend.apply, { root, compression: 'none' });
  try {
    await plugin.await();
    return await run(ctx.sessionPersistence);
  } finally {
    await plugin.dispose();
  }
};

const makeSession = (transcript, withAssistantOpening) => {
  const provider = 'deepseek-account', model = 'deepseek-chat';
  const title = withAssistantOpening ? 'Assistant-first web history' : 'Web history';
  const seed = buildSeed(transcript, provider, model, title);
  const id = 'session-' + randomUUID();
  const session = Session.create(id, seed, {
    version: SESSION_FORMAT_VERSION, id, createdAt: Date.now(), isSeeded: true, delegationDepth: 0
  }, seed.length);
  const head = session.surface.nodes[0];
  assert.equal(session.eventAt(head).type, 'system/message');
  const turn = seed.findLast(event => event.type === 'turn/end').data.turn + 1;
  const step = 1;
  const prompt = 'System prompt supplied by the destination DSH';
  session.append('turn/start', { turn });
  session.append('step/start', { turn, step });
  // Model one live turn's persisted events without calling a provider.
  session.append('system/message', { turn, step, message: createSystemMessage(prompt) }, {
    surfaceOp: { op: 'replace', startSeq: head, endSeq: head },
    sourceEventSeqs: [head]
  });
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Continue locally' }], source: { kind: 'user' }
  }), { surfaceOp: 'append' });
  session.append('assistant/message', {
    turn, step, stream: [],
    message: {
      id: randomUUID(), role: 'assistant', source: { kind: 'model', provider, model },
      content: [{ type: 'text', text: 'Continued locally' }]
    }
  }, { surfaceOp: 'append' });
  session.append('step/end', { turn, step });
  session.append('turn/end', { turn, reason: { kind: 'completed' } });
  assert.equal(session.eventAt(session.surface.nodes[0]).data.message.content[0].text, prompt);
  return { session, title };
};

try {
  const cases = [
    makeSession([{ role: 'user', text: 'Original question' }, { role: 'assistant', text: 'Original answer' }], false),
    makeSession([
      { role: 'assistant', text: 'Greeting' }, { role: 'assistant', text: 'Second assistant message' },
      { role: 'user', text: 'Original question' }, { role: 'user', text: 'One more question' }
    ], true)
  ];
  await withPersistence(async persistence => {
    for (const { session } of cases) {
      const handle = await persistence.create(session.header, { inheritedEventCount: session.inheritedEventCount });
      try {
        // Commit the seed and the subsequent live turn as separate writes.
        const events = session.snapshotEvents(), cut = session.inheritedEventCount + 1;
        await handle.append(events.slice(0, cut));
        await handle.flush();
        await handle.append(events.slice(cut));
        await handle.flush();
      } finally {
        await handle.close();
      }
    }
  });
  // A fresh service has no hot Session and no previous validation cache.
  await withPersistence(async persistence => {
    for (const { session, title } of cases) {
      const reader = await persistence.open(session.id, 'read');
      try {
        assert.equal(reader.inheritedEventCount, session.inheritedEventCount);
        const loaded = await reader.read();
        assert.deepEqual(loaded.events ?? loaded, session.snapshotEvents());
      } finally {
        await reader.close();
      }
      console.log(`Reopened ${title} and its live continuation (log format ${SESSION_FORMAT_VERSION}).`);
    }
  });
} finally {
  assert.ok(basename(root).startsWith('dsh-web-reopen-'));
  assert.equal(dirname(root), resolve(tmpdir()));
  await rm(root, { recursive: true, force: true });
}
