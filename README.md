# CelestiSign

A two-player, webcam-controlled ASL fingerspelling game. The players' **hands** are the
controllers. One webcam tracks both players with
MediaPipe Hand Landmarker, and a classifier trained for this project reads the ASL letter
each hand is making. Asteroids carrying letters fall toward each player's base, and signing
the letter blasts them.

```
web/        the game (Vite + vanilla JS + Canvas 2D, runs fully in the browser)
training/   dataset download, landmark extraction, classifier training, evaluation, export
```

## Quick start

```bash
cd web
npm install        # also copies the MediaPipe WASM runtime + hand model into public/
npm run dev        # https://localhost:5173 or https://<server-ip>:5173 (self-signed cert: accept the warning once)
npm test           # unit tests: classifier parity with Python, gesture logic, game engine
npm run build      # static site in web/dist/ (relative paths, host anywhere over https)
```

There is no server component. The classifier, a TensorFlow.js model in
`public/models/asl_tfjs/`, is already trained. To retrain it, see [training/README.md](training/README.md).

## How to play

1. **Start with webcam.** Both players stand side by side in front of one camera.
   **Player 1 is whoever's hand is on the left of the screen, Player 2 the one on the right.** Each
   player signs with one hand, and either hand works. The game detects whether it's a left or
   right hand and shows the pose hints for that hand.
2. **Camera setup.** A live view shows each player's tracked hand and predicted letter. When
   both hands are tracked, both players hold a flat **B** to start practice, or anyone holds
   **Y** to skip straight to the game. See *Hands-free menus* below.
3. **Practice round.** Each player signs four letters at their own pace on stationary asteroids,
   with a **pose coach** for players who don't know the alphabet yet:
   * step-by-step instructions for the letter
   * a **three.js 3D view** of the target handshape (a translucent "ghost" hand), with the
     player's own tracked hand overlaid live. Each finger turns green (matches), amber (nearly)
     or red (adjust). The view sways to show depth and can be dragged to rotate.
   * a match meter: the classifier's live probability for the target letter
   * plain feedback, such as "Adjust: thumb, index" or "Fingers look right – turn your hand to
     match the ghost"
   
   Finger checks compare the two outer joints of each finger with a reference pose. Each
   finger's tolerance is learned from how much real signers vary (`hand_poses.json`). three.js
   is loaded only when practice starts. If WebGL is unavailable, the coach falls back to the
   steps and the 2D diagram.
4. **3-2-1-GO**, then the duel. The **last player with health remaining wins**.
5. **Results** show score, kills, bubbles, accuracy, best combo and hits taken. For a rematch,
   both hold **B** or press <kbd>Enter</kbd>.

### Hands-free menus

Hand tracking starts as soon as the page loads (the browser asks for the camera once), so every
menu, including the very first screen, can be driven by handshapes. Ghost skeletons of the
tracked hands drift behind the menus. Each button has a badge with
the ASL pose and its letter. Hold that pose until the badge's ring fills (the same hold as
in-game) and the button fires with a ripple. A **legend bar** at the bottom lists the current
screen's poses, and highlights the one the camera sees and the one being held.

| Pose | Means | Where |
|---|---|---|
| **B** (flat hand) | confirm / go | Start · Practice · Resume · Rematch · Try again |
| **L** | leave | Back · Main menu |
| **Y** | skip | Skip to game · Restart match |
| **V** / **C** | Versus / Co-op | start screen |
| **O** / **X** | toggle shared orbs / shared targets | start screen (Co-op) |
| **K** | keyboard mode | camera error screen |

* **Practice** (setup) and **Rematch** (results) need **both** players to hold B. Their badges
  are marked ×2 and light up in each player's colour as they confirm.
* **Navigation letters** are only accepted on menu screens. In-game letters are untouched.
* **No camera:** if the camera is blocked or missing at launch, the page still works. The legend
  says so, and *Start with webcam* retries with full error messages.

### UI motion (GSAP)

* **Screens:** they enter with a staggered panel animation. Each panel has a slowly rotating
  gradient border.
* **Logo:** the letters drop in, float, and lean away from the pointer.
* **Buttons:** they have a dark fill with the gradient on the **border only**. On hover they lift,
  glow, and the border gradient sweeps round. Pressing gives a springy bounce. Orb cards tilt
  in 3D.
* **Versus ↔ Co-op:** a highlight pill slides between the two mode buttons. Below them, a
  fixed-height area cross-fades between the Versus summary and the Co-op options, so the panel
  never changes size.
* **Countdown and results:** the countdown pops. On the results screen the winner banner lands
  with an elastic bounce and the stats count up.
* **Reduced motion:** turns all of this off.

### Signing a letter

* Make the pose shown on your target and **hold it** until the ring around your letter fills
  (about 0.4 s). The ring only fills while the smoothed classifier confidence is at least 0.6.
* On confirmation your turret fires a beam at the target.
* To use the **same letter again**, relax your hand or change pose briefly first. The ring
  turns white and says "relax to repeat" until you do. A different letter counts immediately.
* The bottom panel always shows:
  * what the camera thinks you are signing, with its confidence
  * the **next letter you need**, with a pose diagram and a one-line hint
* The small webcam preview in the bottom centre shows both tracked skeletons and each
  player's predicted letter.

### Rules

* Asteroids show their letter in the centre. **Sequence asteroids** (from level 2) show a
  row of letter chips underneath: the current letter is highlighted white and finished
  letters are ticked. They must be signed in order.
* **Targeting rule:** a confirmed letter hits **every** asteroid, orb or shield node on *your*
  side whose next required letter matches.
  * Single-letter targets are destroyed; sequences waiting on that letter advance one step.
  * Each kill counts toward your combo.
  * Two or more kills from one sign show **MULTI ×N** and add a bonus of 100 per extra kill.
  * One sign still counts as one letter for accuracy.
  * Hits are resolved most-urgent first (least time left), then the older object.
  * With no pose held, the most urgent target has rotating brackets around it.
  * While you hold a pose, **every** target it will hit is locked on: brightened brackets, your
    confirmation progress, a dashed aim line from your turret, and an ×N tag.
* A letter that matches nothing is a **miss** and resets your combo.
* An impact costs 12 HP, plus 6 for each unfinished letter on a sequence asteroid, and resets your combo.
* **Score:**
  * 100 per letter for a destroyed asteroid, 300 for a bubble, 25 for a partial hit
  * a combo multiplier on top: ×1.25 every 3 kills, up to ×3
* **Difficulty** rises every 22 s, up to level 12:
  * asteroids spawn faster (every 3.0 s down to 1.05 s)
  * they fall faster (10.5 s down to 5.2 s to cross the field)
  * more can be on screen at once (3 up to 7)
  * sequences get longer (single letters only at level 1, up to 4 letters from level 6)
* **Both players receive the identical asteroid stream** from the same random seed. The
  difference comes from skill and from power-ups.

### Power-up bubbles

Bubbles appear from about 26 s onward, roughly every 11–18 s per side. They float in the upper
field and need **3–4 letters** before their **deadline ring** runs out (7.5–10 s). If the
deadline passes, they escape harmlessly.

| bubble | look | effect | balance |
|---|---|---|---|
| **Attack** | red, crosshair, spinning spikes | 2–4 extra single-letter asteroids drop on the opponent after a 1.4 s "INCOMING" warning | user cooldown 16 s; victim has a 10 s grace before the next attack |
| **Slow** | violet, hourglass, slow ripples | opponent's confirmation ring fills at **half speed** for 6 s (their ring turns violet) | user cooldown 16 s; victim has a 10 s grace after it ends |
| **Shield** | gold, shield, rotating hexagon | a dome absorbs the next impact (expires after 25 s, blinks near the end) | not offered while a shield is active |
| **Heal** | green, plus sign, rising crosses | +20 HP (max 100) | offered more often below 50 HP; not offered at full health |
| **Freeze** | ice blue, snowflake, crystal spikes | all asteroids and spawns on **your** side pause for 4 s; you can still shoot them | cooldown 14 s |
| **Nova** | orange, starburst, pulsing core with orbiting embers | detonates every asteroid on **your** side (half points each) | cooldown 20 s; offered more often when your side is crowded |
| **Haste** | lime, lightning bolt, crackling arcs | your confirmation ring fills **1.6× faster** for 7 s (Haste and Slow cancel out to 0.8×) | cooldown 16 s |
| **Reflect** | prismatic (shifting rainbow), mirror icon, rotating facets | the next Attack, Slow or Leech aimed at you **bounces back** to the sender (lasts 15 s) | not offered while active |
| **Leech** | crimson, droplet, falling drips | steals 12 HP from the opponent; never takes them below 1 HP | cooldown 18 s; victim has a 10 s grace; only offered while the opponent has > 25 HP |

**Breaking an orb** is a set piece:
* **The break:** a short hit-stop (game time nearly freezes for about 0.1 s), a zoom punch, glass shards, light rays, a colour flash over that half, and a shatter sound.
* **The flight:** the orb's icon flies to whoever it affects. A reflected orb visibly hits the barrier and bounces back.
* **The landing:** a sub-bass hit, a big banner (e.g. "LEECH → Player 2 · 12 HP stolen"), and a finisher specific to the orb:
  * Nova shockwave
  * frost cracks
  * healing light column
  * speed streaks
  * slow ripples
  * red alarm border
  * prism arcs
  * a leech beam carrying health between the bases

Reduced-motion mode drops the hit-stop, zoom, flash and rays.

The effect a bubble carries is picked when it spawns, from the effects allowed at that moment,
so cooldowns and grace periods are always respected.

### Co-op boss mode

On the start screen, choose **Co-op Boss** to team up against **THE SILENCER** (an all-seeing eye that drowns out communication) instead of
fighting each other. Setup, practice and controls are the same.

* **Shared team health (150).** Asteroids hitting either base drain the team pool, shown under
  the boss bar. A player's own Shield still protects their side.
* **Every kill hurts the boss.** Each destroyed asteroid fires a bolt at it: 10 damage per letter,
  times your combo multiplier. Orbs add 20. The HUD shows each player's boss damage, and the
  results screen names an MVP.
* **Telegraphed attacks.** About 1.3 s ahead, the boss's eye charges and a warning appears over
  the target side:
  * **Volley:** rocks on both sides.
  * **Meteor:** a big 3–4-letter rock on one side.
  * **Barrage:** three fast singles on one side (phase 2+).
  * **Curse:** slows one player for 4 s (phase 2+).
* **Core link (the main co-op mechanic).** Every 13–20 s (more often as it weakens) the boss opens its core and shows a
  four-letter chain. The letters alternate between players (e.g. P2 → P1 → P2 → P1), and you must
  sign them **in turn** before the ring runs out. Success deals 150 damage and stuns the boss for
  3 s. While the core is open, a letter that matches your turn on the core advances the chain
  **and** still blasts every matching asteroid.
* **Health and difficulty.** The boss has **4,500 HP**. Difficulty rises **continuously** as
  it weakens, rather than jumping at phase changes. From full health to nearly dead:
  * the asteroid difficulty level climbs smoothly from 2 to 8, bringing faster spawns, faster
    falls, more on screen and longer words
  * the gap between boss attacks shrinks from 6.5 s to 3.8 s
  * core links come more often (every 20 s down to 13 s) with less time to finish (11 s down to
    8.5 s)
* **Phases and shields.** At 66% and 33% health the boss enters a new phase: it changes colour
  and gains new attacks. It also raises a shield and drops a **shield node
  on each side**. It takes no damage until **both** players break their node. Let a node expire
  and the boss regenerates 8% of its health, capped at that phase's threshold.
* **Co-op options.** Two toggles on the start screen appear when Co-op Boss is selected. Both
  are remembered, and the boss HUD shows which rules are active.
  * **Shared power-ups** (on by default): Shield, Freeze, Haste, Reflect and Nova apply to
    **both** players, whoever clears the orb. The icon splits and lands on both sides, with a
    single "TEAM SHIELD!"-style banner. Nova clears both sides, and each player is credited for
    their own side. Turned off, these orbs only help the player who cleared them. Attack, Slow,
    Leech and Heal always act on the boss or the team pool.
  * **Shared targets** (off by default): either player can shoot any asteroid, orb or shield
    node on either side, and the beam crosses the divider.
    * **Targeting:** a sign hits every matching target on **both** sides, most urgent first
      (ties: your own side, then the older object).
    * **Credit:** the shooter gets the score and the boss damage.
    * **Balance:** asteroids spawn about twice as often (0.8× the versus interval instead of
      1.6×), and two more fit on screen per side.
    * **Combos:** a letter whose target your teammate just cleared doesn't break your combo.
    * **Letters:** each side gets its own random asteroid stream (versus and personal-target
      co-op keep identical streams). When a new target's first letter is already in play, it's
      re-rolled once with 60% probability (`DUPLICATE_REROLL` in `web/src/game/words.js`). That
      gives about a third fewer duplicates than pure chance; they still happen, so multi-kills
      stay possible.
    * **Shield nodes** can be broken by either player.
    * **Core link** still alternates P1/P2.
* **Orbs in co-op:**

  | Orb | In boss mode |
  |---|---|
  | Attack | Hits the boss for 60 |
  | Slow | Slows the boss's attack timer |
  | Leech | 40 to the boss, +12 to the team |
  | Heal | +20 to the team |
  | Reflect | Both players: the next boss attack on each side becomes 50 damage to the boss (shared) |
  | Shield, Freeze, Nova, Haste | Applied to both players (shared) |
* **Taunts (Gemini).** THE SILENCER talks: a speech bubble beside its eye, typed out with
  little voice blips.
  * **When it speaks:** at the start, on attack telegraphs, at phase changes, when its shield or
    core breaks or a core link is missed, on a player's miss streak, when the team is low, and
    when it's nearly dead. Big moments always get a line; the rest are rate-limited.
  * **Where the lines come from:** with a Gemini key configured, a batch of lines is requested
    during the 3-2-1 countdown (about 3 s), so even the opening line is usually Gemini's; the
    intro waits up to 2.5 s for it. The batch is refreshed at each phase change. When a player
    keeps fumbling letters, the prompt asks for lines that tease them by name. The context sent is the phase, boss and team
    health, the letters each player keeps fumbling (so it can tease "your N"), and the co-op
    options. **No camera data is sent.** Live lines carry a small "✦ GEMINI" tag.
  * **Without a key or network** (or in a static build), it uses built-in lines.
  * **Setup:** copy `web/.env.local.example` to `web/.env.local` and set `GEMINI_API_KEY`. The
    optional `GEMINI_MODEL` defaults to `gemini-3.5-flash-lite`. The key is read only by the
    dev/preview server's `POST /api/taunts` endpoint (`web/server/taunts.js`) and never reaches
    the browser. Lines are validated and sanitised: one sentence, at most 70 characters, PG,
    and only about the players' play.
* **Win and lose.** The fight ends in **VICTORY** when the boss's health reaches 0, after a
  chain of explosions. It ends in **DEFEAT** if the team pool empties.
* **Tuning.** All numbers live in `web/src/game/boss.js` (`BOSS`). The logic is unit-tested in
  `web/test/boss.test.js`.

### Settings and accessibility

* **Sound** toggle in the top bar: all sound is synthesised with Web Audio.
* **Musical pops (Tetris Effect style).** Destroyed asteroids play notes in D major over a slow
  D → Bm → G → A progression, changing every 3.2 s, so both players always harmonise.
  * A single pop plays a chord tone that climbs with your combo, so a streak becomes a melody.
  * Popping several targets with one sign plays a strummed chord, one note per target, over a
    low root. Four or more targets add a ninth on top.
  * A Nova sweep plays a big, wide chord.
  * Sequence steps play soft passing notes.
  * All of it runs through a light echo and is panned to the player's side
    (`popNote` / `popChord` in `web/src/audio/sfx.js`).
* **Reduced motion** toggle (on by default when the OS asks for reduced motion). It turns off:
  * screen shake
  * hand trails
  * background drift
  * blinking
  * most particles
* Both settings are remembered between sessions.
* Letters always have a dark outline and stay readable over effects. Floating text is drawn last.
* On slow machines the renderer switches off canvas glow (`shadowBlur`) automatically.

### Keyboard / developer controls

| key | action |
|---|---|
| <kbd>a</kbd>–<kbd>y</kbd> | confirm that letter for Player 1 |
| <kbd>Shift</kbd>+letter | confirm that letter for Player 2 |
| <kbd>1</kbd>–<kbd>9</kbd> / <kbd>Shift</kbd>+<kbd>1</kbd>–<kbd>9</kbd> | spawn an Attack / Slow / Shield / Heal / Freeze / Nova / Haste / Reflect / Leech orb for P1 / P2 |
| <kbd>0</kbd> | jump one level |
| <kbd>`</kbd> | debug overlay: frame rates, top-3 probabilities, handedness, confirmation state |
| <kbd>Esc</kbd> | pause / resume |
| <kbd>Enter</kbd> | start / rematch / resume |

**Keyboard mode** on the start screen, or after a camera error, plays the whole game without a webcam.

Everything runs on the player's CPU by default. The URL option `?delegate=GPU` opts MediaPipe into WebGL.

## Recognition pipeline (browser)

```
webcam frame ──► MediaPipe Hand Landmarker (VIDEO mode, 2 hands, CPU / WASM by default)
             ──► PlayerAssigner   which hand belongs to P1 / P2
             ──► features.js      wrist-centred, size-normalised, aspect-corrected, left hands mirrored
             ──► classifier.js    TensorFlow.js MLP (CPU backend), averaged with the mirror image
             ──► GestureConfirmer EMA smoothing → threshold 0.6 → 420 ms hold → release lock
             ──► game engine      targeting, sequences, effects
```

* **Player assignment** (`playerAssign.js`) goes **by screen side**, not by hand:
  * With two hands, the left-most is P1 and the right-most is P2.
  * A single hand goes to the half it's in. Near the midline it keeps its current player, so it
    doesn't flicker between them.
  * A player keeps their slot for 1.2 s after their hand vanishes, and duplicate detections are
    merged.
* **Handedness** is still detected for every hand (MediaPipe's label on the raw, un-mirrored
  frame, which was checked against the training photos). It's used to:
  * mirror left hands before classification
  * show the guide cards, the HUD label and the 3D practice coach for the hand actually being used

  The *Swap left/right detection* checkbox flips this for cameras that mirror in the driver.
  It only affects hints, not who is Player 1.
* **CPU by default:** MediaPipe runs on its WASM/XNNPACK CPU backend at 960×540, and the
  classifier is plain JavaScript. No GPU is needed. With `?delegate=GPU`, the tracker first
  checks the GPU path on a bundled hand photo, because some WebGL stacks initialise but
  silently detect nothing, and falls back to CPU if needed.
* **Missing hands:**
  * after 0.7 s without your hand, your half shows "Player N: raise your hand"
  * after 3.5 s the match auto-pauses ("Hands lost"), and resumes when both hands are back
  * hiding the browser tab also pauses
* **Low confidence:** the ring stays empty and shows "unsure – hold steady" with a greyed
  letter. Nothing is ever fired below the threshold.
* **Camera errors** (denied, not found, in use, insecure page, model failure) each get a
  specific message, a retry button and a keyboard-mode fallback.

## Performance

Hand tracking is by far the most expensive work. Measured on the dev server (a slow ARM CPU
with no GPU), MediaPipe took ~90 ms per frame, against ~2.5 ms for drawing a frame of the game.
So it runs **off the main thread**:

* **Worker tracking.** `handWorker.js` runs MediaPipe in a Web Worker on the CPU backend.
  * Each new camera frame becomes a downscaled 640×360 `ImageBitmap`, which is handed to the
    worker without copying.
  * The worker sends the bitmap back with the landmarks, so the previews draw exactly the frame
    the skeleton came from.
  * Only one frame is in flight at a time; the rest are skipped.
  * Player assignment and the TensorFlow.js classifier stay on the main thread (about 1 ms).
* **Result:** main-thread tracking cost fell from ~94 ms to ~0.3 ms per frame. Rendering is no
  longer tied to tracking speed (8 → 31 fps in the headless test, which is capped by software
  rendering; a normal browser should reach 60 fps). Gesture holds use real time, so slower
  tracking just means fewer samples per hold.
* **Fallbacks:** if workers are unavailable, tracking runs on the main thread. `?worker=0`
  forces that, and `?delegate=GPU` implies it.
* **Adaptive quality:** if frames stay slower than ~35 fps for a couple of seconds, the canvas
  glow (`shadowBlur`) is switched off and the game canvas drops from 2× to 1× pixel density.
* **Measuring on your machine:** the debug overlay (<kbd>`</kbd>) shows rolling `track` /
  `render` / `frame` timings, plus the worker's detect time and the tracking frame rate.

## Classifier summary

Full details are in [training/README.md](training/README.md).

* **Data:** 3,864 static-letter samples from three public datasets: ASLNow! landmarks, plus two
  photo datasets run through MediaPipe, with each photo also flipped to get real left-hand landmarks.
* **Model:** a 118-feature MLP (128-128-64-24, 41,560 parameters), trained in **TensorFlow/Keras**
  with categorical cross-entropy after a 16-configuration hyperparameter search. It's saved as a
  Keras checkpoint and run in the browser with **TensorFlow.js** on the CPU backend.
* **Accuracy:** 96.4% in 5-fold cross-validation. On a dataset never seen in training it scores
  86.6% (nested estimate; 88.3% non-nested). The 14 letters used by the game average 0.94 F1 on
  unseen datasets.
* **Left hands:** on unseen photos, flipped (left-hand) images score 84.4% vs 87.2% for the
  originals on one dataset, and slightly *better* (93.2% vs 91.4%) on the other. Training on
  MediaPipe landmarks of flipped photos closes most of the original left-hand gap.
* **J and Z** (motion letters) are excluded. A trajectory-based extension is described in the training README.

## Project layout

```
web/src/main.js                     app state machine, screens, input, main loop
web/src/recognition/                handTracker, playerAssign, features, classifier, gestureConfirm
web/src/game/engine.js              pure simulation (no DOM), fully unit-tested
web/src/game/effects.js             power-up definitions and balance constants
web/src/game/boss.js                co-op boss fight logic (phases, attacks, core link, shield nodes)
web/src/render/                     renderer, particles, background, drawing helpers, handViewer3d (three.js),
                                    orbFx (orb-break effects), bossView (the boss, its HUD and attacks)
web/src/recognition/poseCoach.js    finger-by-finger comparison with a reference pose
web/src/audio/sfx.js                procedural sound effects
web/public/models/                  asl_tfjs/ (TF.js model), hand_poses.json (3D reference poses), hand_landmarker.task
web/scripts/convert-model.mjs       scikit-learn weights → TensorFlow.js LayersModel
web/test/                           node:test suites (+ parity fixtures from training)
```

## Testing that was done

* `npm test`: 30 unit tests.
  * Python↔JS feature and probability parity
  * mirror invariance
  * hold, repeat-lock, dropout-grace and slow logic
  * player assignment
  * targeting, sequences, impacts, shield, combo, every effect, cooldowns, difficulty
    ramp, identical spawn streams, win condition
* **Headless Chromium end-to-end run** with a fake webcam stream built from dataset photos
  (P1's photo flipped to make a left hand):
  * both hands were tracked and assigned to the correct player
  * the hands-free "hold B" step advanced setup
  * Player 2 completed all four practice letters through real recognition
  * in the match, beams fired and asteroids were destroyed from recognised poses
* **Keyboard-mode run:** effects, combos, game over and the results screen.
* **Not yet tested:** play with a real webcam and two real people. Tune `DEFAULT_CONFIRM` in
  `gestureConfirm.js` (threshold, hold time) after a first session if needed.
