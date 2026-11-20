/* Audio examples for the demo page. Data: data/examples.json (built by tools/build_examples.py).
 * All text from the data is inserted with textContent. */
(function () {
  'use strict';
  const FE = {
    none: { name: 'No front-end', short: 'None', color: 'var(--fe-none)' },
    hush: { name: 'Hush', short: 'Hush', color: 'var(--fe-hush)' },
    'tse-c': { name: 'TSE-C (causal)', short: 'TSE-C', color: 'var(--fe-tsec)' },
    'tse-nc': { name: 'TSE-NC (non-causal)', short: 'TSE-NC', color: 'var(--fe-tsenc)' },
  };
  const ASR = { whisper: 'Whisper large-v3', nemotron: 'Nemotron streaming' };
  const LLM = { llama: 'Llama 3.1 8B', gemma: 'Gemma 4 31B' };

  function h(tag, cls, parent, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  }
  const swatch = (fe, parent) => { const s = h('span', 'sw', parent); s.style.background = FE[fe].color; return s; };

  // ---------- one shared audio element: only one clip plays at a time ----------
  const audio = new Audio();
  audio.preload = 'none';
  let current = null;
  function stop() {
    if (!current) return;
    current.classList.remove('playing'); current.setAttribute('aria-pressed', 'false');
    current.querySelector('.bar').style.width = '0';
    current = null;
  }
  audio.addEventListener('timeupdate', () => {
    if (current && audio.duration) current.querySelector('.bar').style.width = (100 * audio.currentTime / audio.duration) + '%';
  });
  audio.addEventListener('ended', stop);
  function play(src, label, meta, parent) {
    const b = h('button', 'play', parent);
    b.type = 'button'; b.setAttribute('aria-pressed', 'false');
    b.setAttribute('aria-label', 'Play ' + label + (meta ? ' (' + meta + ')' : ''));
    h('span', 'ico', b);
    if (label) h('span', null, b, label);
    if (meta) h('span', 'meta', b, meta);
    h('span', 'bar', b);
    b.addEventListener('click', () => {
      if (current === b) { audio.pause(); stop(); return; }
      stop(); audio.src = src; audio.currentTime = 0;
      audio.play().catch(() => {});
      current = b; b.classList.add('playing'); b.setAttribute('aria-pressed', 'true');
    });
    return b;
  }

  // ---------- transcripts ----------
  function transcript(segs, parent) {
    const p = h('span', 'tx-text', parent);
    const shown = segs.filter(s => s.k !== 'del' && s.t.replace(/[.\s]/g, ''));
    if (!shown.length) { h('span', 'empty', p, '(nothing transcribed)'); return p; }
    segs.forEach((s, i) => {
      if (i) p.appendChild(document.createTextNode(' '));
      if (s.k === 'ok') p.appendChild(document.createTextNode(s.t));
      else if (s.k === 'ins') { const m = h('mark', 'ins', p, s.t); m.title = 'Inserted: not in the user\'s question'; }
      else if (s.k === 'sub') { const m = h('span', 'sub', p, s.t); m.title = 'User said: ' + s.ref; }
      else if (s.k === 'del') { const m = h('span', 'del', p, s.t); m.title = 'Missing from the transcript'; }
    });
    return p;
  }
  function txLegend(parent) {
    const l = h('div', 'tx-legend', parent);
    const a = h('span', null, l); h('mark', 'ins', a, 'inserted words'); a.appendChild(document.createTextNode(' not in the user\'s question'));
    const b = h('span', null, l); h('span', 'sub', b, 'substituted words'); b.appendChild(document.createTextNode(' (hover for what the user said)'));
    const c = h('span', null, l); h('span', 'del', c, 'missing words');
  }

  // ---------- answers ----------
  function richText(s, parent) {
    // minimal markdown: ***x***, **bold**, *italic*; headings and list markers as plain text
    const text = String(s).replace(/^#{1,6}\s*/gm, '').replace(/^(\s*)[*-]\s+/gm, '$1• ');
    text.split(/(\*\*\*[^*\n]+\*\*\*|\*\*[^*\n]+\*\*|\*[^*\s][^*\n]*?\*)/).forEach(part => {
      if (/^\*\*\*[^*]+\*\*\*$/.test(part)) h('em', null, h('strong', null, parent), part.slice(3, -3));
      else if (/^\*\*[^*]+\*\*$/.test(part)) h('strong', null, parent, part.slice(2, -2));
      else if (/^\*[^*]+\*$/.test(part)) h('em', null, parent, part.slice(1, -1));
      else parent.appendChild(document.createTextNode(part));
    });
  }
  function badge(kind, text, parent) {
    const b = h('span', 'badge ' + kind, parent);
    h('span', 'i', b, kind === 'ok' ? '✓' : kind === 'bad' ? '✗' : '!');
    b.appendChild(document.createTextNode(text));
  }
  function answer(llm, r, parent) {
    const a = h('div', 'answer', parent);
    const who = h('div', 'who', a); h('b', null, who, LLM[llm]);
    badge(r.correct ? 'ok' : 'bad', r.correct ? 'Correct' : 'Wrong', who);
    if (r.distracted === true) badge('dist', 'Answers the background question', who);
    const body = h('div', 'body clamped', a); richText(r.answer.trim(), body);
    const more = h('button', 'more', a, 'Show full answer'); more.type = 'button';
    more.addEventListener('click', () => { const c = body.classList.toggle('clamped'); more.textContent = c ? 'Show full answer' : 'Show less'; });
    requestAnimationFrame(() => { if (body.scrollHeight <= body.clientHeight + 2) more.remove(); });
  }

  // ---------- A1 ----------
  function a1(root, d) {
    const card = h('div', 'card', root);
    const ref = h('div', 'ref-row', card);
    h('span', null, ref, 'Reference: the main talker alone');
    play(d.clean, 'Clean main talker', null, ref);
    const tabs = h('div', 'tabs', card); tabs.setAttribute('role', 'tablist');
    const wrap = h('div', 'grid-wrap', card);
    const note = h('p', 'how', card);
    note.style.margin = '10px 0 0'; note.style.fontSize = '13px'; note.style.color = 'var(--text-secondary)';
    const views = [
      ['Overlap', () => grid(d.overlap, r => `${r.sir} dB SIR`, c => c.sisdr == null ? '' : `${c.sisdr.toFixed(1)} dB`,
        'Each cell: SI-SDR of the output with respect to the clean main talker. Rows: background talker 0–24 dB below the main talker.')],
      ['Background talker only', () => grid(d.bgonly, r => `${r.dbfs} dBFS`, c => c.att == null ? 'input' : `−${c.att.toFixed(1)} dB`,
        'Each cell: attenuation of the background talker (RMS level difference between input and output). No main talker in these clips.')],
    ];
    function grid(rows, rowLabel, cellMeta, text) {
      wrap.replaceChildren();
      const t = h('table', 'grid', wrap), hr = h('tr', null, t);
      h('th', null, hr, '');
      Object.keys(FE).forEach(fe => { const th = h('th', null, hr); swatch(fe, th); th.appendChild(document.createTextNode(FE[fe].name)); });
      rows.forEach(r => {
        const tr = h('tr', null, t); h('td', 'rowhead', tr, rowLabel(r));
        Object.keys(FE).forEach(fe => { const td = h('td', null, tr); play(r.cells[fe].audio, '', cellMeta(r.cells[fe]), td)
          .setAttribute('aria-label', `Play ${FE[fe].name}, ${rowLabel(r)} (${cellMeta(r.cells[fe])})`); });
      });
      note.textContent = text;
    }
    views.forEach(([label, fn], i) => {
      const b = h('button', null, tabs, label); b.type = 'button'; b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(i === 0));
      b.addEventListener('click', () => { stop(); audio.pause(); tabs.querySelectorAll('button').forEach(x => x.setAttribute('aria-selected', 'false'));
        b.setAttribute('aria-selected', 'true'); fn(); });
    });
    views[0][1]();
  }

  // ---------- A2 ----------
  function a2(root, d) {
    const card = h('div', 'card', root), clips = h('div', 'clips', card);
    [['none', 'input', 'Input: main talker only', null], ['hush', 'hush', 'Hush output', `SI-SDR ${d.sisdr_hush.toFixed(1)} dB w.r.t. the input`]].forEach(([fe, key, title, num]) => {
      const c = h('div', 'clip', clips); const t = h('h4', null, c); swatch(fe, t); t.appendChild(document.createTextNode(title));
      play(d.audio[key], 'Play', null, c);
      if (num) h('p', 'num', c, num);
      Object.keys(ASR).forEach(asr => { const tx = h('div', 'tx', c); h('span', 'lab', tx, ASR[asr] + ' transcript'); transcript(d.transcripts[asr][fe], tx); });
    });
  }

  // ---------- A3 ----------
  function a3(root, d) {
    const card = h('div', 'card', root), clips = h('div', 'clips', card);
    ['none', 'tse-c', 'tse-nc'].forEach(fe => {
      const c = h('div', 'clip', clips); const t = h('h4', null, c); swatch(fe, t);
      t.appendChild(document.createTextNode(fe === 'none' ? 'Input: background talker only' : FE[fe].name));
      play(d.audio[fe], 'Play', null, c);
      h('p', 'num', c, fe === 'none' ? '−25 dBFS (0 dB SIR level)' : `Attenuation ${d.att[fe].toFixed(1)} dB`);
      Object.keys(ASR).forEach(asr => {
        const tx = h('div', 'tx', c); const s = d.transcripts[asr][fe].trim();
        h('span', 'lab', tx, `${ASR[asr]} · ${s ? s.split(/\s+/).length : 0} words`);
        const m = h('mark', 'ins', tx, s || ''); if (!s) { m.remove(); h('span', 'empty', tx, '(nothing transcribed)'); }
      });
    });
  }

  // ---------- QA examples (A7–A10) ----------
  function qa(root, d) {
    const card = h('div', 'card', root);
    const dl = h('dl', 'qa-head', card);
    const add = (k, v) => { h('dt', null, dl, k); h('dd', null, dl, v); };
    add('User asks', d.question); add('Reference answer', d.answer);
    if (d.far_question) { add('Background talker asks', d.far_question); add('Speaks first', d.start === 'far_first' ? 'Background talker' : 'User'); }
    else add('Background', 'Unrelated read speech (DNS test set)');
    add('SIR', d.sir + ' dB');
    d.rows.forEach(r => {
      const row = h('div', 'qa-row', card);
      const top = h('div', 'top', row);
      const cond = h('span', 'cond', top); swatch(r.fe, cond);
      cond.appendChild(document.createTextNode(`${FE[r.fe].name} → ${ASR[r.asr]}`));
      play(r.audio, r.fe === 'none' ? 'Mixture' : FE[r.fe].short + ' output', null, top);
      const tx = h('p', 'transcript', row); h('span', 'lab', tx, 'Transcript sent to the LLM'); transcript(r.transcript, tx);
      const ans = h('div', 'answers', row);
      answer('llama', r.llama, ans); answer('gemma', r.gemma, ans);
    });
    txLegend(card);
  }

  const RENDER = { A1: a1, A2: a2, A3: a3,A7: qa, A8: qa, A9: qa, A10: qa };
  fetch(document.currentScript.dataset.src || 'data/examples.json').then(r => r.json()).then(data => {
    document.querySelectorAll('[data-example]').forEach(el => {
      const k = el.dataset.example;
      if (data[k] && RENDER[k]) RENDER[k](el, data[k]);
    });
  }).catch(err => console.error('examples failed to load', err));
})();
