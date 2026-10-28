import fs from 'node:fs';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function writeReport(jobs, resume, file = 'data/report.html') {
  const rows = jobs.map((j) => `
  <article class="job" data-score="${j.score}" data-status="${j.status}">
    <div class="top">
      <span class="score s${Math.floor(j.score / 20)}">${j.score}</span>
      <div class="head">
        <a class="title" href="${esc(j.url)}" target="_blank" rel="noopener">${esc(j.title)}</a>
        <div class="meta">${esc(j.company)} · ${esc(j.location)} · ${esc(j.sources.join(', '))}${j.posted ? ' · ' + esc(j.posted) : ''} · <code>${j.id}</code>${j.status !== 'new' ? ` · <b>${esc(j.status)}</b>` : ''}</div>
      </div>
      <a class="apply" href="${esc(j.applyUrl)}" target="_blank" rel="noopener">Apply ↗</a>
    </div>
    <div class="why">${j.reasons.map(esc).join(' · ')}</div>
    <div class="skills">${j.matched.map((s) => `<span class="ok">${esc(s)}</span>`).join('')}${j.missing.map((s) => `<span class="no">${esc(s)}</span>`).join('')}</div>
  </article>`).join('');

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Job matches</title><style>
:root{--bg:#f6f7f9;--card:#fff;--fg:#1b1f24;--mute:#5d6673;--line:#e3e6ea;--ok:#e3f5e8;--okf:#1d6b35;--no:#fbeaea;--nof:#9b2c2c;--acc:#2456d6}
@media (prefers-color-scheme:dark){:root{--bg:#121417;--card:#1b1e22;--fg:#e6e8eb;--mute:#9aa3ae;--line:#2b3036;--ok:#16301f;--okf:#7fd69a;--no:#371b1b;--nof:#f19a9a;--acc:#7aa2ff}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,sans-serif}
main{max-width:900px;margin:0 auto;padding:24px 16px}
h1{font-size:22px;margin:0 0 4px}.sub{color:var(--mute);margin-bottom:16px}
.bar{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:16px;color:var(--mute)}
.job{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin-bottom:10px}
.top{display:flex;gap:12px;align-items:flex-start}.head{flex:1;min-width:0}
.title{color:var(--fg);font-weight:600;text-decoration:none}.title:hover{text-decoration:underline}
.meta,.why{color:var(--mute);font-size:13px;margin-top:2px;overflow-wrap:anywhere}
.score{min-width:40px;text-align:center;font-weight:700;border-radius:8px;padding:6px 0;background:var(--line)}
.s4,.s5{background:var(--ok);color:var(--okf)}.s0,.s1{background:var(--no);color:var(--nof)}
.apply{white-space:nowrap;color:var(--acc);font-weight:600;text-decoration:none}
.skills{margin-top:8px;display:flex;flex-wrap:wrap;gap:4px}.skills span{font-size:12px;padding:1px 7px;border-radius:99px}
.ok{background:var(--ok);color:var(--okf)}.no{background:var(--no);color:var(--nof)}
code{font-size:12px}
</style></head><body><main>
<h1>Job matches for ${esc(resume.name)}</h1>
<div class="sub">${jobs.length} jobs · generated ${new Date().toLocaleString('en-IN')} · green = skill you have, red = skill you don't</div>
<div class="bar"><label>Min score <input id="min" type="range" min="0" max="100" value="0"> <b id="mv">0</b></label>
<label><input id="hide" type="checkbox" checked> Hide applied / skipped</label></div>
${rows}
</main><script>
const min=document.getElementById('min'),mv=document.getElementById('mv'),hide=document.getElementById('hide');
function f(){mv.textContent=min.value;document.querySelectorAll('.job').forEach(e=>{const s=e.dataset.status;e.hidden=+e.dataset.score<+min.value||(hide.checked&&(s==='applied'||s==='skipped'))})}
min.oninput=f;hide.onchange=f;f();
</script></body></html>`;
  fs.writeFileSync(file, html);
  return file;
}
