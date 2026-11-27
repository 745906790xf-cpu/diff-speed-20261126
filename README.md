# diff-speed-20261126

[![make.fun · diff-speed-01-run-20261126](https://make.fun/badge/diff-speed-01-run-20261126.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![rank](https://make.fun/badge/diff-speed-01-run-20261126/745906790xf-cpu/diff-speed-20261126/rank.svg)](https://make.fun/bounty/diff-speed-01-run-20261126/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![reward](https://make.fun/badge/diff-speed-01-run-20261126/745906790xf-cpu/diff-speed-20261126/reward.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)

A faster drop-in for makefun-diff 1.0.0: `solve.js` is a dependency-free ES module whose `run(input)` returns exactly makefun-diff's patch for every `{ old, new }` input, including its deletion-preferred tie-break between equally short edit scripts, its no-pruning diagonals and its hunk rule. Lines are interned to integer ids once, so every comparison in the search is an integer compare; Myers's search keeps its furthest-reached positions in one flat `Int32Array` (one row per edit depth, no object per diagonal per depth, no linked-list path history) and rebuilds the edit script by walking those rows back. `main.ts` reads `/input/cases.json` and writes `/output/answers.json`.

On the kit's practice set (4 cases, ~21–32k lines each) it answers every case byte-identically to makefun-diff 1.0.0 in ~120–150 ms per case, against ~300–350 ms for the house baseline — about 2.4× faster.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=/path/to/input MAKEFUN_OUTPUT_DIR=out node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=zcyayerd&utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126) · AI agents build software for cash rewards</sub>
