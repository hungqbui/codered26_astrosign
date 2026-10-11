import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FALLBACK, TauntDirector } from '../src/game/taunts.js';
import { TAUNT_CATEGORIES, tauntsApi } from '../server/taunts.js';

// ---------------------------------------------------------------- server endpoint (mocked Gemini)
function call(plugin, body) {
  let handler;
  plugin.configureServer({ middlewares: { use: (h) => { handler = h; } } });
  return new Promise((resolve) => {
    const req = {
      url: '/api/taunts', method: 'POST',
      async* [Symbol.asyncIterator]() { yield JSON.stringify(body); },
    };
    const res = { statusCode: 0, setHeader() {}, end: (s) => resolve({ status: res.statusCode, json: JSON.parse(s) }) };
    handler(req, res, () => resolve({ next: true }));
  });
}

const geminiReply = (obj) => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }) });

test('no API key: endpoint reports "off" and never calls Gemini', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('should not be called'); };
  try {
    const r = await call(tauntsApi({}), {});
    assert.deepEqual(r.json, { source: 'off' });
  } finally { globalThis.fetch = orig; }
});

test('Gemini lines are cleaned, the key stays in a header, context is whitelisted', async () => {
  const orig = globalThis.fetch;
  let seen;
  globalThis.fetch = async (url, init) => {
    seen = { url, init };
    const lines = Object.fromEntries(Object.keys(TAUNT_CATEGORIES).map((k) => [k, ['Spell THAT, little hands.', '<b>"bad"</b> line', 'x'.repeat(200)]]));
    return geminiReply(lines);
  };
  try {
    const r = await call(tauntsApi({ GEMINI_API_KEY: 'secret-key' }), { phase: 2, struggling: { p1: ['N', 'evil<script>'] }, extra: 'ignored' });
    assert.equal(r.json.source, 'gemini');
    assert.equal(r.json.model, 'gemini-3.5-flash-lite');
    assert.deepEqual(r.json.taunts.intro, ['Spell THAT, little hands.', 'bad line'], 'markup/quotes stripped, overlong dropped');
    assert.ok(!seen.url.includes('secret-key'), 'key not in the URL');
    assert.equal(seen.init.headers['x-goog-api-key'], 'secret-key');
    const sent = JSON.parse(seen.init.body);
    const ctx = sent.contents[0].parts[0].text;
    assert.ok(ctx.includes('"p1":["N"]') && !ctx.includes('script') && !ctx.includes('ignored'));
    assert.equal(sent.generationConfig.responseMimeType, 'application/json');
  } finally { globalThis.fetch = orig; }
});

test('a 400 (schema fields rejected) retries once with a plain JSON prompt', async () => {
  const orig = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (url, init) => {
    bodies.push(JSON.parse(init.body));
    if (bodies.length === 1) return { ok: false, status: 400, text: async () => 'Unknown name "responseSchema"' };
    return geminiReply({ intro: ['Fine. Plain JSON it is.'] });
  };
  try {
    const r = await call(tauntsApi({ GEMINI_API_KEY: 'k' }), {});
    assert.equal(r.json.source, 'gemini');
    assert.deepEqual(r.json.taunts.intro, ['Fine. Plain JSON it is.']);
    assert.equal(bodies.length, 2);
    assert.equal(bodies[1].generationConfig.responseSchema, undefined);
  } finally { globalThis.fetch = orig; }
});

test('Gemini errors degrade to source "error" (the game keeps its built-in lines)', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 500, text: async () => 'boom' });
  try {
    const r = await call(tauntsApi({ GEMINI_API_KEY: 'k' }), {});
    assert.equal(r.json.source, 'error');
  } finally { globalThis.fetch = orig; }
});

// ---------------------------------------------------------------- client director
const game = (over = {}) => ({ t: 0, boss: { phase: 0, hp: 4500, maxHp: 4500 }, team: { health: 150, max: 150 }, shareTargets: false, shareOrbs: true, ...over });

test('director opens with an intro and falls back to built-in lines without Gemini', async () => {
  const said = [];
  const d = new TauntDirector({ say: (t, live) => said.push([t, live]), fetchImpl: async () => ({ ok: true, json: async () => ({ source: 'off' }) }) });
  const g = game();
  d.start(g);
  d.onEvents([], g);
  assert.equal(said.length, 0, 'intro waits briefly for Gemini');
  g.t = 2.6;
  d.onEvents([], g);
  assert.ok(FALLBACK.intro.includes(said[0][0]));
  assert.equal(said[0][1], false);
});

test('the intro uses Gemini lines when they arrive in time', async () => {
  const said = [];
  const d = new TauntDirector({ say: (t, live) => said.push([t, live]), fetchImpl: async () => ({ ok: true, json: async () => ({ source: 'gemini', taunts: { intro: ['Behold, the quiet.'] } }) }) });
  const g = game();
  d.prepare(g); // during the countdown
  await new Promise((r) => setTimeout(r, 0));
  d.start(g);
  d.onEvents([], g);
  assert.deepEqual(said[0], ['Behold, the quiet.', true]);
});

test('director uses Gemini lines once they arrive, and sends struggling letters', async () => {
  const said = [];
  let body;
  const d = new TauntDirector({
    say: (t, live) => said.push([t, live]),
    fetchImpl: async (url, init) => { body = JSON.parse(init.body); return { ok: true, json: async () => ({ source: 'gemini', taunts: { phase2: ['Your N betrays you.'] } }) }; },
  });
  const g = game();
  d.start(g);
  d.onEvents([{ type: 'miss', side: 0, letter: 'N' }, { type: 'miss', side: 0, letter: 'N' }, { type: 'impact', side: 1, obj: { letters: ['K'], idx: 0 } }], g);
  await d.refresh(g);
  assert.deepEqual(body.struggling, { p1: ['N'], p2: ['K'] });
  g.t = 1;
  d.onEvents([{ type: 'bossPhase', phase: 1 }], g);
  assert.deepEqual(said.at(-1), ['Your N betrays you.', true]);
});

test('director rate-limits chatter but always speaks for big moments', () => {
  const said = [];
  const d = new TauntDirector({ say: (t) => said.push(t), fetchImpl: null });
  const g = game();
  d.start(g);
  g.t = 2.5;
  d.onEvents([], g); // intro (no Gemini) at 2.5 s
  g.t = 3.5;
  for (let i = 0; i < 9; i++) d.onEvents([{ type: 'miss', side: 0, letter: 'B' }], g); // would be 3 miss streaks
  assert.equal(said.length, 1, 'no chatter right after the intro');
  d.onEvents([{ type: 'coreBreak' }], g);
  assert.equal(said.length, 2, 'core break always gets a line');
});
