// Dev/preview-server endpoint that asks Gemini for boss taunts. The API key stays on the server
// (web/.env.local: GEMINI_API_KEY=...); the browser only ever calls POST /api/taunts.
//
// Request body (all optional): { phase, bossHpPct, teamHpPct, struggling: { p1: ['N'], p2: ['K'] },
//                                shareTargets, shareOrbs, letters: [...] }
// Response: { source: 'gemini', model, taunts: { <category>: [string, ...], ... } }
//           or { source: 'off' } (no key configured) / { source: 'error', message }

export const TAUNT_CATEGORIES = {
  intro: 'the fight begins',
  volley: 'about to rain asteroids on both players',
  meteor: 'about to drop a huge meteor on one player',
  barrage: 'about to fire a rapid barrage at one player',
  curse: 'cursing one player so their gestures slow down',
  phase2: 'enraged at 66% health, entering phase 2 and raising a shield',
  phase3: 'desperate at 33% health, entering the final phase',
  shieldBroken: 'its shield was just shattered by the players',
  coreBroken: 'the players just signed its core link together and stunned it',
  coreMissed: 'the players failed to finish the core link in time',
  missStreak: 'a player keeps signing letters that hit nothing',
  teamLow: 'the team is close to defeat',
  bossLow: 'it is badly hurt and close to death',
  bossWins: 'it has defeated the players',
};

const SYSTEM = `You write lines for THE SILENCER, the final boss of "CelestiSign", a two-player co-op game
where players destroy asteroids by FINGERSPELLING letters in American Sign Language with their hands
in front of a webcam. The Silencer is a giant all-seeing neon eye with tentacles that wants to silence
all communication; the players fight back by signing.
Voice: smug, theatrical, ominous but playful. PG, never cruel, no slurs, nothing about real people,
disabilities, Deaf people or sign language users as a group; mock the players' play, not who they are.
Each line: at most 70 characters, one sentence, no emojis, no quotation marks, no hashtags.
Use the provided context (struggling letters, health) to make lines specific when it fits,
e.g. teasing a letter a player keeps fumbling.`;

const schema = {
  type: 'OBJECT',
  properties: Object.fromEntries(Object.keys(TAUNT_CATEGORIES).map((k) => [k, { type: 'ARRAY', items: { type: 'STRING' } }])),
  required: Object.keys(TAUNT_CATEGORIES),
};

function prompt(ctx) {
  const lines = Object.entries(TAUNT_CATEGORIES).map(([k, d]) => `- ${k}: ${d}`).join('\n');
  const letters = [...ctx.struggling.p1.map((l) => `Player 1 keeps fumbling the letter ${l}`),
    ...ctx.struggling.p2.map((l) => `Player 2 keeps fumbling the letter ${l}`)];
  const personal = letters.length
    ? `\nMake it personal: ${letters.join('; ')}. At least one line in each of missStreak, teamLow, curse and phase2/phase3 must tease one of those letters by name (e.g. "Your N is trembling, Player 1.").`
    : '';
  return `Game context (JSON): ${JSON.stringify(ctx)}${personal}
Write 3 distinct lines for each moment below, as a JSON object mapping each key to an array of strings.
${lines}`;
}

function clean(arr) {
  return (Array.isArray(arr) ? arr : [])
    .filter((s) => typeof s === 'string')
    .map((s) => s.replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f<>`*_#"]/g, '').replace(/\s+/g, ' ').trim())
    .filter((s) => s.length >= 4 && s.length <= 90)
    .slice(0, 4);
}

function parseJson(text) {
  try { return JSON.parse(text); } catch { /* fall through */ }
  const m = text.match(/\{[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : null;
}

async function callGemini({ key, model, ctx, structured }) {
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: structured ? prompt(ctx) : `${prompt(ctx)}\nRespond with ONLY the JSON object.` }] }],
    generationConfig: { temperature: 1.0, ...(structured ? { responseMimeType: 'application/json', responseSchema: schema } : {}) },
  };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    if (!res.ok) {
      const err = new Error(`Gemini HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    const text = (data.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought && p.text).map((p) => p.text).join('');
    const parsed = parseJson(text);
    if (!parsed) throw new Error('Gemini returned no JSON');
    const taunts = Object.fromEntries(Object.keys(TAUNT_CATEGORIES).map((k) => [k, clean(parsed[k])]));
    if (!Object.values(taunts).some((a) => a.length)) throw new Error('Gemini returned no usable lines');
    return taunts;
  } finally {
    clearTimeout(timer);
  }
}

/** Vite plugin: mounts POST /api/taunts on the dev and preview servers. */
export function tauntsApi(env) {
  const key = env.GEMINI_API_KEY;
  const model = env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  let last = 0;
  const handler = async (req, res, next) => {
    if (req.url !== '/api/taunts' || req.method !== 'POST') return next();
    const send = (code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); };
    if (!key) return send(200, { source: 'off' });
    if (Date.now() - last < 3000) return send(429, { source: 'error', message: 'slow down' }); // tiny rate limit
    last = Date.now();
    let raw = '';
    for await (const chunk of req) { raw += chunk; if (raw.length > 4000) break; }
    let ctx = {};
    try { ctx = JSON.parse(raw || '{}'); } catch { /* ignore */ }
    // Only forward known, small fields to the model.
    const safe = {
      phase: Number(ctx.phase) || 1,
      bossHpPct: Math.round(Number(ctx.bossHpPct) || 100),
      teamHpPct: Math.round(Number(ctx.teamHpPct) || 100),
      struggling: {
        p1: (ctx.struggling?.p1 ?? []).filter((l) => /^[A-Z]$/.test(l)).slice(0, 3),
        p2: (ctx.struggling?.p2 ?? []).filter((l) => /^[A-Z]$/.test(l)).slice(0, 3),
      },
      sharedTargets: !!ctx.shareTargets,
      sharedPowerUps: !!ctx.shareOrbs,
    };
    try {
      let taunts;
      try {
        taunts = await callGemini({ key, model, ctx: safe, structured: true });
      } catch (e) {
        if (e.status !== 400) throw e;
        taunts = await callGemini({ key, model, ctx: safe, structured: false }); // schema fields rejected: plain JSON prompt
      }
      send(200, { source: 'gemini', model, taunts });
    } catch (e) {
      console.warn('[taunts]', e.message);
      send(200, { source: 'error', message: e.message.slice(0, 200) });
    }
  };
  return {
    name: 'celestisign-taunts-api',
    configureServer(server) { server.middlewares.use(handler); },
    configurePreviewServer(server) { server.middlewares.use(handler); },
  };
}
