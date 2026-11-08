// Ask the data (src/scripts/team/manager/ask-model.js): what the local model is
// told, the request for each kind of program, and reading its streamed answer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compactForModel, instructions, messagesFor, requestFor, readLine, streamLines } from '../src/scripts/team/manager/ask-model.js';

const daily = Array.from({ length: 90 }, (_, i) => ({ date: `d${i}`, views: 2, visitors: 1, enquiries: i % 30 === 0 ? 1 : 0 }));
const log = { schema: 'olira-site-log/1', traffic: { daily, totals: { views: 180 } }, enquiries: { received: 3 } };

test('the model is told to answer from the log only, and gets all of it', () => {
  const text = instructions(log, { sections: { traffic: 'visits' } });
  assert.match(text, /using only the data log/);
  assert.match(text, /Never invent a number/);
  assert.match(text, /0\.25 means 25 percent/);
  assert.match(text, /"traffic":"visits"/, 'the field meanings travel with the log');
  const small = compactForModel(log);
  assert.equal(small.traffic.daily, undefined);
  assert.equal(small.traffic.weekly.length, 13, '90 days as 13 weeks');
  assert.equal(small.traffic.weekly.reduce((n, w) => n + w.views, 0), 180, 'nothing lost in the weeks');
  assert.equal(log.traffic.daily.length, 90, 'the log itself is not changed');
  assert.deepEqual(compactForModel({ traffic: { daily: daily.slice(0, 30) } }).traffic.daily.length, 30, 'a month stays day by day');
});

test('a conversation keeps the last three exchanges and a short question', () => {
  const history = [1, 2, 3, 4].map((n) => ({ q: `q${n}`, a: `a${n}` }));
  const m = messagesFor('x'.repeat(900), history, log, {});
  assert.equal(m[0].role, 'system');
  assert.deepEqual(m.slice(1, -1).map((x) => x.content), ['q2', 'a2', 'q3', 'a3', 'q4', 'a4']);
  assert.equal(m.at(-1).content.length, 500);
});

test('Ollama and OpenAI-compatible servers get their own request, with room for the log', () => {
  const o = requestFor({ kind: 'ollama', url: 'http://localhost:11434/', model: 'llama3.1:8b' }, []);
  assert.equal(o.url, 'http://localhost:11434/api/chat');
  assert.equal(o.body.options.num_ctx, 16384);
  assert.equal(o.body.stream, true);
  const a = requestFor({ kind: 'openai', url: 'http://localhost:1234/v1', model: 'qwen' }, []);
  assert.equal(a.url, 'http://localhost:1234/v1/chat/completions');
  assert.equal(a.body.model, 'qwen');
});

test('streamed answers are read line by line, both formats', async () => {
  assert.deepEqual(readLine('ollama', '{"message":{"content":"Hel"},"done":false}'), { text: 'Hel' });
  assert.deepEqual(readLine('ollama', '{"message":{"content":""},"done":true}'), { done: true, text: '' });
  assert.deepEqual(readLine('ollama', '{"error":"model \\"x\\" not found"}'), { error: 'model "x" not found' });
  assert.equal(readLine('ollama', 'not json'), null);
  assert.deepEqual(readLine('openai', 'data: {"choices":[{"delta":{"content":"lo"}}]}'), { text: 'lo' });
  assert.deepEqual(readLine('openai', 'data: [DONE]'), { done: true });
  assert.deepEqual(readLine('openai', 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}'), { done: true });
  assert.equal(readLine('openai', ': keep-alive'), null);
  // a line split across network chunks is put back together
  const chunks = ['{"message":{"content":"A"}}\n{"mess', 'age":{"content":"B"}}\n', '{"done":true}'];
  const body = new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(new TextEncoder().encode(x)); c.close(); } });
  const out = [];
  for await (const line of streamLines(body)) out.push(readLine('ollama', line));
  assert.deepEqual(out, [{ text: 'A' }, { text: 'B' }, { done: true, text: '' }]);
});
