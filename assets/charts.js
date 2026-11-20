/* Demo-page charts: accuracy / distraction vs. SIR (interactive) and the error-type scatters.
 * Vanilla SVG, no dependencies. Data: data/plots.json (built by tools/build_plot_data.py). */
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const SIRS = [0, 6, 12, 18, 24];
  const FES = [
    { id: 'none', name: 'No front-end', color: 'var(--fe-none)', hollow: true },
    { id: 'hush', name: 'Hush', color: 'var(--fe-hush)' },
    { id: 'tse-c', name: 'TSE-C (causal)', color: 'var(--fe-tsec)' },
    { id: 'tse-nc', name: 'TSE-NC (non-causal)', color: 'var(--fe-tsenc)' },
  ];
  const FE = Object.fromEntries(FES.map(f => [f.id, f]));
  const NAMES = { whisper: 'Whisper large-v3', nemotron: 'Nemotron streaming', llama: 'Llama 3.1 8B', gemma: 'Gemma 4 31B',
                  A: 'A: unrelated background', B: 'B: competing question' };

  // ---------- helpers ----------
  function el(tag, attrs, parent) {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs || {}) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function h(tag, cls, parent, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  }
  const fmt = v => (Math.round(v * 10) / 10).toFixed(1);
  function niceTicks(lo, hi, n) {
    const raw = (hi - lo) / n, p = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 5, 10].map(m => m * p).find(s => s >= raw);
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6));
    return out;
  }
  function lineKey(color, parent) {
    const k = h('span', 'key', parent);
    k.style.background = color;
    return k;
  }
  function legend(parent, extra) {
    const lg = h('div', 'viz-legend', parent);
    const items = {};
    FES.forEach(f => {
      const it = h('span', 'item', lg);
      const s = el('svg', { width: 16, height: 10 }, it);
      el('line', { x1: 0, x2: 16, y1: 5, y2: 5, stroke: f.color, 'stroke-width': 2, 'stroke-linecap': 'round' }, s);
      el('circle', { cx: 8, cy: 5, r: 3.5, fill: f.hollow ? 'var(--surface-1)' : f.color, stroke: f.hollow ? f.color : 'none', 'stroke-width': 2 }, s);
      h('span', null, it, f.name);
      items[f.id] = it;
    });
    if (extra) extra(lg);
    return items;
  }
  function tooltip(panel) { return h('div', 'viz-tip', panel); }
  // position of an SVG viewBox point in panel pixels (SVG elements have no offsetTop/offsetLeft)
  function toPanel(svg, panel, W, vx, vy) {
    const sb = svg.getBoundingClientRect(), pb = panel.getBoundingClientRect(), sc = sb.width / W;
    return [sb.left - pb.left + vx * sc, sb.top - pb.top + vy * sc];
  }
  function placeTip(tip, panel, x, y) {
    tip.style.display = 'block';
    const pw = panel.clientWidth, tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = x + 14; if (left + tw > pw) left = x - tw - 14; if (left < 0) left = 0;
    let top = y - th / 2; if (top < 0) top = 0;
    tip.style.left = left + 'px'; tip.style.top = top + 'px';
  }
  function segmented(parent, label, options, value, onChange) {
    const g = h('div', 'viz-seg', parent);
    g.setAttribute('role', 'group'); g.setAttribute('aria-label', label);
    h('span', 'lab', g, label);
    const btns = options.map(([v, text]) => {
      const b = h('button', null, g, text);
      b.type = 'button'; b.setAttribute('aria-pressed', String(v === value));
      b.addEventListener('click', () => { btns.forEach(x => x.setAttribute('aria-pressed', 'false'));
        b.setAttribute('aria-pressed', 'true'); onChange(v); });
      return b;
    });
  }

  // ---------- B3/B4: accuracy & distraction vs SIR ----------
  function sirChart(root, data) {
    root.classList.add('viz');
    const state = { mode: 'B', asr: 'whisper', llm: 'gemma' };
    const card = h('div', 'viz-card', root);
    const ctr = h('div', 'viz-controls', card);
    const redraw = () => render();
    segmented(ctr, 'Setting', [['A', 'A: unrelated'], ['B', 'B: competing question']], state.mode, v => { state.mode = v; redraw(); });
    segmented(ctr, 'ASR', [['whisper', 'Whisper'], ['nemotron', 'Nemotron']], state.asr, v => { state.asr = v; redraw(); });
    segmented(ctr, 'LLM', [['llama', 'Llama 3.1 8B'], ['gemma', 'Gemma 4 31B']], state.llm, v => { state.llm = v; redraw(); });
    legend(card, lg => {
      const it = h('span', 'item', lg);
      const s = el('svg', { width: 16, height: 10 }, it);
      el('line', { x1: 0, x2: 16, y1: 5, y2: 5, stroke: 'var(--ref)', 'stroke-width': 1 }, s);
      h('span', null, it, 'Clean audio (no background talker)');
    });
    const panels = h('div', 'viz-panels', card);
    const pAcc = h('div', 'viz-panel', panels), pDist = h('div', 'viz-panel', panels);
    const det = h('details', null, card); h('summary', null, det, 'Show the numbers as a table');
    const tables = h('div', 'tables', det);

    function series(metric) {
      return FES.map(f => ({ fe: f, vals: SIRS.map(s => {
        const r = data.sets.find(d => d.mode === state.mode && d.asr === state.asr && d.llm === state.llm && d.fe === f.id && d.sir === s);
        return r ? r[metric] : null; }) }));
    }
    function render() {
      const clean = data.clean[state.asr][state.llm];
      panelSIR(pAcc, 'Answer accuracy (%)', 'Higher is better', series('acc'), [30, 80], clean);
      panelSIR(pDist, 'Distraction rate (%)', 'Share of responses that address the background question · lower is better',
               state.mode === 'B' ? series('dist') : null, [0, 70], null);
      tables.replaceChildren();
      [['Accuracy (%)', series('acc')], ['Distraction (%)', state.mode === 'B' ? series('dist') : null]].forEach(([t, ser]) => {
        if (!ser) return;
        const wrap = h('div', null, tables); h('h5', null, wrap, t);
        const tb = h('table', null, wrap), hr = h('tr', null, tb);
        h('th', null, hr, 'Front-end'); SIRS.forEach(s => h('th', null, hr, s + ' dB'));
        ser.forEach(se => { const tr = h('tr', null, tb); h('td', null, tr, se.fe.name); se.vals.forEach(v => h('td', null, tr, v == null ? '–' : fmt(v))); });
        if (t.startsWith('Acc')) { const tr = h('tr', null, tb); h('td', null, tr, 'Clean audio'); SIRS.forEach(() => h('td', null, tr, fmt(clean))); }
      });
    }

    function panelSIR(panel, title, sub, ser, dom, ref) {
      panel.replaceChildren();
      h('h4', null, panel, title); h('p', 'sub', panel, sub);
      const W = Math.max(panel.clientWidth || 420, 300), H = 260, m = { t: 10, r: 96, b: 34, l: 34 };
      const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': title + ' by SIR' }, panel);
      const x = i => m.l + i * (W - m.l - m.r) / (SIRS.length - 1);
      const y = v => m.t + (dom[1] - v) / (dom[1] - dom[0]) * (H - m.t - m.b);
      niceTicks(dom[0], dom[1], 5).forEach(t => {
        el('line', { x1: m.l, x2: W - m.r + 8, y1: y(t), y2: y(t), stroke: t === dom[0] ? 'var(--axis)' : 'var(--grid)', 'stroke-width': 1 }, svg);
        el('text', { x: m.l - 6, y: y(t) + 3.5, 'text-anchor': 'end' }, svg).textContent = t;
      });
      SIRS.forEach((s, i) => { el('text', { x: x(i), y: H - m.b + 16, 'text-anchor': 'middle' }, svg).textContent = s; });
      el('text', { x: (m.l + W - m.r) / 2, y: H - 4, 'text-anchor': 'middle' }, svg).textContent = 'SIR (dB) · higher = quieter background talker';
      if (!ser) {
        el('text', { x: (m.l + W - m.r) / 2, y: (m.t + H - m.b) / 2, 'text-anchor': 'middle', class: 'empty' }, svg)
          .textContent = 'Measured in setting B (competing question) only';
        return;
      }
      if (ref != null) {
        el('line', { x1: m.l, x2: W - m.r + 8, y1: y(ref), y2: y(ref), stroke: 'var(--ref)', 'stroke-width': 1 }, svg);
      }
      ser.forEach(se => {
        const pts = se.vals.map((v, i) => [x(i), y(v)]);
        el('path', { d: 'M' + pts.map(p => p.join(',')).join('L'), fill: 'none', stroke: se.fe.color, 'stroke-width': 2,
                     'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
      });
      ser.forEach(se => se.vals.forEach((v, i) => el('circle', { cx: x(i), cy: y(v), r: 4, fill: se.fe.hollow ? 'var(--surface-1)' : se.fe.color,
        stroke: se.fe.hollow ? se.fe.color : 'var(--surface-1)', 'stroke-width': 2 }, svg)));
      // end labels: skip any that would collide (legend + tooltip carry them)
      const ends = ser.map(se => ({ name: se.fe.name.replace(/ \(.*\)/, ''), y: y(se.vals[SIRS.length - 1]) }));
      if (ref != null) ends.push({ name: 'Clean', y: y(ref), ref: true });
      ends.sort((a, b) => a.y - b.y);
      let last = -Infinity;
      ends.forEach(e => { if (e.y - last >= 13) { el('text', { x: W - m.r + 12, y: e.y + 4, class: e.ref ? 'ref-label' : 'end-label' }, svg).textContent = e.name; last = e.y; } });
      // hover / focus layer
      const tip = tooltip(panel);
      const cross = el('line', { y1: m.t, y2: H - m.b, stroke: 'var(--axis)', 'stroke-width': 1, visibility: 'hidden' }, svg);
      const hit = el('rect', { x: m.l - 16, y: m.t, width: W - m.l - m.r + 32, height: H - m.t - m.b, fill: 'transparent', class: 'hit', tabindex: 0 }, svg);
      let cur = null;
      function show(i) {
        cur = i;
        cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
        tip.replaceChildren(); h('div', 'hd', tip, `SIR ${SIRS[i]} dB · ${NAMES[state.asr]} · ${NAMES[state.llm]}`);
        ser.map(se => ({ se, v: se.vals[i] })).sort((a, b) => b.v - a.v).forEach(({ se, v }) => {
          const r = h('div', 'row', tip); lineKey(se.fe.color, r); h('b', null, r, fmt(v) + '%'); h('span', null, r, se.fe.name); });
        if (ref != null) { const r = h('div', 'row', tip); lineKey('var(--ref)', r); h('b', null, r, fmt(ref) + '%'); h('span', null, r, 'Clean audio'); }
        placeTip(tip, panel, ...toPanel(svg, panel, W, x(i), m.t + (H - m.b - m.t) / 2));
      }
      function hide() { cross.setAttribute('visibility', 'hidden'); tip.style.display = 'none'; cur = null; }
      hit.addEventListener('pointermove', ev => {
        const bb = svg.getBoundingClientRect(), px = (ev.clientX - bb.left) * W / bb.width;
        let best = 0; SIRS.forEach((_, i) => { if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i; });
        show(best);
      });
      hit.addEventListener('pointerleave', hide);
      hit.addEventListener('blur', hide);
      hit.addEventListener('focus', () => show(cur ?? 0));
      hit.addEventListener('keydown', ev => {
        if (ev.key === 'ArrowRight') { show(Math.min((cur ?? -1) + 1, SIRS.length - 1)); ev.preventDefault(); }
        if (ev.key === 'ArrowLeft') { show(Math.max((cur ?? 1) - 1, 0)); ev.preventDefault(); }
      });
    }
    render();
    let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(render, 120); });
  }

  // ---------- B6/B7: scatter small multiples ----------
  function scatterChart(root, data, cfg) {
    root.classList.add('viz');
    const pts = data.sets.filter(cfg.filter);
    const card = h('div', 'viz-card', root);
    const items = legend(card, lg => {
      const it = h('span', 'item', lg);
      const s = el('svg', { width: 16, height: 10 }, it);
      el('line', { x1: 0, x2: 16, y1: 5, y2: 5, stroke: 'var(--ref)', 'stroke-width': 1 }, s);
      h('span', null, it, 'Least-squares fit');
    });
    const panels = h('div', 'viz-panels', card);
    const ys = pts.map(p => p[cfg.y]);
    const yd = [Math.min(0, Math.floor(Math.min(...ys) / 5) * 5), Math.ceil(Math.max(...ys) / 5) * 5];
    const renders = cfg.panels.map(pc => {
      const panel = h('div', 'viz-panel', panels);
      return () => drawScatter(panel, pc);
    });
    function drawScatter(panel, pc) {
      panel.replaceChildren();
      const title = h('h4', null, panel, pc.title);
      h('p', 'sub', panel, `Pearson r = ${data.stats[pc.stat].toFixed(2)} over ${pts.length} sets`);
      const W = Math.max(panel.clientWidth || 420, 300), H = 280, m = { t: 10, r: 14, b: 38, l: 40 };
      const xs = pts.map(p => p[pc.x]);
      const xd = [0, Math.ceil(Math.max(...xs) / 10) * 10];
      const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${cfg.yLabel} against ${pc.xLabel}` }, panel);
      const x = v => m.l + (v - xd[0]) / (xd[1] - xd[0]) * (W - m.l - m.r);
      const y = v => m.t + (yd[1] - v) / (yd[1] - yd[0]) * (H - m.t - m.b);
      niceTicks(yd[0], yd[1], 5).forEach(t => {
        el('line', { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t), stroke: t === 0 ? 'var(--axis)' : 'var(--grid)', 'stroke-width': 1 }, svg);
        el('text', { x: m.l - 6, y: y(t) + 3.5, 'text-anchor': 'end' }, svg).textContent = t;
      });
      niceTicks(xd[0], xd[1], 5).forEach(t => { el('text', { x: x(t), y: H - m.b + 16, 'text-anchor': 'middle' }, svg).textContent = t; });
      el('text', { x: (m.l + W - m.r) / 2, y: H - 4, 'text-anchor': 'middle' }, svg).textContent = pc.xLabel;
      el('text', { x: 10, y: (m.t + H - m.b) / 2, 'text-anchor': 'middle', transform: `rotate(-90 10 ${(m.t + H - m.b) / 2})` }, svg).textContent = cfg.yLabel;
      // fit
      const n = pts.length, mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n;
      const b = pts.reduce((s, p) => s + (p[pc.x] - mx) * (p[cfg.y] - my), 0) / pts.reduce((s, p) => s + (p[pc.x] - mx) ** 2, 0);
      const fy = v => my + b * (v - mx);
      let x1 = xd[0], x2 = xd[1];
      if (fy(x1) < yd[0]) x1 = mx + (yd[0] - my) / b; if (fy(x2) > yd[1]) x2 = mx + (yd[1] - my) / b;
      el('line', { x1: x(x1), x2: x(x2), y1: y(fy(x1)), y2: y(fy(x2)), stroke: 'var(--ref)', 'stroke-width': 1 }, svg);
      const groups = {};
      FES.forEach(f => { groups[f.id] = el('g', {}, svg); });
      const marks = pts.map(p => {
        const f = FE[p.fe];
        const c = el('circle', { cx: x(p[pc.x]), cy: y(p[cfg.y]), r: 4.5, fill: f.hollow ? 'var(--surface-1)' : f.color,
          stroke: f.hollow ? f.color : 'var(--surface-1)', 'stroke-width': 2 }, groups[p.fe]);
        return { p, c, cx: x(p[pc.x]), cy: y(p[cfg.y]) };
      });
      const tip = tooltip(panel);
      const hit = el('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: 'transparent', class: 'hit' }, svg);
      let on = null;
      function clear() { if (on) { on.c.setAttribute('r', 4.5); on = null; } tip.style.display = 'none'; }
      hit.addEventListener('pointermove', ev => {
        const bb = svg.getBoundingClientRect(), sc = W / bb.width;
        const px = (ev.clientX - bb.left) * sc, py = (ev.clientY - bb.top) * sc;
        let best = null, bd = 24 * sc;
        marks.forEach(mk => { const d = Math.hypot(mk.cx - px, mk.cy - py); if (d < bd) { bd = d; best = mk; } });
        if (best !== on) { clear(); }
        if (!best) return;
        on = best; best.c.setAttribute('r', 6.5); best.c.parentNode.appendChild(best.c);
        const p = best.p, f = FE[p.fe];
        tip.replaceChildren();
        h('div', 'hd', tip, `${NAMES[p.mode]} · SIR ${p.sir} dB`);
        h('div', 'hd', tip, `${f.name} · ${NAMES[p.asr]} · ${NAMES[p.llm]}`);
        cfg.rows(p).forEach(([lab, v]) => { const r = h('div', 'row', tip); h('b', null, r, v); h('span', null, r, lab); });
        placeTip(tip, panel, ...toPanel(svg, panel, W, best.cx, best.cy));
      });
      hit.addEventListener('pointerleave', clear);
      return groups;
    }
    let groupsList = [];
    const renderAll = () => { groupsList = renders.map(r => r()); };
    renderAll();
    // legend hover highlights one front-end across both panels
    FES.forEach(f => {
      const it = items[f.id];
      it.addEventListener('pointerenter', () => { groupsList.forEach(g => FES.forEach(o => g[o.id].setAttribute('opacity', o.id === f.id ? 1 : 0.15)));
        FES.forEach(o => items[o.id].classList.toggle('dim', o.id !== f.id)); });
      it.addEventListener('pointerleave', () => { groupsList.forEach(g => FES.forEach(o => g[o.id].setAttribute('opacity', 1)));
        FES.forEach(o => items[o.id].classList.remove('dim')); });
    });
    // table view
    const det = h('details', null, card); h('summary', null, det, `Show all ${pts.length} sets as a table`);
    const wrap = h('div', 'tables', det), tb = h('table', null, wrap), hr = h('tr', null, tb);
    ['Setting', 'ASR', 'LLM', 'Front-end', 'SIR (dB)'].concat(cfg.cols.map(c => c[0])).forEach(t => h('th', null, hr, t));
    pts.forEach(p => { const tr = h('tr', null, tb);
      [p.mode, NAMES[p.asr], NAMES[p.llm], FE[p.fe].name, p.sir].concat(cfg.cols.map(c => fmt(p[c[1]]))).forEach(v => h('td', null, tr, v)); });
    let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(renderAll, 120); });
  }

  function init(data) {
    const a = document.getElementById('chart-sir');
    if (a) sirChart(a, data);
    const b = document.getElementById('chart-acc-errors');
    if (b) scatterChart(b, data, {
      filter: () => true, y: 'drop', yLabel: 'Accuracy drop vs. clean audio (points)',
      panels: [{ x: 'wer', xLabel: 'WER (%)', title: 'Against total WER', stat: 'drop_vs_wer' },
               { x: 'sd', xLabel: 'Substitutions + deletions (%)', title: 'Against S+D only', stat: 'drop_vs_sd' }],
      rows: p => [['Accuracy drop (points)', fmt(p.drop)], ['WER (%)', fmt(p.wer)], ['S+D (%)', fmt(p.sd)], ['Insertions (%)', fmt(p.ins)]],
      cols: [['Acc. drop', 'drop'], ['WER', 'wer'], ['S+D', 'sd'], ['Ins.', 'ins']],
    });
    const c = document.getElementById('chart-dist-errors');
    if (c) scatterChart(c, data, {
      filter: p => p.mode === 'B', y: 'dist', yLabel: 'Distraction rate (%)',
      panels: [{ x: 'ins', xLabel: 'Insertions (%)', title: 'Against insertions', stat: 'dist_vs_ins' },
               { x: 'sd', xLabel: 'Substitutions + deletions (%)', title: 'Against S+D', stat: 'dist_vs_sd' }],
      rows: p => [['Distraction (%)', fmt(p.dist)], ['Insertions (%)', fmt(p.ins)], ['S+D (%)', fmt(p.sd)], ['Accuracy (%)', fmt(p.acc)]],
      cols: [['Distraction', 'dist'], ['Ins.', 'ins'], ['S+D', 'sd'], ['Acc.', 'acc']],
    });
  }

  window.BTCharts = { init };
  fetch(document.currentScript.dataset.src || 'data/plots.json').then(r => r.json()).then(init)
    .catch(err => { console.error('chart data failed to load', err); });
})();
