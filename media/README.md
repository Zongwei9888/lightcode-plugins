# TokenWise media kit

Everything here is rendered from the HTML in [`src/`](src) by headless Chromium, so any of it can be
changed and rebuilt. The "after" text and its numbers come from TokenWise itself: `src/gen-data.mts` runs the sample
pytest log through the real filter (260 lines → 17, 19.0 KB → 852 bytes).

## Files

| File | Size | Use it for |
|---|---|---|
| `images/social-preview.png` | 1280×640 | GitHub → Settings → Social preview; link cards on X, LinkedIn, Slack |
| `images/social-preview-zh.png` | 1280×640 | the same, Chinese (WeChat, Zhihu, Juejin, V2EX) |
| `images/banner.png`, `banner-zh.png` | 3200×1120 | top of a README, a blog post or a launch page |
| `images/card-read-less.png` | 2400×1350 | one post per idea: compact tool output |
| `images/card-lose-nothing.png` | 2400×1350 | compaction that keeps what it drops |
| `images/card-get-better.png` | 2400×1350 | filters learned from your own tools |
| `images/card-*-zh.png` | 2400×1350 | the three cards in Chinese |
| `images/before-after.png`, `-zh` | 3200×1800 | the one-image explanation: same run, 17 lines instead of 260 |
| `images/diagram-overview.png`, `-zh` | 2400 wide | the README's overview: three ideas, one product |
| `images/diagram-compaction.png`, `-zh` | 2400 wide | compaction: a long session, the checkpoint, a recall |
| `images/diagram-learning.png`, `-zh` | 2400 wide | one learning run, step by step |
| `video/tokenwise-en.mp4`, `-zh.mp4` | 1920×1080, 53 s | the explainer: launch posts, the repository, talks |
| `video/fold.gif` | 960 wide, 8 s | the fold, looping: README and chat where video does not play |

The 16:9 cards and charts are rendered at 2× for sharp text on any screen.

## Rebuild

Needs Node 22, ffmpeg, and the Chromium that `pnpm e2e` installs (Playwright's cache).

```sh
cd media/src
node --conditions=source gen-data.mts   # real filter output for the sample run
node render.mjs stills                  # every image (or: node render.mjs stills card-)
node render.mjs video en                # and: node render.mjs video zh
node render.mjs frames en 9,24,40       # preview single moments of the video
```

## Look

| Token | Value | Role |
|---|---|---|
| Paper | `#EEF3F1` | ground |
| Ink | `#0E2A26` | text |
| Teal | `#0F766E` | brand |
| Mint | `#CCFBF1` | tint, notes in terminals |
| Terminal | `#0B3B36` | terminal ground |
| Kept | `#F2B705` | evidence that stays (the logo's bolt); only ever used for that |

Type: [Archivo](https://fonts.google.com/specimen/Archivo) for headlines, set narrow (width 64%): the
type is compressed the way the output is. [JetBrains Mono](https://www.jetbrains.com/lp/mono/) for
terminal text, with ligatures off so code reads as typed. Both are under the SIL Open Font License
(`src/fonts/`). The one motif is the fold: rows of output squeezing into a seam, with only the
evidence lit below it.
