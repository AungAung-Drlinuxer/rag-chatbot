# Composer "＋" — three takes

Disposable sketches exploring what the `+` in the composer should open. The reference was a
ChatGPT-style Options sheet (Image / Camera / File / Connectors). Question asked: **can the
app look like that, and should it?**

Open a variant:

```
start sketches/002-composer-options/a-tile-sheet/index.html
start sketches/002-composer-options/b-action-list/index.html
start sketches/002-composer-options/c-inline-expand/index.html
```

## Head-to-head

| | **A · tile sheet** | **B · action list** | **C · inline expand** |
|---|---|---|---|
| Stance | Faithful to the reference | One labelled line per action | No sheet at all |
| Opens | Bottom sheet + scrim | Bottom sheet + scrim | Inside the composer |
| Covers the thread | Yes | Yes | **No** |
| Covers the input box | **Yes** | **Yes** | No — actions sit above it |
| Actions visible | 4 tiles + 2 rows | 4 rows + 3 recents | 3 pills, expandable |
| Tap cost to attach | 2 (＋, tile) | 2 (＋, row) | 2 (＋, pill) |
| Tap cost to change the connector scope | 2 | 2 | 1 (＋; chips are one more) |
| Vertical space used | ~52% of the screen | ~44% | grows upward as needed |
| Reachable one-handed | bottom half ✅ | bottom half ✅ | bottom half ✅ |
| Room for a 5th action | no (grid is 2×2) | yes (a row each) | yes (pills wrap) |
| Matches the rest of the app | partially (no sheet anywhere else) | partially | ✅ (the composer already grows) |

Measured at 390×760: none overflow (`scrollWidth == clientWidth` in all three), and in C the
connector chips land at y ≤ 686 while the input box starts at 727 — so the input is never
occluded. A and B both hide the input box behind the sheet, which is the one hard rule this
app already broke once:

> "floating widgets must never occlude inputs"

## My take

**C is the right default, and A is the wrong one to copy.**

**Why not A.** The tile grid spends half the screen and two taps to present four words. It is
built for a consumer chat app where the actions are equally weighted and rarely used. Here
one action dominates (attach evidence: a screenshot or a log), one is a *setting* rather than
an attachment (Connectors), and the app is driven from a phone — where a modal sheet plus a
scrim means the user loses sight of the question they are answering.

**Why C.** It is the only variant that keeps the input and the actions on screen at once, it
reuses the pattern the composer already has (it grows — that is how the scope pill and the
answer-source pill already work), and it costs exactly the same number of taps for the
common case. It also degrades honestly: no scrim to dismiss, no focus trap, nothing to get
stuck behind.

**What C is worse at.** Discoverability — a bottom sheet announces itself, an inline drawer
can be missed. And it has no natural home for the extras A and B carry (Camera, Answer
depth, Recents). If those are wanted, C needs a second row that makes the composer tall,
which is the real trade-off to decide.

**Where B fits.** B is the better *sheet*, if a sheet is wanted: one line per action is
faster to scan than a tile grid, it scales to five actions, and the `All · 4` badge on the
Connectors row surfaces the scope without a separate control. B is the compromise — it keeps
the sheet that the reference had but pays for its vertical space only when open.

**Recommendation.** Ship C. Keep B's row copy for the eventual Settings/Connectors page (the
one-line descriptions are good). Do not build A.

## What is NOT in these sketches, deliberately

- Camera and Image as separate actions: on the web they are the same `accept="image/*"`
  file input, and the OS picker already offers "Take photo". Two tiles for one code path is
  a lie about what the app can do.
- "Deep research": a different product surface, and it would contradict the
  documents-vs-live-infrastructure distinction the evidence card is built around.
- Voice input: no speech stack in the app today, and Burmese IT terms through ASR is a
  separate accuracy problem, not a UI problem.

## Disposable

These are throwaways. Whichever stance wins should be built as a real component
(`features/chat/components/`), not curated from here.