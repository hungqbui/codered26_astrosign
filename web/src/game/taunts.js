// THE SILENCER's taunts: picks a line for the right moment of a co-op boss fight.
// Lines come from Gemini (via the server's POST /api/taunts, see web/server/taunts.js) when a
// key is configured, otherwise from the built-in set below. Fetching never blocks the game:
// a batch is requested at fight start and refreshed (with fresh stats) at each phase change.

export const FALLBACK = {
  intro: ['Two little hands against the silence? Adorable.', 'Speak, then. If your fingers can.', 'I am the end of every word.'],
  volley: ['Let it rain.', 'Spell your way out of this.', 'More letters than you have fingers.'],
  meteor: ['A long word for a short life.', 'Catch this one, if you can spell it.', 'Heavy, isn\'t it?'],
  barrage: ['Faster. FASTER.', 'Can your hands keep up?', 'Three, two, one, too slow.'],
  curse: ['Your fingers feel heavy now.', 'Hush. Slower. Quieter.', 'Let me steady that hand for you.'],
  phase2: ['You have annoyed me.', 'Now I stop holding back.', 'The silence grows teeth.'],
  phase3: ['Enough! I will swallow every letter!', 'You will not finish this word.', 'I have eaten louder voices than yours.'],
  shieldBroken: ['My shield! You will regret that.', 'Lucky. Twice lucky.', 'Hmph. Teamwork. How tedious.'],
  coreBroken: ['Ngh! Who taught you to spell?', 'Together? That is cheating.', 'My eye! My beautiful eye!'],
  coreMissed: ['Too slow to finish a single word.', 'So close. So silent.', 'Out of turn, out of time.'],
  missStreak: ['That letter means nothing here.', 'Signing to the void? I am listening.', 'Wrong. Again. Delicious.'],
  teamLow: ['Your base is crumbling.', 'Almost quiet now.', 'Rest. Let the silence in.'],
  bossLow: ['This is not over.', 'I can still see you.', 'One more word and I will...'],
  bossWins: ['Silence, at last.', 'Not a single word left.', 'Hush now.'],
};

const MIN_GAP = 6.5; // seconds between lines (game time)
const INTRO_WAIT = 2.5; // max seconds the opening line waits for Gemini
const PRIORITY = { phase2: 3, phase3: 3, coreBroken: 3, shieldBroken: 3, bossWins: 3, intro: 2, bossLow: 2, teamLow: 2, coreMissed: 2 };

export class TauntDirector {
  /** @param {{ say:(text:string, live:boolean)=>void, fetchImpl?:typeof fetch, url?:string }} opts */
  constructor({ say, fetchImpl = globalThis.fetch?.bind(globalThis), url = 'api/taunts' }) {
    this.say = say;
    this.fetch = fetchImpl;
    this.url = url;
    this.reset();
  }

  reset() {
    this.introPending = false;
    this.prepared = false;
    this.lines = structuredClone(FALLBACK);
    this.live = false;
    this.used = new Set();
    this.lastAt = -Infinity;
    this.misses = [new Map(), new Map()]; // per player: letter -> times it went wrong
    this.missStreak = [0, 0];
    this.flags = {};
  }

  /** During the countdown: start fetching so Gemini's lines are usually ready for the intro. */
  prepare(g) {
    this.reset();
    this.prepared = true;
    this.refresh(g);
  }

  /** Fight starts: the intro waits briefly (up to INTRO_WAIT s) for the Gemini batch. */
  start(g) {
    if (!this.prepared) this.prepare(g); // no countdown happened: fetch now
    this.prepared = false; // the next fight fetches again
    this.introPending = true;
  }

  struggling(side) {
    return [...this.misses[side].entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([L]) => L);
  }

  async refresh(g) {
    if (!this.fetch) return;
    const body = {
      phase: g.boss.phase + 1,
      bossHpPct: (100 * g.boss.hp) / g.boss.maxHp,
      teamHpPct: (100 * g.team.health) / g.team.max,
      struggling: { p1: this.struggling(0), p2: this.struggling(1) },
      shareTargets: g.shareTargets,
      shareOrbs: g.shareOrbs,
    };
    try {
      const res = await this.fetch(this.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) return;
      const data = await res.json();
      if (data.source !== 'gemini' || !data.taunts) return;
      for (const [k, arr] of Object.entries(data.taunts)) if (arr?.length && this.lines[k]) this.lines[k] = arr;
      this.used.clear();
      this.live = true;
    } catch { /* offline / static build: keep the built-in lines */ }
  }

  pick(category) {
    const pool = this.lines[category] ?? FALLBACK[category] ?? [];
    const fresh = pool.filter((l) => !this.used.has(l));
    const list = fresh.length ? fresh : pool;
    const line = list[Math.floor(Math.random() * list.length)];
    if (line) this.used.add(line);
    return line;
  }

  queue(category, g, force = false) {
    const pr = PRIORITY[category] ?? 1;
    if (!force && g.t - this.lastAt < MIN_GAP && pr < 3) return;
    const line = this.pick(category);
    if (!line) return;
    this.lastAt = g.t;
    this.say(line, this.live);
  }

  /** Called with each frame's game events. */
  onEvents(events, g) {
    if (this.introPending && (this.live || g.t >= INTRO_WAIT)) {
      this.introPending = false;
      this.queue('intro', g, true);
    }
    for (const e of events) {
      switch (e.type) {
        case 'bossTelegraph':
          if (Math.random() < 0.55) this.queue(e.kind, g);
          break;
        case 'bossPhase':
          this.queue(e.phase === 1 ? 'phase2' : 'phase3', g, true);
          this.refresh(g); // new lines that know how the fight is going
          break;
        case 'bossShieldBreak': this.queue('shieldBroken', g, true); break;
        case 'coreBreak': this.queue('coreBroken', g, true); break;
        case 'coreClose': this.queue('coreMissed', g); break;
        case 'miss':
          this.bump(e.side, e.letter);
          if (++this.missStreak[e.side] >= 3) { this.missStreak[e.side] = 0; this.queue('missStreak', g); }
          break;
        case 'impact':
          this.bump(e.side, e.obj?.letters?.[e.obj.idx]);
          break;
        case 'hit':
          this.missStreak[e.side] = 0;
          break;
        case 'gameOver':
          if (e.winner === 'boss') this.queue('bossWins', g, true);
          break;
        default:
      }
    }
    const teamFrac = g.team.health / g.team.max;
    if (!this.flags.teamLow && teamFrac < 0.3) { this.flags.teamLow = true; this.queue('teamLow', g, true); }
    if (!this.flags.bossLow && g.boss.hp / g.boss.maxHp < 0.12 && g.boss.hp > 0) { this.flags.bossLow = true; this.queue('bossLow', g, true); }
  }

  bump(side, letter) {
    if (!letter || side == null) return;
    this.misses[side].set(letter, (this.misses[side].get(letter) ?? 0) + 1);
  }
}
