// Fills an application page. Never presses submit and never ticks a consent box.
import { scanForm } from './scan.js';
import { answerFor, pickOption, NEVER, keyOf } from './answers.js';

const FORMS = [
  [/(job-boards|boards)(\.eu)?\.greenhouse\.io\/([\w-]+)\/jobs\/(\d+)/, 'greenhouse'],
  [/jobs\.lever\.co\/([\w-]+)\/([0-9a-f-]{36})/, 'lever'],
  [/jobs\.ashbyhq\.com\/([\w.-]+)\/([0-9a-f-]{36})/, 'ashby'],
];

// The form page for a job, or null when it is not on a board we can fill.
export function formUrl(job) {
  if (job.form) return job.applyUrl;
  for (const u of [job.applyUrl, job.url]) {
    for (const [re, ats] of FORMS) {
      const m = (u || '').match(re);
      if (!m) continue;
      if (ats === 'greenhouse') return `https://job-boards.greenhouse.io/${m[3]}/jobs/${m[4]}`;
      if (ats === 'lever') return `https://jobs.lever.co/${m[1]}/${m[2]}/apply`;
      return `https://jobs.ashbyhq.com/${m[1]}/${m[2]}/application`;
    }
  }
  return null;
}

const TEXTY = new Set(['text', 'email', 'tel', 'url', 'number', 'textarea', 'input']);

async function fillCombobox(page, el, value) {
  await el.click();
  await el.fill('').catch(() => {});
  await el.pressSequentially(String(value).slice(0, 40), { delay: 15 });
  await page.waitForTimeout(700);
  const options = page.locator('[role="option"]:visible');
  const texts = await options.allInnerTexts();
  const pick = pickOption(texts, value);
  if (!pick) {
    await el.press('Escape');
    await el.fill('').catch(() => {});
    return false;
  }
  await options.nth(pick.i).click();
  return pick.o;
}

const SUGGESTIONS = '[role="option"]:visible, .dropdown-results > div:visible, [class*="suggestion" i]:visible, .pac-item:visible';

// Location boxes that only take a picked suggestion: type, then pick the first one offered.
async function fillTypeahead(page, el, tries, fallback) {
  for (const t of tries) {
    await el.fill('');
    await el.pressSequentially(t, { delay: 25 });
    await page.waitForTimeout(1500);
    const sugg = page.locator(SUGGESTIONS);
    const texts = (await sugg.allInnerTexts()).map((x) => x.trim());
    const i = texts.findIndex((x) => x && !/no (location|results?) found|try entering/i.test(x));
    if (i >= 0) {
      await sugg.nth(i).click();
      return texts[i];
    }
    if (!texts.length) break; // a plain text box: what was typed stays
  }
  await el.fill(fallback);
  return fallback;
}

async function fillOne(page, f, ans, profile) {
  const el = page.locator(`[data-ja="${f.ja}"]`).first();
  if (TEXTY.has(f.kind)) {
    // A resume parser may have filled it already; the profile wins unless they agree.
    if (f.value && f.value === String(ans.value)) return 'already';
    if (/location|city|where are you based/i.test(f.label) && f.kind !== 'textarea') {
      return fillTypeahead(page, el, [`${profile.city}, ${profile.state}`, profile.city], String(ans.value));
    }
    await el.fill(String(ans.value));
    return true;
  }
  if (f.kind === 'select') {
    const pick = pickOption(f.options, ans.value) || pickOption(f.options, profile.country);
    if (!pick) return false;
    await el.selectOption({ label: pick.o });
    return pick.o;
  }
  if (f.kind === 'combobox') {
    return (await fillCombobox(page, el, ans.value)) || (f.label.match(/country|location/i) ? fillCombobox(page, el, profile.country) : false);
  }
  if (f.kind === 'radio') {
    if (f.checked.some(Boolean)) return 'already';
    const pick = pickOption(f.options, ans.value);
    if (!pick) return false;
    await page.locator(`[data-ja="${f.ja}-${pick.i}"]`).check({ force: true });
    return pick.o;
  }
  if (f.kind === 'checkbox') {
    const wanted = String(ans.value).split(';').map((s) => s.trim()).filter(Boolean);
    let any = false;
    for (const w of wanted) {
      const pick = pickOption(f.options, w);
      if (pick) { await page.locator(`[data-ja="${f.ja}-${pick.i}"]`).check({ force: true }); any = true; }
    }
    return any;
  }
  return false;
}

export async function fillForm(page, { profile, bank, resumePath }) {
  const filled = [];
  const needs = new Map();
  const done = new Set();
  let resumeDone = false;
  let fieldsByJa = {};

  // Pass 0 attaches the resume only, and waits while the site reads it: some sites
  // fill the form from the resume and would overwrite answers given before that.
  for (let pass = 0; pass < 3; pass++) {
    if (pass === 1 && resumeDone) {
      await page.waitForTimeout(1500);
      await page.waitForFunction(() => !/analy[sz]ing|parsing|uploading/i.test(document.body.innerText), null, { timeout: 20000 }).catch(() => {});
    }
    const fields = await page.evaluate(`(${scanForm})()`);
    fieldsByJa = Object.fromEntries(fields.map((f) => [f.ja, { label: f.label, kind: f.kind }]));
    for (const f of fields) {
      const id = `${f.kind}|${keyOf(f.label)}|${f.name}`;
      if (done.has(id) || (pass === 0 && f.kind !== 'file')) continue;
      done.add(id);

      if (f.kind === 'file') {
        const what = `${f.label} ${f.context || ''} ${f.id} ${f.name}`;
        if (!resumeDone && /resume|\bcv\b/i.test(what) && !/cover/i.test(`${f.label} ${f.id} ${f.name}`) && !/autofill/i.test(what)) {
          await page.locator(`[data-ja="${f.ja}"]`).setInputFiles(resumePath);
          resumeDone = true;
          filled.push({ label: 'Resume', value: resumePath.split(/[\\/]/).pop(), from: 'resume' });
        } else if (f.required) needs.set(f.label || 'File upload', { ja: f.ja, label: f.label || 'File upload', required: true });
        continue;
      }

      const isConsent = f.kind === 'checkbox' && (NEVER.test(f.label) || f.options.length === 1 && NEVER.test(f.options[0]));
      const ans = isConsent ? null : answerFor(f, profile, bank);
      let ok = false;
      if (ans) {
        try { ok = await fillOne(page, f, ans, profile); } catch { ok = false; }
      }
      if (ok && ok !== 'already') filled.push({ label: f.label, value: ok === true ? ans.value : ok, from: ans.from });
      else if (ok !== 'already' && (f.required || isConsent || ['combobox', 'radio', 'select', 'textarea'].includes(f.kind))) {
        needs.set(f.label || f.name, { ja: f.ja, label: f.label || f.name, required: f.required, consent: isConsent });
      }
    }
    await page.waitForTimeout(800);
  }
  return { filled, needs: [...needs.values()], resumeDone, fieldsByJa };
}

// Yellow outline on every field left for the person, and a bar that says what to do.
export async function showBanner(page, { filled, needs }, title) {
  await page.evaluate(({ needs, nFilled, title }) => {
    for (const n of needs) {
      for (const el of document.querySelectorAll(`[data-ja="${n.ja}"], [data-ja^="${n.ja}-"]`)) {
        const box = el.closest('fieldset, [class*="field" i], [class*="question" i], li, div') || el;
        box.style.outline = '3px solid #f5b400';
        box.style.outlineOffset = '4px';
        box.style.borderRadius = '6px';
      }
    }
    document.getElementById('ja-bar')?.remove();
    const bar = document.createElement('div');
    bar.id = 'ja-bar';
    bar.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483647;background:#17191c;color:#fff;font:14px/1.4 system-ui,sans-serif;padding:12px 16px;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.35)';
    const req = needs.filter((n) => n.required || n.consent).length;
    bar.innerHTML = `<b>Job Agent</b> filled ${nFilled} fields for <i></i>. ` +
      (needs.length ? `<span style="color:#f5b400">${needs.length} left for you</span> (yellow${req ? `, ${req} required` : ''}). ` : '') +
      `Check everything, then press <b>Submit</b> yourself. It is marked applied on the dashboard when the thank-you page shows. ` +
      `<button style="margin-left:8px;background:none;border:1px solid #666;color:#ccc;border-radius:6px;padding:2px 8px;cursor:pointer">hide</button>`;
    bar.querySelector('i').textContent = title;
    bar.querySelector('button').onclick = () => bar.remove();
    document.body.appendChild(bar);
  }, { needs, nFilled: filled.length, title });
}

// Sends the form's values to the agent on every change and at the moment of submit,
// so answers typed just before pressing Submit are not missed.
export async function reportChanges(page) {
  await page.evaluate(`(() => {
    if (window.__jaHooked) return;
    window.__jaHooked = true;
    const snap = ${snapshotScript};
    let t;
    const send = () => { try { window.jaSnap(snap()); } catch {} };
    document.addEventListener('input', () => { clearTimeout(t); t = setTimeout(send, 300); }, true);
    document.addEventListener('change', send, true);
    document.addEventListener('submit', send, true);
    document.addEventListener('click', (e) => { if (e.target.closest('button, input[type=submit]')) send(); }, true);
  })()`);
}

// What each field holds now, by its label: read before submit to learn your answers.
export function snapshotScript() {
  const out = {};
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  for (const el of document.querySelectorAll('[data-ja]')) {
    const id = el.getAttribute('data-ja');
    const m = id.match(/^(g\d+)-\d+$/);
    if (m) {
      if (el.checked) {
        const label = clean(el.closest('label')?.innerText || document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.innerText || el.value);
        out[m[1]] = out[m[1]] ? `${out[m[1]]}; ${label}` : label;
      }
      continue;
    }
    if (el.type === 'file') continue;
    if (el.tagName === 'SELECT') out[id] = clean(el.selectedOptions[0]?.text);
    else if (el.getAttribute('role') === 'combobox') {
      const box = el.closest('[class*="container" i], [class*="select" i]') || el.parentElement;
      out[id] = clean(el.value || box?.querySelector('[class*="singleValue" i], [class*="single-value" i]')?.innerText || '');
    } else out[id] = clean(el.value);
  }
  return out;
}
