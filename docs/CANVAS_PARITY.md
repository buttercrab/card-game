# Live Mighty Canvas parity gates

This is an acceptance ledger for the live renderer migration. A Canvas comparison
fixture, unit tests, successful build, or independently dealt table cannot prove
that a real Mighty room retains its full gameplay and motion.

The original room client, game projection, DOM geometry, Animator, card input,
and PlayerFigure state remain canonical. Canvas must paint the registered
originals, rather than create another hand controller, timing queue, or figure
state machine. Canvas failure must reveal those same originals.

## Evidence rules

1. Compare the same room state and the same authorized viewer. Capture each
   registered original and its Canvas output, with animation times held equal.
   Never compare two independently shuffled deals.
2. Keep static and motion evidence separate. Preview snapshots prove layout and
   primitive painting only. Complete the ordinary local-backend game separately.
3. Preserve artifacts: original image, Canvas image, numerical difference,
   motion receipt, backend state/phase sequence, and test result. A screenshot
   alone is not a completion receipt.
4. Do not widen tolerances to hide missing art, crop, opacity, or animation.
   Investigate failures against the original DOM owner.
5. A gate stays pending until its own observable assertions pass. Report missing
   evidence explicitly; no deployment or live-room rollout follows from this file.

## Numerical acceptance

`web/e2e/canvas-live.spec.ts` compares whole original TableFrame captures from the
same mounted sources. The test temporarily switches the mounted renderer scope to DOM, allowing the
manager to restore the original inline masks and release its sibling canvases.
It restores Canvas mode after each capture; it never mounts a second game.
The comparison also measures each registered primitive crop (mean RGB difference
at most 4 / 255; changed pixels at most 6%) so an empty background cannot hide
missing card or character art. Every primitive has both a core crop and a
16 CSS px overflow crop to include shadows, focus outlines, and hover cues.

- Mean absolute RGB difference: at most **3 / 255**.
- Fraction of pixels with any RGB channel differing by more than 24: at most
  **2%**. Missing court art, pips, glyphs, or characters must still fail review;
  large empty backgrounds must not conceal a missing small primitive.
- Registered source versus Canvas bounds at actual animation frames: at most
  **0.75 CSS px** per coordinate/dimension.
- Identical pixels across 24 frames surrounding 12 no-op resize/class changes.
- Browser errors: zero; ordinary rendering must not silently select fallback.

Capture comparisons retry only when the original source itself changed (a
server message or JS blink) between the pair. A stable-source pixel mismatch is
not retried. Source animations resume after every capture, including failure.

## Gate ledger

Status separates successful operational assertions from renderer parity failures.
Update only from actual test/artifact receipts.

| Gate | Original owner | Required receipt | Status |
| --- | --- | --- | --- |
| Waiting room, player/bot seats, preparation | `Room`, `TableSession`, `Lobby`, `Seat` | Real Canvas room creation, bot fill, original-source capture, native controls | v2 0rMMB3 real-room native controls and waiting-room pixels pass both actual profiles |
| Observer identity, public view, continuous admission | Room client and server admission protocol | Independent observer in same room; zero private hand; request/accept/readiness over hand boundary | v2 0rMMB3 zero observer hand through bidding/exchange/all ten plays; admission/readiness/new hand and actual socket reconnection pass both profiles |
| Seat shuffle and whole identity movement | Server reseat, Table FLIP, Seat identity | Consecutive hand boundary; names/scores/tokens preserved; actual `seat-slide` frames match bounds | v2 0rMMB3 shuffled next hand and original identity motion pass; all live bounds/native corners within 0.5px |
| Deal, bid grace, exact selected bid, misdeal/redeal | Animator, BidPanel, server legal offer | Real deal/bid plus authorized misdeal; same phase assets and timing | v2 0rMMB3 real bid/deal and applicable desktop server-authorized Misdeal/public ten-card throw/redeal pass |
| Exchange, 13/14-card readability, discard/friend | Hand, ExchangePanel, exact action offer | Real exchange/discard/friend and narrow 14-card original-source capture | v2 0rMMB3 actual exchange/discard/friend passes both profiles; DPR3 exchange crops repaired; six-profile static exchange/readability passes |
| All ten tricks and winner/credit/result | Animator, game reports, FinishedHands | 50 played cards, ten winners, actual sweep frames, credit after sweep, result parity | v2 0rMMB3 fifty plays/ten winners, original sweeps/credit ordering and motion geometry pass; actual result pixels pass both profiles, including the former desktop tiny-card failure |
| Replay and next hand | Original replay/result/room components | Ten replay steps; same table and authorized viewer; new deal with Canvas still active | v2 0rMMB3 native round-ten replay pixels and shuffled next hand with two human ten-card hands pass both profiles |
| Hover, focus, first-raise/second-play, keyboard | PlayingCard/Hand native handlers | Native focus and exact typed dispatch; original-source captures at hover/focus/raised state | v2 0rMMB3 native keyboard/two-Enter/context restore pass; six-profile static hover/focus/raised matrix passes |
| Blink, gaze, mood, figure/identity motion | PlayerFigure, shared blinker, original cues | Same source states sampled across blink/gaze/mood and whole identity motion | v2 0rMMB3 actual native blink/gaze/result-mood captures and original WAAPI 10/50/90% motion pass both profiles |
| Resize and CSS media parity | Original Felt/Tray/Hand and viewport helper | Narrow/mobile/desktop/short landscape; same measured original bounds | v2 0rMMB3 native short landscape passes both profiles; DPR3 eight pairs and six-profile static matrix pass |
| Reduced motion and no-flicker | Original motion preference and live painter | Reduced source capture plus unchanged 24-frame hashes on no-op events | v2 0rMMB3 reduced source pixels and twenty-four identical hashes surrounding twelve no-op refreshes pass both profiles |
| Hidden tab and resume | Original worker clock and motion lifecycle | Genuine background/suspension receipt, queued state recovery, no stale draw/input | v2 0rMMB3 genuine hidden/minimized state, backend progress and resumed room pass; native DPR2/zoom/quantum and tiny figures/Mighty card pass; corrected v2 genuine headed same-state pixels pass, including all current trick cards |
| Context loss/fallback/restore/dispose | CanvasSurface and original primitives | Native originals remain usable, recovery repaints, no active callbacks or leaked blobs after unmount | v2 0rMMB3 loss/usable native fallback/restore and room-to-About zero-source/Canvas/probe/idle-RAF cleanup pass both profiles |
| Private metadata and stale input | Registry sanitizer, native current-offer guards | Face-down getters never read, private-face invalidation synchronous, old targets cannot dispatch | v2 0rMMB3 stale native Bid rejection, per-phase observer privacy, immediate same-ID redaction and exact restored-face hash/current native crop pass both profiles |

Native ancestor scrollWidth/scrollHeight/scrollLeft/scrollTop are now a hard
same-state renderer-insertion invariant. Containment passes these fields in
both actual rooms and focused play/result fixtures; accepted capture pairs
must retain all original scroll geometry. Recorded native art/motion changes
permit a new pair, while scroll/bounds differences alone never do.

## Existing behavior to retain, not duplicate

- `games/mighty/table/animator.svelte.ts` owns dealing/redeal duration, landing,
  heavy-card cues, winner pause, sweep, credit ordering, catch-up, and hidden-tab
  completion. Queue catch-up is part of original behavior, not a Canvas defect.
- `games/mighty/Hand.svelte` owns two-click raise/play, discard selection,
  refusal shake, haptics, keyboard dispatch, and hand FLIP. Its measured geometry
  and CSS transforms are renderer inputs.
- `ui/PlayerFigure.svelte` and `blink.ts` own expression, gaze and blink timing.
  Canvas reads their actual registered SVG state, not a stationary duplicate.
- Table seat FLIP moves the identity and its hanging controls together; room
  participation and readiness stay in the existing shared session layer.
- Result, finished hands, replay, bidding, exchange, settings and participation
  controls keep their original accessible DOM and action validation.

## Test scopes

The preview matrix includes lobby/observer, bidding/misdeal, exchange/friend,
play/watch, sweep/result, hover, focus, raised cards, and reduced motion. These
are fixture receipts, labelled `fixture-*` in attachments.

The full game uses the ordinary backend, not the fast-bot server. Fast-bot
backlogs can intentionally collapse the original Animator's motions and are
insufficient to prove representative sweeps. The test completes ten tricks,
reads result/replay, starts the shuffled next hand, and records actual original
animation/surface geometry and credit-after-sweep order while the game runs. Original motion receipts must
include active deal, sweep and seat-slide animations; absent motions are a
failed evidence gate, not silently accepted.

Until every pending ledger row has a receipt, do not call the migration complete
or describe fixture parity as full-game identity. Production rollout remains a
separate action.


Controlled motion samples use the original WAAPI effects produced by the
arrival/sweep preview transitions. Only that fixture harness exercises the
existing clock timer fallback and holds callback completion while setting
those actual effects to 10%, 50%, and 90%. It does not invent equivalent Canvas
keyframes, and is explicitly separate from the real-backend motion receipt.
The genuine visibility test launches and closes its own headed Chromium;
synthetic `visibilitychange` events are not evidence of background behavior.


## First frozen-build measurements

Frozen frontend: `/tmp/card-game-canvas-snapshot-1209`. Backend: ordinary local
server on 4647 (the configured fast-bot companion on 4648 was not used for the
full game). Profile: `1440x900-dark`.

- Static first waiting-room gate failed: frame RGB MAE 0.071839 / 255 and changed
  fraction 0.001218 passed, but `surface-4` crop MAE 3.901971 / 255 and changed
  fraction 0.065709 exceeded the unchanged 0.06 crop fraction limit.
- The real-room run completed all ten manual tricks and passed the 50 played
  card / ten winner assertions, with a same-room observer still seeing no private
  hand. Waiting, bidding, exchange, friend, first/tenth play, and result capture
  receipts were written. Painting parity did **not** pass: result crops included
  MAE 33.077 / 255 (surface-251) and 30.719 / 255 (surface-269).
- That run stopped before replay/next-hand completion due to a harness selector
  error (`Sheet` uses a native dialog and `aria-labelledby`). The selector is
  corrected to `dialog[open]`; those later gates require a fresh run. A separate
  portal scope gap was found and reported: body-mounted Sheet cards must inherit
  the selected Canvas mode rather than escape painting.

Actual images and complete crop metrics are under:
`/tmp/card-game-canvas-live-4647-first/` and
`/tmp/card-game-canvas-live-4647-full/`.
These are failed parity receipts with partial operational evidence, not a
completion claim. Numerical parity checks are soft assertions solely to collect
later phases; any numerical failure still fails the test. Runtime, coverage,
geometry, and private-state gates remain hard assertions.

## Cache snapshot real-room receipt

Snapshot `/tmp/card-game-canvas-snapshot-cache`, `1440x900-dark`, ordinary backend
4647: the real native flow completed bidding, three-card exchange, friend call,
ten manual tricks (server Done: ten tricks / fifty plays), result, replay round
ten, observer admission, and a shuffled next hand with ten cards for each human.
The prior portal replay scope now passes visible primitive coverage.

This run still fails strict crop parity: waiting had six failed regions, result
had ninety-four, and replay had one (MAE 4.204 / 255). Full source descriptors,
images, and authoritative backend receipt are saved under
`/tmp/card-game-canvas-live-4647-cache-full/`.

The shared Playwright configuration defaults to reduced motion. This first cache
run inherited it; its zero deal/sweep/identity motion counts cannot establish
normal-animation parity. The full-game and controlled-motion harness now
explicitly requests `no-preference`. A fresh normal-motion run is required;
neither this receipt nor the successful native flow is renderer completion.

Normal-motion rerun (`/tmp/card-game-canvas-live-4647-cache-motion/`) completed
that same full flow and saved the next-hand receipt before assertions. It saw
20 original deal animations, 50 original sweep animations, eight `seat-slide`
identity animations, 12,466 moving samples, and ten credit events with zero
credit-before-sweep violations. This is real backend motion evidence.

The independent painted-content geometry gate **failed**: maximum error was
581.96875 CSS pixels. Worst sample: `surface-9` (original `svg.figure`, parent
`stand`), source x=231.375 and painted-content x=813.34375, with equal y=380.5,
width=79.09375, height=72.5. The collector excludes deliberately switched DOM
baseline scopes and concealed sources; the retained numerical failure still
requires diagnosis. Pixel parity also remains failing. This receipt proves
original animation owners executed, not that Canvas reproduced them correctly.

That geometry receipt used published last-paint coordinates. Native ancestor
transforms can move both the source and its Canvas sibling after publication,
so the value is a provisional failure, not a proven live shape mismatch. The
oracle now requires the independently transformed SVG content plane stamped
with `data-canvas-content-for` and reads its actual bounding box alongside the
original source in the same rAF callback. No source-box or stored-coordinate
fallback is accepted. A fresh build also recreates Canvas siblings after source
reparenting; the live-plane rerun must establish the outcome.

The cache auxiliary run exercised native focus, two-step keyboard selection,
context-loss visible fallback and restoration, twenty-four unchanged pixel
hashes over twelve no-op refreshes, and short landscape layout. All six original
arrival/sweep 10/50/90 percent samples were captured. Numerical crop gates still
fail. The retained obsolete native command test passed. Thinking-state fixture,
Misdeal accessible-label comparison, and actual headed-window visibility
mechanics required harness corrections and need new receipts.

## Boundary snapshot receipts

Frozen `/tmp/card-game-canvas-snapshot-boundaries`, profiles 390x844-light and
1440x900-dark, sixteen non-static entries: two obsolete-command tests passed,
two profile-specific tests skipped, twelve tests failed. Native workflow
assertions completed on both full-room runs: server Done ten tricks/fifty plays,
round-ten replay, next-hand observer admission, both human hands ten cards,
zero observer private cards at bidding/exchange/all ten play gates, and actual
socket closure followed by a new socket and fresh server state. Both runs also
reached the room-to-About cleanup assertions (zero sources/probes, manager idle).

Independent live content-plane bounds remain failing: mobile maximum 143 CSS
pixels (surface-271 FinishedHands card, source x116 versus plane x259), desktop
maximum 225.94732666015625 CSS pixels (surface-246 leading trick card, source
72.36x98.99 versus plane 115.78x158.39). These values now use live independent
plane bounds at the same rAF as the source. Full receipts are under
`/tmp/card-game-canvas-live-4647-boundaries/`; painting tolerances are unchanged.

All six controlled actual arrival/sweep samples, native thinking/blink/won/done
expression captures, reduced/no-op/focus/context/landscape controls, and exact
server-acknowledged Misdeal public-hand/replacement-deal assertions ran. Their
pixel gates still fail. Same-ID face privacy reached identity/back redaction
assertions but exact restored-front hashing needed initial font/paint settling;
a rerun waits for font readiness and two actual frames. The genuinely headed
window still reported visible under default Playwright background flags, so
real visibility recovery remains unproved; the new isolated-browser rerun
removes those default flags and still requires an actual hidden document.

Genuine visibility receipt is now available under
`/tmp/card-game-canvas-live-4647-nativevisibility/`: a separately launched native
Chromium is attached with `connectOverCDP({noDefaults:true})` in its default
context, avoiding Playwright's primary-session always-focused override. Its
actual window state became minimized and document visibility became hidden;
authoritative backend messages advanced from eleven to seventeen. On native
restoration visibility became visible, the original hand had nine cards, the
player's turn recovered, and all visible sources painted. The operational
visibility assertions passed; six resumed primitive crops still fail parity.
The owned browser process and temporary profile are closed/removed in finally.

Same-ID cached face transition now has captured front/back/restored PNGs and a
receipt before any equality assertion. Mobile exact restoration passed
(front/restored hash 1954373298, back 3852504417, unchanged surface-5).
Desktop preserves source identity and redacts to the back, but exact front
restoration fails (2007386699 versus 366868256, both 116x150). Initial fonts and
actual paint frames are awaited. The lower corner's placement differs visibly
in retained artifacts; that desktop renderer gap remains unresolved.

## Compositor snapshot receipts

`/tmp/card-game-canvas-snapshot-compositor` ran both ordinary-backend full games
and same-source privacy tests; artifacts are under
`/tmp/card-game-canvas-live-4647-compositor/`. All four tests fail renderer gates.
Both full games again completed all operational steps including replay,
next-hand admission, per-phase observer privacy, actual socket reconnection,
and idle cleanup; explicit cleanup JSON receipts are retained.

Mobile independent live-plane maximum remains 143px at the first FinishedHands
paint; 209 samples exceeded 0.75px, and maximum after the third canvas frame was
0.897857666015625px. Desktop maximum is 135.640625px at the first FinishedHands
paint, with 214 samples exceeding 0.75px and after-third-frame maximum
1.484832763671875px. Both saw fifty original sweep effects, twenty deal effects,
zero early-credit violations, and the next hand's two human hands of ten cards.
Original motion execution and successful lifecycle are distinct from failed
Canvas geometry and crop parity. Exact restored-front hashes still fail on both
profiles in this snapshot; front/back/restored PNGs are saved before assertions.

The privacy pose audit under `/tmp/card-game-canvas-live-4647-face-pose/` rules
out observer-induced movement for these failures: both profiles report
`sameSourceGeometry:true`. Initial and restored root/corner/index text boxes,
SVG screen/local matrices and local boxes, computed fonts/paint/transforms,
and DPR are exactly equal, but raw Canvas hashes differ. Exact restoration
therefore remains a renderer failure, not an invalid comparison between
changed poses. Current-state restored-face DOM/Canvas comparisons are now
captured before the strict equality assertion. A changed pose would be reported
explicitly and compared against its current canonical original instead; the
separate idle no-op hash invariant remains unconditional.

## Paint-space desktop static receipts

Frozen `/tmp/card-game-canvas-snapshot-paintspace` desktop-dark static capture
completed fourteen original-state comparisons (eleven phases plus hover, focus,
and first raised gesture). Thirteen have no failing primitive crops; all whole
frame metrics pass. The remaining FinishedHands red joker (`surface-15`,
`card fluid ink-heart frame-joker red won`, 32x44.796875 CSS px) fails with mean
RGB difference 5.06675450153711 and changed fraction 0.08168642951251646.
That one unresolved crop still fails the test; no threshold changed. Detailed
original/Canvas images and source mappings are under
`/tmp/card-game-canvas-live-4647-paintspace-static/`.

Paint-space actual full games and privacy tests both profiles: all four tests
still fail strict renderer gates; artifacts are under
`/tmp/card-game-canvas-live-4647-paintspace-full/`. Both full rooms complete native
workflow, observer privacy, replay/new hand, socket recovery and cleanup again.
Original sweep count is fifty, initial/next deal count twenty, credit count ten,
and early-credit violations zero on both profiles.

The first FinishedHands paint still produces 143px mobile / 135.64032px desktop
independent bounds errors. Rich settled-frame diagnostics show 0.897827px mobile
(source-133 leading club, frame sixteen) and 3.377075px desktop (source-244
diamond, frame seven). No geometry assertion was softened. Desktop real-phase
crop failures are reduced to three regions across exchange, tenth play, and
result; mobile still has multiple actor/card crop failures. Exact same-source
restored-face hashes remain failing with identical original geometry, markup,
index baselines and typography. Improved static desktop evidence does not
supersede these actual-game failures.

## Fresh robust-geometry/native-dash candidate

Fresh current-tree check (zero errors/warnings) and build froze
`/tmp/card-game-canvas-finalcandidate-nbNdme`. Six strict full-game/privacy/stale
entries ran, two workers, with artifacts under
`/tmp/card-game-canvas-live-4647-finalcandidate/`: **four passed, two failed**.

Both profiles now pass same-native-source face-up/back/face-up identity,
redaction, exact restored pixel hash with identical original metrics, and the
current restored-state original/Canvas zone crop comparison. Both stale native
command rejection tests pass. Those new privacy receipts supersede the older
failed restoration observations for this candidate.

Both full rooms complete all native operational assertions again, including
per-phase observer privacy, ten tricks/fifty plays, replay, shuffled next hand,
actual socket recovery and idle teardown. Their strict renderer tests still
fail: first FinishedHands independent plane error 143px mobile /135.64032px
desktop; settled frame-sixteen leading-card error 0.897858px /1.484863px.
Desktop only two result crops fail (mean RGB difference 5.920867 and 4.698346;
the latter changed fraction 0.064760); all its other real-phase crop comparisons
pass. Mobile still has five to seven failing actor/card crops per phase.
No geometry or pixel acceptance was weakened. Static hover now addresses the
exposed native card strip at x4,y10; overlapped fan centers must not be forced.

The independent static/control matrix against the same frozen candidate wrote
102 paired metrics receipts under `/tmp/card-game-canvas-candidate-static/`:
four tests passed, eight failed, twelve profile exclusions. Both desktop themes
pass the fourteen original preview/input scenes. Desktop controlled arrival and
sweep samples and native blink/gaze/result-expression samples also pass. Mobile
primitive crops and the short-landscape control capture still fail. The input,
context restoration and unchanged-frame assertions execute before the latter
landscape numerical failure; that does not make the whole test pass.

Native paint-record investigation establishes a separate mobile rotation gap:
the browser rasterizes vectors after the root rotation, while rotating a cached
Canvas bitmap filters the already-rasterized glyphs again. A diagnostic vector
draw into the final rotation plane passes all three formerly failing rotated
trick-card crops. This remains prototype evidence until the production adapter
and its independent geometry/animation gates pass with the same behavior.

## Resize-observer candidate motion diagnosis

Fresh current-tree check/build froze
`/tmp/card-game-canvas-resizecandidate-C7nOO5`. Both actual full-game tests still
fail strict renderer gates, but the first FinishedHands 143px/135px error is now
absent. Real independent maximum is 0.897918701171875px mobile (four offending
samples) and 1.48486328125px desktop (twelve offending samples).

New worst-sample native animation/CSS diagnostics establish the remaining
initial-frame gap: the original card already has a running `Animation`,
currentTime zero and startTime null, with initial `scale(0.985)`; its computed
transform is that matrix. Both corresponding Canvas and independently measured
probe have no animations and transform none at that same sample. This is a
pending original-animation effect preceding its mirrored initial effect;
no oracle or tolerance changed. Full timing/keyframes, source/parent/Canvas/
probe styles and independent bounds are retained in
`/tmp/card-game-canvas-live-4647-resizecandidate/`.

All ordinary backend, privacy, replay/new-hand, socket and cleanup assertions
pass again; both see fifty sweeps, twenty deals, ten credits and zero early
credits. Desktop residual pixel failure is one result card; mobile still has
multiple actor/card failures. Successful operational behavior and the eliminated
layout error do not establish final renderer completion.

## Synchronous pending-animation candidate

Fresh check/build froze `/tmp/card-game-canvas-pendingcandidate-y9GN9G`.
Actual full-room receipts are under
`/tmp/card-game-canvas-live-4647-pendingcandidate/`. Both native workflows and
all lifecycle/privacy/backend assertions pass again; both renderer tests fail
remaining pixel gates.

Mobile now passes the strict bounds gate through all actual motion, replay,
next hand and reconnection: 61,585 samples, zero exceeding 0.75px, maximum
0.294677734375px. Desktop reports three discrepancies among 82,328 samples,
maximum 57.3365478515625px. Rich diagnostics identify the worst as a measurement
probe clock mismatch: original and actual Canvas have equal transform,
currentTime 16.663/startTime 13777.837, while the independent probe has
currentTime 33.4/startTime 13761.1 and a different transform. This does not prove
the Canvas moved incorrectly at that sample; the independent measurement plane
must be synchronized correctly before the unchanged desktop gate can pass.

The collector also observed stable canonical native Animation object references
across 14,135 mobile /14,404 desktop repeat samples without mutating objects.
That supports reference continuity in real play, separately from the painter's
focused returned-object identity test. Fifty original sweeps, twenty mobile /
thirty desktop deals and ten credits occurred; no early-credit violation.

## First baked-axis integration snapshot

Frozen `/tmp/card-game-canvas-axiscandidate-3W3ukL` ran all sixteen non-static
entries across the two real profiles: five passed, nine failed, two skipped.
Both real full games, genuine hidden/resume, and authorized Misdeal/redeal
complete their operational assertions. Strict renderer errors remain and
pending mirror-copy holding regressed: originals advance to about sixteen
milliseconds while Canvas and probe are paused at zero/startTime null.
Independent maximum bounds discrepancy is 104.109px mobile /129.534px desktop.
Detailed actual animation/style receipts and all captures are under
`/tmp/card-game-canvas-live-4647-axiscandidate/`. Exact private-face restoration
also regressed in this snapshot; those tests fail with unchanged thresholds.

A supplemental card-orientation oracle is now implemented for subsequent runs.
It adds only a hidden, absolutely positioned test-owned SVG reference inside an
original HTML card, anchored to its border box (negative border offsets).
The browser projects that reference's four corners; the test independently
projects the Canvas measurement rectangle using its own actual draw-base
transform. No published source `g.screen` is used. References are excluded from
recipes/fingerprints, have no input/layout effect, and are removed on stop;
zero layout changes from insertion is asserted. This supplements the unchanged
all-source 0.75px bounding-box gate with a 0.75px card-corner gate. SVG player
sources remain under the original independent bounding-box oracle.

Same-state fingerprints now include original native ancestor geometry and
opacity/filter/transform/translate/rotate/scale/origin, as well as source fields.
Renderer-owned probes and positioning-anchor attributes are excluded. Only an
actual native fingerprint change permits a retry; a stable renderer mismatch
still fails. The Misdeal capture now waits for the original replacement hand's
native animations to settle, including CSS ancestor waves, while retaining
both public thrown-hand and private authorized own-hand zones in comparison.
The first axis-run very large Misdeal crops belonged to the replacement hand,
not the public thrown hand; no cause is relabeled without actual native-source
change evidence. The known paused-zero mirrored animation can also explain
those own-hand differences and remains a renderer defect until fixed.

## Combined canonical-padding/gradient candidate

Fresh check/build froze `/tmp/card-game-canvas-rrectcandidate-kxjoAQ`.
All sixteen non-static entries on the two real profiles completed with
**twelve passed, two failed, two skipped**; log:
`/tmp/card-game-canvas-live-4647-rrectcandidate.log`, artifacts:
`/tmp/card-game-canvas-live-4647-rrectcandidate/`.

The mobile actual full-game test now passes every strict pixel crop and frame,
all original/Canvas bounds and independent native card corners, backend,
observer privacy, replay/new hand, socket recovery, credits and idle cleanup.
Desktop passes all operational and motion geometry assertions, but one result
card (`surface-280`, won normal spade, 28.703x40.1875px) exceeds the crop mean
RGB threshold at 4.715079; changed fraction 0.026190 passes.
Both profiles have zero bounding-box/corner violations, maximum about 0.4845px,
and zero native-reference insertion layout changes.

Controlled native 10/50/90% arrivals/sweeps, actual expressions, corrected idle
no-op hashes plus native focus/context recovery/landscape, stale command
rejection, atomic canonical private-face restoration, and applicable genuine
Misdeal all pass. The second failed test is the genuine headed recovery lane:
actual hidden/native minimized state, server progress, resumed state/hand/native
input and source coverage pass, but tiny sidebar figures (26px) and its 22px
Mighty card remain beyond numerical crop limits. These remaining failed gates
prevent completion.

Previous corrected-protocol proof was five passed/one skipped on unchanged
Wf3U5b: `/tmp/card-game-canvas-live-4647-phase-idle.log` with artifacts in the
same basename directory. The older `phase-corrections.log` remains a failed
intermediate run and must not be cited as that passing proof.

Private-face comparisons wait only the original native CSS transitions to
finish, then normal painter frames, and capture pixels, pose, all native colour/
typography styles and actual 2D context state atomically. Immediate redaction
checks still precede that waiting. The no-op test uses an empty-trick legal
Play fixture because the original non-empty initial trick deliberately glances
for 900ms even when physical motion is off. Original-signature and all twenty-
four pixel hashes remain exact assertions; no expected hash is polled.
Surrounding captured native DOM, inputs, score/bubble text and its animated
opacity/geometry are also fingerprinted. Only actual native context changes
permit recapture; stable pixel failures still fail.


## Independent extra-density receipt (DPR 3)

The immutable canonical-padding candidate above was also reviewed with
`/tmp/canvas-density-review.mjs` and its `metrics.py` comparison; evidence is
`/tmp/card-game-canvas-density-rrect/metrics.json`. Both themes pass lobby,
play and done checks at DPR 3. Exchange whole-frame metrics pass, but its
small overlapping card crops 30/31 fail the unchanged mean RGB threshold
(about 4.06–5.03). This is additional density evidence, not completion of all
same-state profiles; the exchange crop failures remain open.


## Native result paint-context reproduction

A focused desktop real-game run on the same immutable kxjoAQ candidate is
recorded in `/tmp/card-game-canvas-result-diagnostic.log`, with artifacts in
`/tmp/card-game-canvas-result-diagnostic/`. It preserves original result DOM,
full source/ancestor CSS and layout, actual Canvas/probe styles, and an
independent browser-DOM reconstruction of primitive geometry and paint phase
before replay or the next hand. The result residual reproduced on a Diamond K
(`surface-264`, mean RGB 4.705291). Its exact BCR width is 28.703125px while
computed CSS width is 28.7031px; result-grid tracks alternate 28.7031/28.7188px.
Independent phase is (918.3278125, 388.65625), with ancestor translation
(-192.57, 0). A separate exchange card crop also failed (mean RGB 8.167351,
changed fraction 0.107376); this run remains a strict failed test.

All actual operational steps nevertheless completed: ten tricks, replay,
shuffled next hand with two human hands of ten cards, observer privacy through
all play stages, socket reconnection and native-source cleanup. Bounds and
independent native corners have zero failures across 102346/60766 samples,
maximum error 0.48461px. These receipts do not erase the numerical paint
failures above.


## Renderer insertion scroll-context invariant

The same mounted native nodes now record scrollWidth, scrollHeight, scrollLeft
and scrollTop in both renderer modes. A changed scroll field is a hard invariant
failure before the same-state retry logic; renderer-caused scroll changes cannot
be classified as native animation/context changes. Original-source fingerprints
also include scroll fields, and failed/exchange/result captures retain original
animation fingerprints plus paired native paint/layout context.

Focused completed-hand preview on unchanged kxjoAQ fails this new invariant:
50 native scroll fields change. Result round-card and row scrollHeight is 61px
in Canvas versus 45px in DOM (+16px); finished-hands/hands and several score/
figure parents also grow. Paired matching source/ancestor computed styles and
DOM-only result grid are saved in `/tmp/card-game-canvas-native-scroll/`, log
`/tmp/card-game-canvas-native-scroll.log`. This is a newly measured renderer
insertion defect; earlier passing geometry receipts did not inspect it.


## Contained Canvas wrapper focused verification

A clean check/build froze `/tmp/card-game-canvas-wrappercandidate-y63Xma`.
The focused retained-native scroll and strict play/completed-hand comparison
passed both 390x844-light and 1440x900-dark (two tests, 8.1s). All four captures
have zero native scroll-field differences and zero failed primitive crops.
Whole-frame mean RGB differences: play mobile 0.189928/desktop 0.158020;
completed-hand mobile 0.015708/desktop 0.006095. Evidence is
`/tmp/card-game-canvas-wrapper-scroll.log` and the matching artifact directory,
which retains both renderer contexts, DOM-only grids and native fingerprints.
The new zero-sized paint boundary is excluded as renderer-owned markup;
original node scroll geometry remains a hard comparison. This repairs the
previous fifty-field insertion defect in these fixtures. Actual full-game
result and 3D exchange paint proof remain pending fresh combined validation.


## Combined containment/3D candidate verification in progress

Clean check/build froze `/tmp/card-game-canvas-combinedcandidate-riZhUk`.
Independent DPR3 verification using the same density scripts now passes all
 eight lobby/exchange/play/done pairs in both themes, including source/core,
16px overflow and whole-frame checks at unchanged limits. Evidence:
`/tmp/card-game-canvas-density-combined/metrics.json`. Exchange whole-frame
mean RGB is approximately 0.136 light/0.123 dark; its former card30/31 failures
are repaired in this receipt.

The first combined non-static batch reports thirteen passed, three failed,
two skipped (`/tmp/card-game-canvas-combined-live.log`). Mobile actual fullgame
passes all strict pixels, source/corner geometry, observer/room/replay/reconnect
and scroll invariants. Two failed captures exposed protocol ordering issues:
a private-zone screenshot's own scrollIntoView happened after the first scroll
sample, and a desktop late-born ORIGINAL animation changed its transform and
native overflow between captures (not a same-state comparison). Capture
positioning now precedes both modes' measurements. A changed native scroll
field is excused only when independent original art/transform signatures prove
actual native change; bounds/scroll alone cannot trigger that exception.
Targeted corrected receipts are recorded below; original failed logs remain.
The third failure remains genuine headed tiny-art pixel parity under the
unchanged headed viewport setup; no threshold or scale assumption is changed.


## Combined strict matrix and corrected actual-run outcome

The same immutable riZhUk candidate passes the complete six-profile static
matrix: 320x568, 390x844 and 1440x900 in both themes; eleven original phases
plus native hover/focus/raised input states. Six tests pass in 46.6s with all
source/core, 16px overflow and whole-frame thresholds unchanged. Every accepted
capture also preserves exact native scroll fields. Log:
`/tmp/card-game-canvas-combined-static.log`; matching artifact directory retains
paired images, complete metrics, original fingerprints and scroll comparisons.

Corrected private-face positioning passes on both actual profiles:
`/tmp/card-game-canvas-combined-corrected.log` (desktop) and
`/tmp/card-game-canvas-combined-mobile-private.log` (mobile). Immediate redaction,
same native source ID, exact restored framebuffer hash and current native crop
checks remain intact.

Corrected desktop actual fullgame completes ten tricks, replay, shuffled next
hand/admission, socket reconnection and idle cleanup. Accepted pairs preserve
all native scroll fields. Geometry/corners have zero failures across
121927/77457 samples (maximum 0.5px). Exchange pixels pass. One desktop actual
result card remains a strict failure: Club5 surface280, MAE4.668254 with changed
fraction0.025397. Paired Canvas/DOM computed native context before replay shows
exact same BCR (725.7578125,388.65625,28.703125,40.1875), identical native parent
scroll fields, and the reconstructed phase (918.3278125,388.65625).
Both-mode source/ancestor layout/styles and DOM-only original result grid are
retained in `/tmp/card-game-canvas-combined-corrected/`. The unchanged headed
lane remains a separate tiny-art pixel failure in
`/tmp/card-game-canvas-combined-live/`; actual hidden/resume behavior succeeds,
but it is not a parity pass. These two remaining strict failures still block
completion despite passing static/DPR3 matrices and mobile actual gameplay.


## Native headed scale protocol correction (not yet a passing receipt)

An independent review identified the previous headed setup mixing JS DPR1
from Playwright viewport emulation with the host's native Retina layout/raster
scale2. Its failed logs remain failures; they are not relabeled as passing.
The test now reads raw default-window DPR, measured CSS layout quantum and
zoom before metrics emulation, configures CSS1440x900 through CDP using that
actual native DPR, and asserts the same DPR/quantum/root and body CSS zoom/
visualViewport scale after configuration and genuine minimized-window resume.
A dedicated initial/configured/resumed native-configuration receipt is saved.
All hidden-window, backend-progress, native-input, privacy, same-state pixels,
geometry and scroll gates retain their original thresholds. Headless DPR1/2
and independent DPR3 comparisons retain their original profiles. The corrected
headed test is held until the pending native clip/miniature painting fixes are
ready; scale correction alone is not evidence that miniature cards pass.


## Final candidate actual-game and matrix receipts

`/tmp/card-game-canvas-finalcandidate-4kWYi0` was frozen after check0errors/
0warnings and clean build. `freeze-manifest.json` preserves SHA256 for23
pertinent source files and224built assets. Runtime source writes were held;
all original hashes were verified unchanged after the test batch.

All20 entries across390x844-light and1440x900-dark completed with seventeen
passed, one failed and two intentional profile skips:
`/tmp/card-game-canvas-final-two-profiles.log`, matching artifact directory.
BOTH real ordinary-backend fullgames pass every strict phase, actual result,
replay, shuffled next hand/admission, observer privacy, real socket recovery,
native scroll invariant and idle cleanup. Mobile original/Canvas bounds and
independent corners have zero failures across82278/61743 samples; desktop
92746/53566, maximum0.5px. Actual desktop result now has zero failed crops
(whole mean RGB0.017110), repairing the previous full-game tiny-card failure.

The remaining four static profiles pass in31s:
`/tmp/card-game-canvas-final-static-remaining.log`. Together with the two static
profiles in the first batch, all six profiles pass eleven original phases
plus hover/focus/raised controls, source/overflow/whole pixels and native
scroll checks. Independent finalDPR3 eight pairs pass unchanged scripts and
thresholds: `/tmp/card-game-canvas-density-final/metrics.json`. Unit log confirms
31files/759tests pass: `/tmp/card-game-canvas-final-unit.log`. Feedback reports
four focused current-code wake/mirror/scroll tests passing; this is supporting
focused evidence rather than a substitute for actual-game receipts above.

The only remaining strict failure is genuine headed resumed current-trick
BlackJoker surface82,77.2890625x108.2109375px: MAE4.002793460362268 exceeds4,
changed fraction0.040137614678899085 passes. Every native configuration
assertion passes: actual initial/configured/resumed DPR2, layout quantum
0.0078125, CSS root/body zoom1 and visualViewport scale1. Genuine minimized
visibility, backend progress, resume/input/private-hand and all tiny actor/
Mighty-card crops pass. The older mixed-scale failures remain failed historical
receipts; this new correctly configured BlackJoker failure is not rounded or
relabeled as passing. It still blocks completion.

Old failure source SVG markup, all available original/ancestor motion/bounds/
scroll fingerprints, source descriptor, pixels and native configuration are
consolidated in `headed-failed-surface82-existing-context.json` under that
headed artifact directory. Its browser was already closed; unrecorded full
computed styles/offsets/Canvas geometry cannot be reconstructed as observed
facts. A test-only follow-up now captures both-mode full native paint context
before teardown for EVERY failed phase. The original freeze manifest remains;
`harness-diagnostic-followup.json` records this diagnostic-only harness hash
change. No runtime asset changes or random reruns follow from that update.


## Final v2 verification and corrected Misdeal acceptance

Clean check0errors/0warnings and build froze
`/tmp/card-game-canvas-finalcandidate-v2-0rMMB3`. Its freeze manifest preserves
all runtime and initial harness hashes. Both actual ordinary-backend fullgames,
including their real result/replay/new-hand/socket/privacy/native-scroll and
cleanup gates, pass strict pixels. Mobile geometry/corners have zero failures
across75494/54754 samples; desktop95262/54032, maximum0.5px. Genuine native
headed initial/configured/resumed DPR2, quantum0.0078125 and zoom/scale1 pass,
as do actual minimized state, backend progress, resume and all same-state
primitive/overflow/whole pixels. The former headed CJK failure is repaired.

The20-entry first v2 batch reports17passed/1failed/2intentional skips:
`/tmp/card-game-canvas-final-v2-two-profiles.log`. Its one failure is inability
to capture a stable server-authorized Misdeal replacement deal: with explicit
threshold9 rules, automatic bots continually claim new real Misdeals, and
recorded original card IDs/labels/markup change between each pair. This failed
run remains a failed log; it is not relabeled as an all20-test pass.

The corrected acceptance mechanism uses four REAL human clients who join and
ready through ordinary room UI, then remain idle. Only the main human sends
its actual offered Misdeal. Backend rules, server ack/public ten-card hand,
replacement deal and original animation/pixels in both zones remain intact;
no server pause, forced state, fabricated ack, wider thresholds or extra blind
retries are introduced. Focused corrected gate passes8.8s:
`/tmp/card-game-canvas-final-v2-misdeal-controlled.log`, matching artifacts.
Thus all18 required two-profile entries have passing receipts on the same
frozen runtime, with two intentional profile skips, across the original batch
and this focused mechanism correction.

The additional four static profiles pass:
`/tmp/card-game-canvas-final-v2-static-remaining.log` (1.4min). Combined with
two profiles above, all six strict matrices pass all eleven phases and native
hover/focus/raise, source/overflow/whole pixels and native scroll invariants.

An explicit canonical leading SingleJoker regression target also passes:
`/tmp/card-game-canvas-final-v2-leading-single-joker/receipt.json`, log
`/tmp/canvas-final-v2-leading-single-joker.log`, executable
`/tmp/canvas-final-v2-leading-single-joker.cjs`. Exact canonical props are
BlackJoker, fluid width77.2890625, leading true, twoJokers false (both corner
labels 조커), fixed native parent pose410.9765625/336.0625 with original
translation−38.64453125/−54.10546875. It uses actual mounted global CanvasSurface
by changing ONLY that target's renderer scope; it never invokes a painter or
transpiles renderer code. Measured DPR2/layout quantum0.0078125 and all23source
hashes match v2 at capture. Core meanRGB1.521742/changed0.022214; overflow
1.014712/0.013270 pass original limits. This is SOURCE-MATCHED VITE canonical
fixture proof, not frozen-bundle actual-game evidence; the genuine frozen
headed and both fullgame passes above are separate mandatory receipts.

After the participant-only harness correction, all runtime-source and built
asset hashes still match the original freeze. Only the e2e file hash changes;
`harness-controlled-misdeal-followup.json` records that change explicitly.
Historical v1/mixed-scale/unstable-pair failures and their diagnostics remain.
Current v2 unit log confirms31files/759tests passing:
`/tmp/card-game-canvas-final-v2-unit.log`. Independent v2 density/review final receipts are recorded below; they remain
separate evidence from actual gameplay and canonical fixture passes.


## Final independent density/review closure

On the same held v2 0rMMB3 candidate, independent DPR3 verification passes
all eight lobby/exchange/play/done pairs across both themes at unchanged
source/core,16px overflow and whole-frame limits:
`/tmp/card-game-canvas-density-final-v2-stable/metrics.json`. Every per-pair
`*-capture-receipt.json` explicitly records stable=true and nativeUnchanged=true;
all final pairs are accepted on attempt0. These receipts were inspected directly.

The older raw v2 helper output remains an invalid/failed historical receipt:
its Done fake-ready fixture can change next-button state between modes, and
zero-size hidden figure bounds had produced negative crop regions. Bounded
helper corrections exclude zero-size invisible regions and fingerprint actual
native HTML/context. The renderer-owned relative anchor is normalized using
the same canonical cleaning principle as the main e2e harness. A recapture is
allowed only when independently recorded native HTML actually changed; no
expected Canvas value is awaited or used to retry. Final stable receipts above
are separate new evidence, not relabeling the raw failure as passing.

The independent native-original reviewer verified224 frozen built assets and
22 runtime-source SHA256 values against the freeze manifest. The one harness
hash follow-up is explicitly documented; runtime assets stayed held throughout.
All18 required two-profile acceptance entries now have passing receipts on this
same frozen runtime, together with all six static profiles, native DPR2 headed
resume, canonical CJK regression target and the independent DPR3 lane. The
initial v2 batch's unstable automatic-bot Misdeal failure remains preserved;
its corrected real-human-participant gate supplies the acceptance proof.

This ledger is frozen after these final evidence receipts. No runtime writes,
threshold relaxation, deployment or publication follow from this closure.
