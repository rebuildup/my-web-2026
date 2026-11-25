// Proto v3: geometry-corrected Band1/Band2, dark+light+mobile variants.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const OUT = '.tmp/profile-proto';
mkdirSync(OUT, { recursive: true });
const payload = JSON.parse(JSON.parse(readFileSync('/tmp/gh-activity.json', 'utf8'))[0].results[0].payload);
const presence = JSON.parse(JSON.parse(readFileSync('/tmp/discord-presence.json', 'utf8'))[0].results[0].payload);

const STREAK = 204;
const LANGS = [
  ['TypeScript', 45.79, '#3178c6'], ['C#', 40.89, '#178600'], ['C++', 7.94, '#f34b7d'],
  ['HTML', 2.54, '#e34c26'], ['Python', 1.72, '#3572A5'], ['SCSS', 1.11, '#c6538c'],
];
const FONT = "-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,'SF Mono',Menlo,monospace";
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const THEMES = {
  dark: { bg: '#0d1117', panel: '#161b22', panel2: '#232b38', stroke: '#2d333f', fg: '#e6edf3', muted: '#bcc6d4', faint: '#9aa7b8', grid: '#21262d' },
  light: { bg: '#ffffff', panel: '#f6f8fa', panel2: '#eaeef2', stroke: '#d1d9e0', fg: '#1f2328', muted: '#59636e', faint: '#818b98', grid: '#d1d9e0' },
};
const SEM = { accent: '#58a6ff', accentL: '#0969da', green: '#3fb950', greenL: '#1a7f37', purple: '#bc8cff', purpleL: '#8250df', orange: '#d29922', orangeL: '#9a6700', red: '#f85149', redL: '#cf222e', pink: '#f778ba', pinkL: '#bf3989' };

const data = {
  repos: payload.repos.filter((r) => r.activity.commits + r.activity.prs + r.activity.events > 0)
    .sort((a, b) => b.activity.commits - a.activity.commits),
  feed: payload.feed.slice().sort((a, b) => b.at.localeCompare(a.at)),
};
const RENDER_NOW = Date.parse('2026-11-24T14:00:00Z');
const JST = (iso) => {
  const d = new Date(Date.parse(iso) + 9 * 3600e3);
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};
const feed72 = data.feed.filter((e) => RENDER_NOW - Date.parse(e.at) < 72 * 3600e3);
const TYPE_COLOR = { PushEvent: 'accent', PullRequestEvent: 'purple', IssuesEvent: 'green', IssueCommentEvent: 'green', PullRequestReviewEvent: 'purple', CreateEvent: 'orange', DeleteEvent: 'red', WatchEvent: 'pink', ForkEvent: 'pink', ReleaseEvent: 'orange' };
const TYPE_LABEL = { PushEvent: 'push', PullRequestEvent: 'PR', IssuesEvent: 'issue', IssueCommentEvent: 'comment', PullRequestReviewEvent: 'review', CreateEvent: 'create', DeleteEvent: 'delete', WatchEvent: 'star', ForkEvent: 'fork', ReleaseEvent: 'release' };

const flame = (cx, cy, s, color, inner) => `<g>
  <path d="M${cx} ${cy - s * 1.1} C ${cx + s * 0.7} ${cy - s * 0.5} ${cx + s * 0.55} ${cy + s * 0.1} ${cx + s * 0.15} ${cy + s * 0.55} C ${cx} ${cy + s * 0.8} ${cx - s * 0.35} ${cy + s * 0.75} ${cx - s * 0.55} ${cy + s * 0.4} C ${cx - s * 0.85} ${cy} ${cx - s * 0.6} ${cy - s * 0.7} ${cx} ${cy - s * 1.1} Z" fill="${color}"/>
  <path d="M${cx} ${cy + s * 0.15} C ${cx + s * 0.35} ${cy + s * 0.35} ${cx + s * 0.2} ${cy + s * 0.6} ${cx} ${cy + s * 0.75} C ${cx - s * 0.25} ${cy + s * 0.6} ${cx - s * 0.2} ${cy + s * 0.35} ${cx} ${cy + s * 0.15} Z" fill="${inner}"/>
</g>`;
const GLYPHS = {
  web: `<g fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11"/></g>`,
  agent: `<g fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="3.5" r="1.6"/><circle cx="12" cy="20.5" r="1.6"/><circle cx="3.5" cy="12" r="1.6"/><circle cx="20.5" cy="12" r="1.6"/><path d="M12 5.5v3.5M12 15v3.5M5.5 12H9M15 12h3.5"/></g>`,
  cal: `<g fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><circle cx="8.5" cy="14.5" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="14.5" r="1.4" fill="currentColor" stroke="none"/><circle cx="15.5" cy="14.5" r="1.4" fill="currentColor" stroke="none"/><circle cx="8.5" cy="18" r="1.4" fill="currentColor" stroke="none"/></g>`,
  pen: `<g fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14.5 4.5l5 5L8 21H3v-5L14.5 4.5z"/><path d="M12 7l5 5"/></g>`,
};
const FOCUS = [
  { name: 'my-web-2026', note: 'personal web platform', glyph: 'web', level: 'primary', x: 130, r: 38, c: 'accent' },
  { name: 'AI coding agent', note: 'agent workflows', glyph: 'agent', level: 'active', x: 360, r: 30, c: 'purple' },
  { name: 'Tastile', note: 'scheduling product', glyph: 'cal', level: 'side', x: 565, r: 25, c: 'green' },
  { name: 'After Effects', note: 'AE tools', glyph: 'pen', level: 'side', x: 720, r: 25, c: 'orange' },
];

// ================= BAND 1 (800x360) =================
function band1(theme) {
  const T = THEMES[theme];
  const W = 800, H = 360;
  const isDark = theme === 'dark';
  const sem = (k) => (isDark ? SEM[k] : SEM[k + 'L'] || SEM[k]);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">`;
  s += `<rect width="${W}" height="${H}" fill="${T.bg}"/>`;

  // identity header
  s += `<rect x="24" y="20" width="62" height="62" rx="13" fill="${T.panel2}" stroke="${sem('accent')}" stroke-width="2"/>`;
  s += `<text x="55" y="67" font-size="29" font-weight="800" fill="${sem('accent')}" text-anchor="middle">r</text>`;
  s += `<text x="102" y="48" font-size="21" font-weight="800" fill="${T.fg}">rebuildup</text>`;
  s += `<text x="102" y="71" font-size="11.5" fill="${T.muted}">design × code × motion — After Effects tools, web apps, video</text>`;
  const pStatus = presence.status === 'online' ? 'green' : 'orange';
  s += `<circle cx="102" cy="88" r="4.5" fill="${sem(pStatus)}"/>`;
  s += `<text x="113" y="92" font-size="10.5" fill="${T.muted}">${esc(presence.status)} on Discord</text>`;
  s += `<text x="${W - 24}" y="38" text-anchor="end" font-size="10" fill="${T.faint}">observed Nov 24 · 23:00 JST</text>`;
  s += `<line x1="24" y1="100" x2="${W - 24}" y2="100" stroke="${T.stroke}"/>`;

  // vitals: 4 cells y=112 h=82
  const vy = 112, vh = 82, cw = (W - 48 - 36) / 4; // 179
  for (let i = 0; i < 4; i++) s += `<rect x="${24 + i * (cw + 12)}" y="${vy}" width="${cw}" height="${vh}" rx="9" fill="${T.panel}" stroke="${T.stroke}"/>`;
  // 1 streak: flame left, number right
  {
    const x = 24;
    s += flame(x + 30, vy + 40, 13, sem('orange'), '#ffd77a');
    s += `<text x="${x + 52}" y="${vy + 50}" font-size="27" font-weight="800" fill="${T.fg}">${STREAK}</text>`;
    s += `<text x="${x + cw / 2}" y="${vy + 72}" font-size="10" fill="${T.muted}" text-anchor="middle">day streak</text>`;
  }
  // 2 top lang
  {
    const x = 24 + cw + 12;
    s += `<text x="${x + 14}" y="${vy + 20}" font-size="9.5" fill="${T.muted}">TOP LANGUAGE</text>`;
    let acc = 0; const bw = cw - 28;
    LANGS.forEach(([n, p, c]) => { const w = bw * (p / 100); s += `<rect x="${x + 14 + acc}" y="${vy + 30}" width="${w}" height="12" fill="${c}"/>`; acc += w; });
    s += `<text x="${x + 14}" y="${vy + 60}" font-size="12.5" font-weight="700" fill="${T.fg}">TypeScript</text>`;
    s += `<text x="${x + cw - 14}" y="${vy + 60}" font-size="10.5" fill="${T.muted}" text-anchor="end">45.8%</text>`;
    let dswx = x + 14;
    const dswy = vy + 73;
    LANGS.slice(1, 3).forEach(([n, p, c]) => {
      s += `<rect x="${dswx}" y="${dswy - 6}" width="6" height="6" fill="${c}"/>`;
      s += `<text x="${dswx + 9}" y="${dswy}" font-size="9" fill="${T.muted}">${n} ${(p).toFixed(1)}</text>`;
      dswx += 9 + n.length * 5.4 + 24;
    });
    s += `<text x="${dswx + 2}" y="${dswy}" font-size="9" fill="${T.faint}">+${LANGS.length - 3} more</text>`;
  }
  // 3 contributed-to: 27 dots exact, label below grid
  {
    const x = 24 + 2 * (cw + 12);
    s += `<text x="${x + 14}" y="${vy + 20}" font-size="9.5" fill="${T.muted}">CONTRIBUTED TO · 27 REPOS</text>`;
    for (let i = 0; i < 27; i++) {
      const dx = x + 16 + (i % 7) * 15, dy = vy + 34 + Math.floor(i / 7) * 11.5;
      s += `<circle cx="${dx}" cy="${dy}" r="4.2" fill="${sem('accent')}" opacity="${i < 24 ? 0.85 : 0.3}"/>`;
      s += `<circle cx="${dx}" cy="${dy}" r="4.2" fill="none" stroke="${T.stroke}"/>`;
    }
  }
  // 4 rank: circle left, B+ inside, caption right of circle
  {
    const x = 24 + 3 * (cw + 12);
    s += `<text x="${x + 14}" y="${vy + 20}" font-size="9.5" fill="${T.muted}">GITHUB RANK</text>`;
    const cx = x + 30, cy = vy + 52, r = 19;
    s += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${T.panel2}" stroke-width="7"/>`;
    const a0 = -Math.PI / 2, a1 = a0 + Math.PI * 2 * 0.68;
    const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    s += `<path d="M ${x0} ${y0} A ${r} ${r} 0 1 1 ${x1} ${y1}" fill="none" stroke="${sem('accent')}" stroke-width="7" stroke-linecap="round"/>`;
    s += `<text x="${cx}" y="${cy + 4.5}" font-size="13" font-weight="800" fill="${T.fg}" text-anchor="middle">B+</text>`;
    s += `<text x="${cx + 26}" y="${cy - 2}" font-size="10" fill="${T.muted}">of A+</text>`;
    s += `<text x="${cx + 26}" y="${cy + 12}" font-size="9" fill="${T.faint}">tier</text>`;
  }

  // focus: label + 4 nodes same baseline cy=272, labels aligned
  const fy = 214;
  s += `<text x="24" y="${fy - 6}" font-size="10" font-weight="700" fill="${T.muted}" letter-spacing="1.4">IN PROGRESS · DECLARED FOCUS</text>`;
  s += `<text x="${W - 24}" y="${fy - 6}" text-anchor="end" font-size="9" fill="${T.faint}">▮▮▮ primary · ▮▮ active · ▮ side</text>`;
  const cy = 262;
  FOCUS.forEach((n) => {
    const colr = sem(n.c);
    s += `<circle cx="${n.x}" cy="${cy}" r="${n.r}" fill="${T.panel2}" stroke="${colr}" stroke-width="${n.level === 'primary' ? 3 : 1.8}"/>`;
    if (n.level !== 'side') s += `<circle cx="${n.x}" cy="${cy}" r="${n.r + 6}" fill="none" stroke="${colr}" stroke-width="1" opacity="0.4"/>`;
    const gs = n.r * 1.15;
    s += `<svg x="${n.x - gs / 2}" y="${cy - gs / 2}" width="${gs}" height="${gs}" viewBox="0 0 24 24" color="${colr}">${GLYPHS[n.glyph]}</svg>`;
    // name + note centered under circle
    const nameY = cy + n.r + 15;
    const noteY = n.level === 'primary' ? 330 : cy + n.r + 27;
    s += `<text x="${n.x}" y="${nameY}" font-size="${n.level === 'primary' ? 12.5 : 11}" font-weight="700" fill="${T.fg}" text-anchor="middle">${esc(n.name)}</text>`;
    s += `<text x="${n.x}" y="${noteY}" font-size="9" fill="${T.muted}" text-anchor="middle">${esc(n.note)}</text>`;
    // weight segments fixed y=340
    const segs = n.level === 'primary' ? 3 : n.level === 'active' ? 2 : 1;
    const bwid = 48, sx = n.x - bwid / 2;
    for (let i = 0; i < 3; i++) {
      s += `<rect x="${sx + i * (bwid / 3 + 2)}" y="344" width="${bwid / 3 - 2}" height="4" rx="2" fill="${i < segs ? colr : T.stroke}"/>`;
    }
  });
  s += `</svg>`;
  return s;
}

// ================= BAND 2 (800x340) =================
function band2(theme) {
  const T = THEMES[theme];
  const W = 800, H = 340;
  const isDark = theme === 'dark';
  const sem = (k) => (isDark ? SEM[k] : SEM[k + 'L'] || SEM[k]);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">`;
  s += `<rect width="${W}" height="${H}" fill="${T.bg}"/>`;
  s += `<text x="24" y="30" font-size="13" font-weight="700" fill="${T.fg}">GitHub activity</text>`;
  s += `<text x="${W - 24}" y="30" text-anchor="end" font-size="10" fill="${T.faint}">30-day window · observed Nov 24 · 23:00 JST</text>`;

  // LEFT: repo output — bounded isotype, fixed units, no bleed
  const lx = 24, nameW = 140, dotX = lx + nameW + 10, dotStep = 8.5, maxDots = 18;
  const countsX = 464;
  const rx = 476, rw = W - 24 - rx;
  s += `<text x="${lx}" y="54" font-size="10" font-weight="700" fill="${T.muted}" letter-spacing="1.2">REPO OUTPUT · 30D</text>`;
  s += `<text x="${countsX - 6}" y="54" text-anchor="end" font-size="9" fill="${T.faint}">● commits · ■ PRs · scaled</text>`;
  const COMMIT_UNIT = 50, PR_UNIT = 25;
  const pubAll = data.repos.filter((r) => r.kind === 'public');
  const pub = pubAll.slice(0, 8);
  const rest = pubAll.slice(8);
  const rows = [
    ...pub.map((r) => ({ name: r.name.replace('rebuildup/', ''), c: r.activity.commits, p: r.activity.prs, dim: false })),
    { name: `+${rest.length} more public`, c: rest.reduce((a, r) => a + r.activity.commits, 0), p: rest.reduce((a, r) => a + r.activity.prs, 0), dim: true },
    { name: 'private repos · sum', c: data.repos.filter((r) => r.kind !== 'public').reduce((a, r) => a + r.activity.commits, 0), p: data.repos.filter((r) => r.kind !== 'public').reduce((a, r) => a + r.activity.prs, 0), dim: true },
  ];
  const ly = 66, rowH = 23;
  rows.forEach((r, i) => {
    const y = ly + i * rowH;
    const op = r.dim ? 0.72 : 1;
    s += `<text x="${lx}" y="${y + 12}" font-size="10" fill="${r.dim ? T.muted : T.fg}" font-family="${MONO}" opacity="${op}">${esc(r.name.slice(0, 20))}</text>`;
    const nd = Math.min(maxDots, Math.floor(r.c / COMMIT_UNIT));
    for (let d = 0; d < nd; d++) {
      const frac = (d + 1) / nd;
      s += `<circle cx="${dotX + d * dotStep}" cy="${y + 4}" r="3.2" fill="${sem('accent')}" opacity="${(0.3 + 0.7 * frac) * op}"/>`;
    }
    const prX = dotX + maxDots * dotStep + 10;
    const np = Math.min(4, Math.floor(r.p / PR_UNIT));
    for (let p = 0; p < np; p++) {
      s += `<rect x="${prX + p * 9}" y="${y}" width="6" height="6" fill="${sem('purple')}" opacity="${0.85 * op}"/>`;
    }
    const cLabel = r.c >= 1000 ? (r.c / 1000).toFixed(1) + 'k' : String(r.c);
    s += `<text x="${countsX}" y="${y + 12}" text-anchor="end" font-size="9.5" font-family="${MONO}" fill="${T.faint}" opacity="${op}">${cLabel}c ${r.p}p</text>`;
  });
  const leftBottom = ly + rows.length * rowH + 8;
  s += `<line x1="${lx}" y1="${leftBottom}" x2="${countsX}" y2="${leftBottom}" stroke="${T.stroke}"/>`;

  // RIGHT: 72h pulse — now=right, -72h=left
  s += `<text x="${rx}" y="54" font-size="10" font-weight="700" fill="${T.muted}" letter-spacing="1.2">LAST 72 HOURS</text>`;
  const py = 66, ph = 118;
  const t2x = (t) => rx + 10 + (1 - (RENDER_NOW - Date.parse(t)) / (72 * 3600e3)) * (rw - 20);
  s += `<rect x="${rx}" y="${py}" width="${rw}" height="${ph}" rx="8" fill="${T.panel}" stroke="${T.stroke}"/>`;
  const baseY = py + ph - 30;
  s += `<line x1="${rx + 10}" y1="${baseY}" x2="${rx + rw - 10}" y2="${baseY}" stroke="${T.stroke}"/>`;
  for (let h = 72; h >= 0; h -= 24) {
    const x = rx + 10 + (1 - h / 72) * (rw - 20);
    s += `<line x1="${x}" y1="${baseY - 5}" x2="${x}" y2="${baseY + 5}" stroke="${T.faint}"/>`;
    s += `<text x="${x}" y="${py + ph - 10}" font-size="8.5" fill="${T.faint}" text-anchor="middle">${h === 0 ? 'now' : `-${h}h`}</text>`;
  }
  // distinct shapes per type: push=circle, PR=diamond, create=triangle, delete=x-mark
  const SHAPE = {
    PushEvent: (x, y, c) => `<circle cx="${x}" cy="${y}" r="3.8" fill="${c}"/>`,
    PullRequestEvent: (x, y, c) => `<rect x="${x - 3}" y="${y - 3}" width="6.5" height="6.5" rx="1.5" fill="${c}" transform="rotate(45 ${x} ${y})"/>`,
    CreateEvent: (x, y, c) => `<path d="M${x} ${y - 4} L${x + 3.6} ${y + 2.6} L${x - 3.6} ${y + 2.6} Z" fill="${c}"/>`,
    DeleteEvent: (x, y, c) => `<path d="M${x - 3} ${y - 3} L${x + 3} ${y + 3} M${x + 3} ${y - 3} L${x - 3} ${y + 3}" stroke="${c}" stroke-width="1.8"/>`,
  };
  const DEF = (x, y, c) => `<rect x="${x - 3}" y="${y - 3}" width="6" height="6" rx="1.4" fill="${c}"/>`;
  feed72.forEach((e, i) => {
    const x = t2x(e.at);
    const c = sem(TYPE_COLOR[e.type] || 'accent');
    const yy = py + 32 + ((i * 17) % (ph - 62));
    s += (SHAPE[e.type] || DEF)(x, yy, c);
  });
  // legend row inside panel top
  const lg = [['PushEvent', 'push'], ['PullRequestEvent', 'PR'], ['CreateEvent', 'new'], ['DeleteEvent', 'del']];
  let lxg = rx + 10;
  lg.forEach(([t, label]) => {
    const yy = py + 12;
    s += (SHAPE[t] || DEF)(lxg + 4, yy, sem(TYPE_COLOR[t]));
    s += `<text x="${lxg + 14}" y="${yy + 3.5}" font-size="9" fill="${T.muted}">${label}</text>`;
    lxg += 14 + label.length * 5.5 + 12;
  });
  // recent events top-3 with JST times
  feed72.slice(0, 3).forEach((e, i) => {
    const y = py + ph + 22 + i * 20;
    s += `<rect x="${rx + 4}" y="${y - 6}" width="7" height="7" rx="1.5" fill="${sem(TYPE_COLOR[e.type] || 'accent')}" transform="rotate(45 ${rx + 7.5} ${y - 2.5})"/>`;
    const repo = e.repoId.split('/').pop();
    s += `<text x="${rx + 18}" y="${y}" font-size="10.5" fill="${T.fg}"><tspan font-weight="600" font-family="${MONO}">${esc(repo)}</tspan> <tspan fill="${T.muted}">${TYPE_LABEL[e.type] || e.type} · ${JST(e.at)} JST</tspan></text>`;
  });
  s += `<text x="${W - 24}" y="${py + ph + 22 + 2 * 20 + 12}" text-anchor="end" font-size="9" fill="${T.faint}">${feed72.length} public events · times JST</text>`;
  s += `</svg>`;
  return s;
}

// ================= MOBILE variants (560w) =================
function band1Mob(theme) {
  const T = THEMES[theme];
  const W = 560, H = 520;
  const isDark = theme === 'dark';
  const sem = (k) => (isDark ? SEM[k] : SEM[k + 'L'] || SEM[k]);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">`;
  s += `<rect width="${W}" height="${H}" fill="${T.bg}"/>`;
  // identity compact
  s += `<rect x="20" y="18" width="52" height="52" rx="11" fill="${T.panel2}" stroke="${sem('accent')}" stroke-width="2"/>`;
  s += `<text x="46" y="58" font-size="24" font-weight="800" fill="${sem('accent')}" text-anchor="middle">r</text>`;
  s += `<text x="84" y="42" font-size="18" font-weight="800" fill="${T.fg}">rebuildup</text>`;
  s += `<text x="84" y="62" font-size="10.5" fill="${T.muted}">design × code × motion</text>`;
  s += `<circle cx="84" cy="76" r="4" fill="${sem('green')}"/>`;
  s += `<text x="94" y="80" font-size="9.5" fill="${T.muted}">online · Discord</text>`;
  s += `<text x="${W - 16}" y="34" text-anchor="end" font-size="9" fill="${T.faint}">Nov 24 · 23:00 JST</text>`;
  s += `<line x1="20" y1="88" x2="${W - 20}" y2="88" stroke="${T.stroke}"/>`;
  // vitals 2x2
  const cw = (W - 40 - 10) / 2, ch = 74, vy = 100;
  const cells = [
    { x: 20, y: vy }, { x: 20 + cw + 10, y: vy }, { x: 20, y: vy + ch + 10 }, { x: 20 + cw + 10, y: vy + ch + 10 },
  ];
  cells.forEach((c) => s += `<rect x="${c.x}" y="${c.y}" width="${cw}" height="${ch}" rx="8" fill="${T.panel}" stroke="${T.stroke}"/>`);
  // streak
  s += flame(cells[0].x + 24, cells[0].y + 34, 11, sem('orange'), '#ffd77a');
  s += `<text x="${cells[0].x + 42}" y="${cells[0].y + 42}" font-size="22" font-weight="800" fill="${T.fg}">${STREAK}</text>`;
  s += `<text x="${cells[0].x + cw / 2}" y="${cells[0].y + 62}" font-size="9.5" fill="${T.muted}" text-anchor="middle">day streak</text>`;
  // langs
  s += `<text x="${cells[1].x + 12}" y="${cells[1].y + 20}" font-size="9" fill="${T.muted}">TOP LANG</text>`;
  let acc = 0; const bw = cw - 24;
  LANGS.forEach(([n, p, c]) => { const w = bw * (p / 100); s += `<rect x="${cells[1].x + 12 + acc}" y="${cells[1].y + 30}" width="${w}" height="10" fill="${c}"/>`; acc += w; });
  s += `<text x="${cells[1].x + 12}" y="${cells[1].y + 56}" font-size="11" font-weight="700" fill="${T.fg}">TypeScript</text>`;
  s += `<text x="${cells[1].x + cw - 12}" y="${cells[1].y + 56}" font-size="9.5" fill="${T.muted}" text-anchor="end">45.8%</text>`;
  let mswx = cells[1].x + 12;
  const mswy = cells[1].y + 68;
  LANGS.slice(1, 3).forEach(([n, p, c]) => {
    s += `<rect x="${mswx}" y="${mswy - 5}" width="5" height="5" fill="${c}"/>`;
    s += `<text x="${mswx + 8}" y="${mswy}" font-size="8" fill="${T.faint}">${n} ${(p).toFixed(1)}</text>`;
    mswx += 8 + n.length * 4.8 + 20;
  });
  s += `<text x="${mswx + 2}" y="${mswy}" font-size="8" fill="${T.faint}">+${LANGS.length - 3}</text>`;
  // contributed: 27 dots smaller grid 9x3
  s += `<text x="${cells[2].x + 12}" y="${cells[2].y + 20}" font-size="9" fill="${T.muted}">CONTRIBUTED · 1Y</text>`;
  for (let i = 0; i < 27; i++) {
    const dx = cells[2].x + 12 + (i % 9) * 12, dy = cells[2].y + 36 + Math.floor(i / 9) * 11;
    s += `<circle cx="${dx}" cy="${dy}" r="3.6" fill="${sem('accent')}" opacity="${i < 24 ? 0.85 : 0.3}"/>`;
  }
  s += `<text x="${cells[2].x + cw - 12}" y="${cells[2].y + 62}" font-size="10" fill="${T.faint}" text-anchor="end">27</text>`;
  // rank
  s += `<text x="${cells[3].x + 12}" y="${cells[3].y + 20}" font-size="9" fill="${T.muted}">RANK</text>`;
  const rcx = cells[3].x + 30, rcy = cells[3].y + 44, rr = 16;
  s += `<circle cx="${rcx}" cy="${rcy}" r="${rr}" fill="none" stroke="${T.panel2}" stroke-width="6"/>`;
  const a0 = -Math.PI / 2, a1 = a0 + Math.PI * 2 * 0.68;
  s += `<path d="M ${rcx + rr * Math.cos(a0)} ${rcy + rr * Math.sin(a0)} A ${rr} ${rr} 0 1 1 ${rcx + rr * Math.cos(a1)} ${rcy + rr * Math.sin(a1)}" fill="none" stroke="${sem('accent')}" stroke-width="6" stroke-linecap="round"/>`;
  s += `<text x="${rcx}" y="${rcy + 4}" font-size="11" font-weight="800" fill="${T.fg}" text-anchor="middle">B+</text>`;
  s += `<text x="${cells[3].x + 52}" y="${rcy + 3.5}" font-size="8.5" fill="${T.faint}">of A+ tier</text>`;
  // focus rows
  const fy = 272;
  s += `<text x="20" y="${fy - 8}" font-size="10" font-weight="700" fill="${T.muted}" letter-spacing="1.2">IN PROGRESS</text>`;
  FOCUS.forEach((n, i) => {
    const y = fy + i * 52;
    const colr = sem(n.c);
    const r = n.level === 'primary' ? 20 : n.level === 'active' ? 17 : 14;
    s += `<circle cx="${20 + r}" cy="${y + r}" r="${r}" fill="${T.panel2}" stroke="${colr}" stroke-width="${n.level === 'primary' ? 2.6 : 1.6}"/>`;
    const gs = r * 1.1;
    s += `<svg x="${20 + r - gs / 2}" y="${y + r - gs / 2}" width="${gs}" height="${gs}" viewBox="0 0 24 24" color="${colr}">${GLYPHS[n.glyph]}</svg>`;
    s += `<text x="${20 + r * 2 + 14}" y="${y + r + 2}" font-size="12" font-weight="700" fill="${T.fg}">${esc(n.name)}</text>`;
    s += `<text x="${20 + r * 2 + 14}" y="${y + r + 18}" font-size="9.5" fill="${T.muted}">${esc(n.note)}</text>`;
    const segs = n.level === 'primary' ? 3 : n.level === 'active' ? 2 : 1;
    for (let g = 0; g < 3; g++) {
      s += `<rect x="${20 + r * 2 + 14 + g * 13}" y="${y + r * 2 + 8}" width="10" height="4" rx="2" fill="${g < segs ? colr : T.stroke}"/>`;
    }
  });
  s += `<text x="${W - 16}" y="${fy + 3 * 52 + 30}" text-anchor="end" font-size="8.5" fill="${T.faint}">▮▮▮ primary · ▮▮ active · ▮ side</text>`;
  s += `</svg>`;
  return s;
}
function band2Mob(theme) {
  const T = THEMES[theme];
  const W = 560, H = 560;
  const isDark = theme === 'dark';
  const sem = (k) => (isDark ? SEM[k] : SEM[k + 'L'] || SEM[k]);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">`;
  s += `<rect width="${W}" height="${H}" fill="${T.bg}"/>`;
  s += `<text x="20" y="28" font-size="12.5" font-weight="700" fill="${T.fg}">GitHub activity</text>`;
  s += `<text x="${W - 16}" y="28" text-anchor="end" font-size="8.5" fill="${T.faint}">30d · Nov 24 JST</text>`;
  // repo output: proportional bars (mobile-safe) — linear width ∝ commits, max = 1000
  s += `<text x="20" y="50" font-size="9.5" font-weight="700" fill="${T.muted}" letter-spacing="1">REPO OUTPUT · 30D</text>`;
  s += `<text x="${W - 16}" y="50" text-anchor="end" font-size="8.5" fill="${T.faint}">bar = commits · ■ = PRs (scaled)</text>`;
  const pubAll = data.repos.filter((r) => r.kind === 'public');
  const maxC = Math.max(...pubAll.map((r) => r.activity.commits));
  const mrows = [...pubAll.slice(0, 6).map((r) => ({ name: r.name.replace('rebuildup/', ''), c: r.activity.commits, p: r.activity.prs, dim: false })),
    { name: `+${pubAll.length - 6} more public`, c: pubAll.slice(6).reduce((a, r) => a + r.activity.commits, 0), p: pubAll.slice(6).reduce((a, r) => a + r.activity.prs, 0), dim: true },
    { name: 'private · sum', c: data.repos.filter((r) => r.kind !== 'public').reduce((a, r) => a + r.activity.commits, 0), p: data.repos.filter((r) => r.kind !== 'public').reduce((a, r) => a + r.activity.prs, 0), dim: true }];
  const ly = 60, rowH = 30, barMax = 300;
  mrows.forEach((r, i) => {
    const y = ly + i * rowH;
    const op = r.dim ? 0.72 : 1;
    s += `<text x="20" y="${y + 11}" font-size="9.5" font-family="${MONO}" fill="${r.dim ? T.muted : T.fg}" opacity="${op}">${esc(r.name.slice(0, 18))}</text>`;
    const w = barMax * (r.c / maxC);
    s += `<rect x="20" y="${y + 17}" width="${Math.max(3, w)}" height="7" rx="3.5" fill="${sem('accent')}" opacity="${0.85 * op}"/>`;
    const np = Math.min(4, Math.floor(r.p / 25));
    for (let p = 0; p < np; p++) {
      s += `<rect x="${20 + Math.max(3, w) + 8 + p * 9}" y="${y + 18}" width="6" height="6" fill="${sem('purple')}" opacity="${0.85 * op}"/>`;
    }
    const cLabel = r.c >= 1000 ? (r.c / 1000).toFixed(1) + 'k' : String(r.c);
    s += `<text x="${W - 16}" y="${y + 22}" text-anchor="end" font-size="8.5" font-family="${MONO}" fill="${T.muted}" opacity="${op}">${cLabel}c ${r.p}p</text>`;
  });
  const lb = ly + mrows.length * rowH + 6;
  s += `<line x1="20" y1="${lb}" x2="${W - 20}" y2="${lb}" stroke="${T.stroke}"/>`;
  // 72h pulse full width
  const py = lb + 16;
  s += `<text x="20" y="${py}" font-size="9.5" font-weight="700" fill="${T.muted}" letter-spacing="1">LAST 72 HOURS</text>`;
  const ph = 120, baseY = py + ph - 26;
  const t2x = (t) => 30 + (1 - (RENDER_NOW - Date.parse(t)) / (72 * 3600e3)) * (W - 60);
  const SHAPE = {
    PushEvent: (x, y, c) => `<circle cx="${x}" cy="${y}" r="3.6" fill="${c}"/>`,
    PullRequestEvent: (x, y, c) => `<rect x="${x - 3.2}" y="${y - 3.2}" width="6.4" height="6.4" rx="1.4" fill="${c}" transform="rotate(45 ${x} ${y})"/>`,
    CreateEvent: (x, y, c) => `<path d="M${x} ${y - 4.2} L${x + 3.8} ${y + 2.8} L${x - 3.8} ${y + 2.8} Z" fill="${c}"/>`,
    DeleteEvent: (x, y, c) => `<path d="M${x - 3} ${y - 3} L${x + 3} ${y + 3} M${x + 3} ${y - 3} L${x - 3} ${y + 3}" stroke="${c}" stroke-width="1.8"/>`,
  };
  const DEF = (x, y, c) => `<rect x="${x - 3.2}" y="${y - 3.2}" width="6.4" height="6.4" rx="1.4" fill="${c}"/>`;
  s += `<rect x="20" y="${py + 12}" width="${W - 40}" height="${ph}" rx="8" fill="${T.panel}" stroke="${T.stroke}"/>`;
  s += `<line x1="30" y1="${baseY}" x2="${W - 30}" y2="${baseY}" stroke="${T.stroke}"/>`;
  const mlg = [['PushEvent', 'push'], ['PullRequestEvent', 'PR'], ['CreateEvent', 'new'], ['DeleteEvent', 'del']];
  let mlx = 34;
  mlg.forEach(([t, label]) => {
    const yy = py + 24;
    s += (SHAPE[t] || DEF)(mlx + 4, yy, sem(TYPE_COLOR[t]));
    s += `<text x="${mlx + 13}" y="${yy + 3}" font-size="8" fill="${T.muted}">${label}</text>`;
    mlx += 13 + label.length * 5 + 10;
  });
  for (let h = 72; h >= 0; h -= 24) {
    const x = 30 + (1 - h / 72) * (W - 60);
    s += `<text x="${x}" y="${py + 12 + ph - 8}" font-size="8" fill="${T.faint}" text-anchor="middle">${h === 0 ? 'now' : `-${h}h`}</text>`;
  }
  feed72.forEach((e, i) => {
    const x = t2x(e.at);
    const c = sem(TYPE_COLOR[e.type] || 'accent');
    const yy = py + 44 + ((i * 15) % (ph - 68));
    s += (SHAPE[e.type] || DEF)(x, yy, c);
  });
  // recent 3
  const ry = py + 12 + ph + 14;
  feed72.slice(0, 3).forEach((e, i) => {
    const y = ry + i * 22;
    s += `<rect x="24" y="${y - 5}" width="6" height="6" rx="1.3" fill="${sem(TYPE_COLOR[e.type] || 'accent')}" transform="rotate(45 ${27} ${y - 2})"/>`;
    const repo = e.repoId.split('/').pop();
    s += `<text x="36" y="${y}" font-size="10" fill="${T.fg}"><tspan font-weight="600" font-family="${MONO}">${esc(repo)}</tspan> <tspan fill="${T.muted}">${TYPE_LABEL[e.type] || e.type} · ${JST(e.at)} JST</tspan></text>`;
  });
  s += `<text x="${W - 16}" y="${ry + 2 * 22 + 16}" text-anchor="end" font-size="8.5" fill="${T.faint}">${feed72.length} public events · times JST</text>`;
  s += `</svg>`;
  return s;
}

// ---------- emit ----------
writeFileSync(`${OUT}/band1-dark.svg`, band1('dark'));
writeFileSync(`${OUT}/band1-light.svg`, band1('light'));
writeFileSync(`${OUT}/band2-dark.svg`, band2('dark'));
writeFileSync(`${OUT}/band2-light.svg`, band2('light'));
writeFileSync(`${OUT}/band1-mob-dark.svg`, band1Mob('dark'));
writeFileSync(`${OUT}/band1-mob-light.svg`, band1Mob('light'));
writeFileSync(`${OUT}/band2-mob-dark.svg`, band2Mob('dark'));
writeFileSync(`${OUT}/band2-mob-light.svg`, band2Mob('light'));

const page = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#0d1117;color:#e6edf3;font:16px/1.5 -apple-system,"Segoe UI",sans-serif}
main{max-width:1012px;margin:0 auto;padding:24px}
h2{font-size:1.4em;border-bottom:1px solid #30363d;padding-bottom:.3em;margin-top:2em}
.sub{color:#8b949e;font-size:.85em}
img{max-width:100%;display:block;margin:8px 0}
figure{margin:12px 0}
figcaption{font-size:12px;color:#8b949e;margin-bottom:4px}
</style></head><body><main>
<p>After Effects tools · Web apps · Tools · Motion design · Video production</p>
<p class="sub">design × code × motion.</p>
<h2>Now</h2>
<figure><figcaption>Band 1 — dark (800×360)</figcaption><img src="band1-dark.svg" width="800"></figure>
<figure><figcaption>Band 1 — light</figcaption><img src="band1-light.svg" width="800"></figure>
<h2>GitHub activity</h2>
<figure><figcaption>Band 2 — dark (800×340)</figcaption><img src="band2-dark.svg" width="800"></figure>
<figure><figcaption>Band 2 — light</figcaption><img src="band2-light.svg" width="800"></figure>
<h2>Mobile variants (560w)</h2>
<figure><figcaption>Band 1 mobile — dark</figcaption><img src="band1-mob-dark.svg" width="560"></figure>
<figure><figcaption>Band 2 mobile — dark</figcaption><img src="band2-mob-dark.svg" width="560"></figure>
<figure><figcaption>Band 1 mobile — light</figcaption><img src="band1-mob-light.svg" width="560"></figure>
<figure><figcaption>Band 2 mobile — light</figcaption><img src="band2-mob-light.svg" width="560"></figure>
</main></body></html>`;
writeFileSync(`${OUT}/index3.html`, page);
console.log('done');
