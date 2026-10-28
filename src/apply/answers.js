// Decides what to put in a form field from its question text.
// Order: answers you gave on an earlier form (data/answers.json), then the rules below.
// A field with no answer is left for you and highlighted.
import fs from 'node:fs';

const BANK = 'data/answers.json';
export const keyOf = (label) => (label || '').toLowerCase().replace(/[✱*]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 200);

export function loadBank() {
  try { return JSON.parse(fs.readFileSync(BANK, 'utf8')); } catch { return {}; }
}

export function learn(pairs) {
  const bank = loadBank();
  let added = 0;
  for (const [label, value] of pairs) {
    const k = keyOf(label);
    if (!k || !value || bank[k] === value) continue;
    bank[k] = value;
    added++;
  }
  fs.writeFileSync(BANK, JSON.stringify(bank, null, 1));
  return added;
}

// Questions never answered for you: consent and declarations are yours to accept.
export const NEVER = /\b(i agree|i consent|consent|acknowledge|privacy (policy|notice)|terms|certify|declare|attest|signature|captcha)\b/i;

// Equal-opportunity questions: answered with the "decline" option when there is one.
const EEO = /\b(gender|sex\b|race|ethnicity|veteran|disability|sexual orientation|pronoun|hispanic|latino)\b/i;
const DECLINE = /decline|prefer not|don.?t wish|do not wish|not to (say|answer|disclose)|rather not/i;

export function rules(p) {
  const loc = `${p.city}, ${p.state}, ${p.country}`;
  return [
    [/\bfirst name|given name|preferred name/, p.firstName],
    [/\blast name|surname|family name/, p.lastName],
    [/^(full )?name$|^your name|full name|legal name|^name\b(?!.*(company|school|university|reference|manager))/, `${p.firstName} ${p.lastName}`],
    [/e-?mail/, p.email],
    [/country code/, p.phoneCountryCode],
    [/phone|mobile|contact number|whatsapp/, p.phone],
    [/linkedin/, p.linkedin],
    [/github/, p.github],
    [/portfolio|personal (web)?site|^website|other website|blog/, p.portfolio],
    [/current (company|employer|organi[sz]ation)|^company$|^org$|most recent (company|employer)/, p.currentCompany],
    [/current (job )?(title|role|designation|position)/, p.currentTitle],
    [/^country\b|country of residence|which country|what country/, p.country],
    [/^city|current city|which city/, p.city],
    [/current location|^location|where are you (currently )?(based|located)|your location|address/, loc],
    [/notice period|earliest .*(start|join)|when can you (start|join)|availability to (start|join)/, p.noticePeriod],
    [/expected (ctc|salary|compensation|pay)|salary expectation|desired (salary|compensation)/, p.expectedCtc],
    [/current (ctc|salary|compensation)/, p.currentCtc],
    [/years? of (professional |relevant |work |total )?experience|how many years|total experience/, p.yearsExperience],
    [/authori[sz]ed to work|legally (eligible|allowed|permitted).*work|right to work|work (permit|authori[sz]ation)/, p.workAuthorizedIndia],
    [/sponsor/, p.needsSponsorship],
    [/relocat/, p.willingToRelocate],
    [/(work|comfortable|able).*office|on-?site|in-?office|hybrid/, p.willingToWorkFromOffice],
    [/how did you (hear|find|learn)|where did you (hear|find)|referral source|^source$/, p.howDidYouHear],
    [/highest (level of )?(education|degree|qualification)|education (level|status)/, p.degree],
    [/(degree|qualification)( name)?$|field of study|major|discipline/, p.degreeName],
    [/(school|college|university|institut)/, p.college],
    [/graduat.*year|year of (graduation|passing)|passing year|batch/, p.graduationYear],
    [/cgpa|gpa|percentage|grade/, p.cgpa],
  ];
}

export function answerFor(field, profile, bank) {
  const label = field.label || field.name || '';
  const k = keyOf(label);
  if (!k || NEVER.test(label)) return null;
  if (bank[k]) return { value: bank[k], from: 'remembered' };
  if (EEO.test(label) && field.options) {
    const opt = field.options.find((o) => DECLINE.test(o));
    return opt ? { value: opt, from: 'decline' } : null;
  }
  for (const [re, value] of rules(profile)) {
    if (re.test(k) && value) return { value, from: 'profile' };
  }
  return null;
}

// Best option for an answer: exact, then starts-with, then contains, then yes/no by meaning.
export function pickOption(options, value) {
  const n = (s) => keyOf(s);
  const v = n(value);
  const opts = options.map((o, i) => ({ o, i, k: n(o) })).filter((x) => x.k && !/^select|^choose|^please select/.test(x.k));
  return (
    opts.find((x) => x.k === v) ||
    opts.find((x) => x.k.startsWith(v) || v.startsWith(x.k)) ||
    opts.find((x) => x.k.includes(v)) ||
    (/^(yes|no)$/.test(v) ? opts.find((x) => x.k.split(' ')[0] === v) : null) ||
    (v === '0' ? opts.find((x) => /^(0|less than|fresher|none|no experience|0 1|under 1)/.test(x.k)) : null) ||
    null
  );
}
