// Fast drop-in for makefun-diff 1.0.0: run(input) returns exactly makefun-diff's
// patch of { old, new }, two texts, as one JSON string, under the rule the house
// baseline's vendor/makefun-diff/index.js states in its header.
//
// Speed: lines are interned to integer ids once (one map for both texts, keyed
// on the split pieces, so every comparison in the search is an integer
// compare); Myers's search keeps its furthest-reached positions in one flat
// Int32Array (one row per edit depth, no object per diagonal per depth, no
// linked-list path history) and rebuilds the edit script by walking those rows
// back; the patch is then written out with the same hunk rule. Nothing is
// cached from one case to the next.

const KEEP = 0;
const DELETE = 1;
const INSERT = 2;

/** The runs of the edit script of the middle slices: [[kind, count], ...], in order. */
function editRuns(aIds, n, bIds, m) {
  // V rows: row d starts at d*d, diagonal k at d*d + (k + d). A row holds the
  // furthest old-line count reached on each diagonal, or S when no path runs
  // there (S fails both validity checks: S >= n, and S - k > m for every k).
  const S = n + m + 1;
  let buf = new Int32Array(1024);
  const ensure = (d) => {
    const need = (d + 1) * (d + 1);
    if (need > buf.length) {
      let nc = buf.length * 2;
      while (nc < need) nc *= 2;
      const nb = new Int32Array(nc);
      nb.set(buf);
      buf = nb;
    }
  };

  // Depth 0: the snake from (0, 0).
  let x = 0;
  let y = 0;
  while (x < n && y < m && aIds[x] === bIds[y]) { x++; y++; }
  buf[0] = x;
  let D = -1;
  let kFinal = 0;
  if (x === n && y === m) {
    D = 0;
  } else {
    const maxEdit = n + m;
    outer: for (let d = 1; d <= maxEdit; d++) {
      ensure(d);
      const base = d * d;
      const prev = (d - 1) * (d - 1);
      // One step on diagonal k: pick the candidate further into the old text,
      // the deletion when both reach one point, then follow the snake.
      // Edge k = -d: only the insertion from (d-1, -d+1) can run.
      {
        const k = -d;
        const xIns = buf[prev];
        if (xIns - k <= m) {
          let nx = xIns;
          let ny = nx - k;
          while (nx < n && ny < m && aIds[nx] === bIds[ny]) { nx++; ny++; }
          buf[base] = nx;
          if (nx === n && ny === m) { D = d; kFinal = k; break outer; }
        } else buf[base] = S;
      }
      // Middle diagonals: both candidates in range; indices step by 2 with k.
      let iw = base + 2;
      let id = prev;
      let ii = prev + 2;
      for (let k = -d + 2; k <= d - 2; k += 2) {
        const xDel = buf[id];
        const xIns = buf[ii];
        const delValid = xDel < n;
        const insValid = xIns - k <= m;
        let nx;
        if (!delValid && !insValid) {
          buf[iw] = S;
        } else {
          nx = (delValid ? xDel : -2) >= (insValid ? xIns - 1 : -2) ? xDel + 1 : xIns;
          let ny = nx - k;
          while (nx < n && ny < m && aIds[nx] === bIds[ny]) { nx++; ny++; }
          buf[iw] = nx;
          if (nx === n && ny === m) { D = d; kFinal = k; break outer; }
        }
        iw += 2;
        id += 2;
        ii += 2;
      }
      // Edge k = d: only the deletion from (d-1, d-1) can run.
      {
        const k = d;
        const xDel = buf[prev + 2 * d - 2];
        if (xDel < n) {
          let nx = xDel + 1;
          let ny = nx - k;
          while (nx < n && ny < m && aIds[nx] === bIds[ny]) { nx++; ny++; }
          buf[base + 2 * d] = nx;
          if (nx === n && ny === m) { D = d; kFinal = k; break outer; }
        } else buf[base + 2 * d] = S;
      }
    }
  }
  if (D < 0) throw new Error('makefun-diff: the search ended without reaching both ends');

  // Walk the rows back from (D, N-M), rebuilding the script in reverse.
  const rev = [];
  let k = kFinal;
  x = n;
  y = m;
  for (let d = D; d >= 1; d--) {
    const prev = (d - 1) * (d - 1);
    const xDel = k >= -d + 2 ? buf[prev + k + d - 2] : S;
    const xIns = k <= d - 2 ? buf[prev + k + d] : S;
    const delValid = xDel < n;
    const insValid = xIns - k <= m;
    if ((delValid ? xDel : -2) >= (insValid ? xIns - 1 : -2)) {
      const keep = x - (xDel + 1);
      if (keep > 0) rev.push([KEEP, keep]);
      rev.push([DELETE, 1]);
      x = xDel;
      y = x - (k - 1);
      k = k - 1;
    } else {
      const keep = x - xIns;
      if (keep > 0) rev.push([KEEP, keep]);
      rev.push([INSERT, 1]);
      x = xIns;
      y = x - (k + 1);
      k = k + 1;
    }
  }
  if (x > 0) rev.push([KEEP, x]);

  // Forward order, merging runs of one kind the snakes left apart.
  const runs = [];
  for (let i = rev.length - 1; i >= 0; i--) {
    const r = rev[i];
    const last = runs[runs.length - 1];
    if (last !== undefined && last[0] === r[0]) last[1] += r[1];
    else runs.push([r[0], r[1]]);
  }
  return runs;
}

/** A line as the patch writes it: its op, the line, a newline, and "%" on a line of its own when it had none. */
function written(op, line) {
  return line.endsWith('\n') ? op + line : op + line + '\n%\n';
}

/** makefun-diff 1.0.0's answer for one case's input. */
export function run(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('makefun-diff: the input is { old, new }, two strings');
  }
  // Split on '\n' only; a line is a piece plus its '\n', except a last piece
  // that is not empty, which is a line with no newline.
  const aParts = input.old.split('\n');
  const bParts = input.new.split('\n');
  const aLast = aParts.length - 1;
  const bLast = bParts.length - 1;
  const n = aParts.length - 1 + (aParts[aLast] !== '' ? 1 : 0);
  const m = bParts.length - 1 + (bParts[bLast] !== '' ? 1 : 0);

  // Intern the pieces once, one map for both texts; a line's id is its piece's
  // id doubled, plus one for a last line with no newline, so equal lines share
  // an id and different lines never do.
  const ids = new Map();
  let nextId = 0;
  const aIds = new Int32Array(n);
  for (let i = 0; i < aLast; i++) {
    const s = aParts[i];
    let id = ids.get(s);
    if (id === undefined) { id = nextId++; ids.set(s, id); }
    aIds[i] = id * 2;
  }
  if (aParts[aLast] !== '') {
    const s = aParts[aLast];
    let id = ids.get(s);
    if (id === undefined) { id = nextId++; ids.set(s, id); }
    aIds[n - 1] = id * 2 + 1;
  }
  const bIds = new Int32Array(m);
  for (let i = 0; i < bLast; i++) {
    const s = bParts[i];
    let id = ids.get(s);
    if (id === undefined) { id = nextId++; ids.set(s, id); }
    bIds[i] = id * 2;
  }
  if (bParts[bLast] !== '') {
    const s = bParts[bLast];
    let id = ids.get(s);
    if (id === undefined) { id = nextId++; ids.set(s, id); }
    bIds[m - 1] = id * 2 + 1;
  }

  // The common prefix, then the common suffix of what is left.
  let prefix = 0;
  while (prefix < n && prefix < m && aIds[prefix] === bIds[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && aIds[n - 1 - suffix] === bIds[m - 1 - suffix]) suffix++;

  const runs = [];
  if (prefix > 0) runs.push([KEEP, prefix]);
  runs.push(...editRuns(aIds.subarray(prefix, n - suffix), n - prefix - suffix, bIds.subarray(prefix, m - suffix), m - prefix - suffix));
  if (suffix > 0) runs.push([KEEP, suffix]);

  // The line at index i of a text, with its "\n" (or none, for a bare last line).
  const lineA = (i) => (i < aLast ? aParts[i] + '\n' : aParts[aLast]);
  const lineB = (i) => (i < bLast ? bParts[i] + '\n' : bParts[bLast]);

  // The change runs: each a stretch of deletions and insertions between two kept lines, at old line o and new line p.
  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  for (const r of runs) {
    if (r[0] === KEEP) {
      o += r[1];
      p += r[1];
      continue;
    }
    let c = changes[changes.length - 1];
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (r[0] === DELETE) {
      c.dels += r[1];
      o += r[1];
      deleted += r[1];
    } else {
      c.ins += r[1];
      p += r[1];
      inserted += r[1];
    }
  }

  // The hunks: change runs at most 2 * 3 kept lines apart share one.
  const hunks = [];
  for (const c of changes) {
    const h = hunks[hunks.length - 1];
    const prev = h !== undefined ? h[h.length - 1] : undefined;
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 6) h.push(c);
    else hunks.push([c]);
  }
  const out = [`makefun-diff/1 old=${n} new=${m} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  for (const h of hunks) {
    const first = h[0];
    const last = h[h.length - 1];
    const oldStart = Math.max(0, first.o - 3);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(3, n - (last.o + last.dels));
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);
    let at = oldStart;
    for (const c of h) {
      for (; at < c.o; at++) out.push(written('=', lineA(at)));
      for (let i = 0; i < c.dels; i++) out.push(written('-', lineA(c.o + i)));
      for (let i = 0; i < c.ins; i++) out.push(written('+', lineB(c.p + i)));
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) out.push(written('=', lineA(at)));
  }
  return out.join('');
}
