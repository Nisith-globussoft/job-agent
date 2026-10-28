// Runs inside the application page. Tags every visible form control with
// data-ja and returns what it is, its question text, whether it is required, and its options.
export function scanForm() {
  const clean = (s) => (s || '').replace(/\s+/g, ' ').replace(/[*✱]/g, '').trim();
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
  };
  const labelOf = (el) => {
    const byId = (ids) => ids.split(/\s+/).map((i) => document.getElementById(i)?.innerText || '').join(' ');
    if (el.getAttribute('aria-labelledby')) {
      const t = clean(byId(el.getAttribute('aria-labelledby')));
      if (t) return t;
    }
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l && clean(l.innerText)) return clean(l.innerText);
    }
    const wrap = el.closest('label');
    if (wrap) {
      // A label that wraps a select also holds every option's text: drop it.
      const copy = wrap.cloneNode(true);
      copy.querySelectorAll('select, option, ul, [role="listbox"]').forEach((x) => x.remove());
      if (clean(copy.innerText)) return clean(copy.innerText);
    }
    if (el.getAttribute('aria-label')) return clean(el.getAttribute('aria-label'));
    // Nearest ancestor that holds a label-ish element.
    let p = el.parentElement;
    for (let i = 0; p && i < 6; i++, p = p.parentElement) {
      const l = p.querySelector('label, legend, .application-label, [class*="label" i], [class*="question" i]');
      if (l && !l.contains(el) && clean(l.innerText)) return clean(l.innerText).slice(0, 300);
    }
    return clean(el.getAttribute('placeholder') || el.name || '');
  };
  const requiredOf = (el, label) =>
    el.required || el.getAttribute('aria-required') === 'true' || /\*/.test(el.closest('div,fieldset,li')?.querySelector('label,legend')?.innerText || '') || /\(required\)/i.test(label);

  const out = [];
  let n = 0;
  const seenGroups = new Set();
  for (const el of document.querySelectorAll('input, textarea, select, [role="combobox"]')) {
    const type = (el.getAttribute('type') || el.tagName).toLowerCase();
    if (['hidden', 'submit', 'button', 'image', 'reset', 'search'].includes(type)) continue;
    if (type !== 'file' && !visible(el)) continue;
    if (el.closest('[aria-hidden="true"]') && type !== 'file') continue;

    if (type === 'radio' || type === 'checkbox') {
      // One entry per group of radios / checkboxes, with the choices as options.
      // Same-name inputs are one question; the group is the smallest box holding them all.
      const sel = el.name ? `input[type="${type}"][name="${CSS.escape(el.name)}"]` : `input[type="${type}"]`;
      let group = el.closest('fieldset, [role="radiogroup"], [role="group"]');
      if (!group && el.name) {
        const total = document.querySelectorAll(sel).length;
        group = el.parentElement;
        while (group && group.querySelectorAll(sel).length < total) group = group.parentElement;
      }
      group ||= el.parentElement?.parentElement;
      if (!group || seenGroups.has(group)) continue;
      seenGroups.add(group);
      const boxes = [...group.querySelectorAll(sel)];
      const id = `g${n++}`;
      boxes.forEach((b, i) => b.setAttribute('data-ja', `${id}-${i}`));
      // The question sits in a legend or a label-ish box at or just above the group.
      let question = '';
      let starred = false;
      // Stop climbing once a box holds other questions' inputs too: their labels are not ours.
      for (let p = group, i = 0; p && i < 4 && !question && p.querySelectorAll('input, select, textarea').length <= boxes.length; i++, p = p.parentElement) {
        const q = [...p.querySelectorAll('legend, .application-label, [class*="label" i], [class*="question" i], label')]
          .find((x) => !x.querySelector('input') && !x.contains(group) && clean(x.innerText));
        question = q ? clean(q.innerText) : '';
        starred = !!q && /[*✱]/.test(q.innerText);
      }
      const label = clean(question || group.getAttribute('aria-label') || (boxes.length === 1 ? clean(el.closest('label')?.innerText) || labelOf(el) : ''));
      out.push({ ja: id, kind: type, label, required: boxes.some((b) => b.required) || starred,
        options: boxes.map((b) => clean(b.closest('label')?.innerText || document.querySelector(`label[for="${CSS.escape(b.id)}"]`)?.innerText || b.value)),
        checked: boxes.map((b) => b.checked) });
      continue;
    }

    const id = `f${n++}`;
    el.setAttribute('data-ja', id);
    const label = labelOf(el);
    const d = { ja: id, kind: el.getAttribute('role') === 'combobox' && el.tagName !== 'SELECT' ? 'combobox' : el.tagName === 'SELECT' ? 'select' : type === 'textarea' ? 'textarea' : type,
      label, name: el.name || '', id: el.id || '', required: requiredOf(el, label), value: el.value || '' };
    if (el.tagName === 'SELECT') d.options = [...el.options].map((o) => clean(o.text)).filter(Boolean);
    if (type === 'file') {
      d.accept = el.accept || '';
      // File inputs hide behind an "Attach" button: the question is in the box around it.
      let p = el.parentElement;
      for (let i = 0; p && i < 5 && clean(p.innerText).length < 15; i++) p = p.parentElement;
      d.context = clean(p?.innerText || '').slice(0, 120);
    }
    out.push(d);
  }
  return out;
}
