// Talking to the local model for "Ask the data" (ask.js): the instructions and the
// log it reads, the request for each kind of program, and reading its streamed
// answer. No DOM, so the tests run it. The browser sends this straight to the
// model's address on the manager's computer; the website's server never sees it.

const COMPANY = 'Olira Agro Industry, an Ethiopian company with two businesses: Olira Agro (agricultural exports: sesame, pulses, spices, coffee) and Olira Packaging (printed paper bags, food boxes, medical packets and foil bags, with a mockup studio on the website).';

/** The log, smaller for a model with little room: a long day-by-day series becomes weeks. */
export function compactForModel(log) {
  const out = JSON.parse(JSON.stringify(log));
  const daily = out.traffic?.daily;
  if (Array.isArray(daily) && daily.length > 60) {
    const weeks = [];
    for (let i = 0; i < daily.length; i += 7) {
      const w = daily.slice(i, i + 7);
      weeks.push({ from: w[0].date, to: w.at(-1).date, views: w.reduce((n, d) => n + d.views, 0), visitors: w.reduce((n, d) => n + d.visitors, 0), enquiries: w.reduce((n, d) => n + d.enquiries, 0) });
    }
    delete out.traffic.daily;
    out.traffic.weekly = weeks;
  }
  return out;
}

/** The instructions: answer from the log only, plainly, and say when it does not know. */
export function instructions(log, schema) {
  return [
    `You are the website analyst for ${COMPANY}`,
    'You answer the manager\'s questions about how the website is doing, using only the data log below.',
    'Rules:',
    '- Use only figures that are in the log, and say which period they cover.',
    '- If the log does not hold the answer, say so plainly and say what would need to be measured. Never invent a number, a product or a reason.',
    '- Shares are fractions: 0.25 means 25 percent. Times are in milliseconds unless the name says seconds or hours.',
    '- Answer first in one or two sentences, then at most five short points. Plain text: no tables, no headings, no markdown.',
    '- When asked what to do, suggest at most two concrete next steps, each tied to a figure in the log.',
    '',
    `What the log's parts mean: ${JSON.stringify(schema || {})}`,
    '',
    `The data log (${log?.schema || 'olira-site-log'}):`,
    JSON.stringify(compactForModel(log)),
  ].join('\n');
}

/** The conversation for the model: instructions, up to three earlier exchanges, the question. */
export function messagesFor(question, history, log, schema) {
  const earlier = (history || []).slice(-3).flatMap((x) => [{ role: 'user', content: x.q }, { role: 'assistant', content: x.a }]);
  return [{ role: 'system', content: instructions(log, schema) }, ...earlier, { role: 'user', content: String(question).slice(0, 500) }];
}

/** The request for the model's program: Ollama's own chat API, or the OpenAI-compatible one. */
export function requestFor(llm, messages) {
  const base = String(llm.url).replace(/\/+$/, '');
  if (llm.kind === 'openai') return { url: `${base}/chat/completions`, body: { model: llm.model, messages, stream: true, temperature: 0.2 } };
  // room for the whole log: Ollama's default context is too small for it
  return { url: `${base}/api/chat`, body: { model: llm.model, messages, stream: true, options: { num_ctx: 16384, temperature: 0.2 } } };
}

/**
 * One line of the streamed answer: { text } to add, { done }, { error }, or null to
 * skip. Ollama sends a JSON object per line; OpenAI-compatible servers send
 * "data: {...}" lines and "data: [DONE]".
 */
export function readLine(kind, line) {
  const s = String(line || '').trim();
  if (!s) return null;
  if (kind === 'openai') {
    if (!s.startsWith('data:')) return null;
    const payload = s.slice(5).trim();
    if (payload === '[DONE]') return { done: true };
    try {
      const j = JSON.parse(payload);
      if (j.error) return { error: String(j.error.message || j.error) };
      const text = j.choices?.[0]?.delta?.content ?? j.choices?.[0]?.message?.content ?? '';
      return text ? { text } : (j.choices?.[0]?.finish_reason ? { done: true } : null);
    } catch (e) { return null; }
  }
  try {
    const j = JSON.parse(s);
    if (j.error) return { error: String(j.error) };
    if (j.done) return { done: true, text: j.message?.content || '' };
    return j.message?.content ? { text: j.message.content } : null;
  } catch (e) { return null; }
}

/** Lines from a streamed response body, as they arrive. */
export async function* streamLines(body) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (line.trim()) yield line; }
  }
  if (buf.trim()) yield buf;
}
