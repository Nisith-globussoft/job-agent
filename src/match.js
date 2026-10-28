// Scores a job against the resume. Hard rejects first (wrong seniority, wrong
// role, wrong country), then a 0-100 score with the reasons that produced it.
import { findSkills } from './skills.js';

const ROLE_OK = /\b(full[\s-]?stack|back[\s-]?end|mern|mean|node(\.?js)?|javascript|software (development )?engineer|software developer|sde|swe|web developer|application developer|api developer|programmer|developer|engineer)\b/i;
const ROLE_STRONG = /\b(full[\s-]?stack|back[\s-]?end|mern|node(\.?js)?|express)\b/i;
const ROLE_WRONG = /\b(data scien|data analy|machine learning|ml engineer|\bai engineer|android|ios|mobile|flutter|devops|sre|site reliability|security|qa\b|quality|test(ing)? engineer|sdet|network|hardware|embedded|firmware|salesforce|sap\b|mainframe|support engineer|solutions? (engineer|architect)|sales|account|recruit|marketing|designer|product manager|program manager|project manager|business analyst|data engineer|analytics|platform engineer|infrastructure|cloud engineer|php|wordpress|\.net|c#|golang|go developer|ruby|rails|python developer|django|scala|rust|c\+\+|unity|game|blockchain|solidity|frontend|front[\s-]?end|ui developer|react native|ux|success|people|forward deployed|sdk|container|python|kernel|compiler|database engineer|research)\b/i;
const SENIOR = /\b(senior|sr\.?|lead|staff|principal|manager|head|director|architect|vp|chief|cto|expert|specialist|ii|iii|iv|l[4-9]|sde[\s-]?(2|3|ii|iii)|engineer (2|3))\b/i;
const JUNIOR = /\b(fresher|freshers|entry[\s-]?level|junior|jr\.?|graduate|new grad|trainee|associate|intern(ship)?|sde[\s-]?(1|i)\b|engineer (1|i)\b|0\s*[-–to]+\s*[12]\s*(years?|yrs?))\b/i;
const INTERN = /\bintern(ship)?\b/i;

// Lowest "N years" a description asks for, or null.
export function minYearsRequired(text) {
  const t = text.replace(/\s+/g, ' ');
  const re = /(\d{1,2})\s*(?:\+|plus)?\s*(?:(?:-|–|to)\s*(\d{1,2})\s*)?\+?\s*(?:years?|yrs?)(?:'|’)?\s*(?:of\s+)?(?:\w+\s+){0,4}?(?:experience|exp\b)/gi;
  let min = null;
  for (const m of t.matchAll(re)) {
    const n = parseInt(m[1], 10);
    if (n > 25) continue;
    if (min === null || n < min) min = n;
  }
  const hint = t.match(/(?:minimum|at least|min\.?)\s*(?:of\s*)?(\d{1,2})\s*(?:years?|yrs?)/i);
  if (hint && min === null) min = parseInt(hint[1], 10);
  const after = t.match(/experience\s*(?:required)?\s*[:\-–]\s*(\d{1,2})\s*(?:\+|-|–|to)/i);
  if (after && min === null) min = parseInt(after[1], 10);
  return min;
}

function locationOk(job, cfg) {
  const loc = (job.location || '').toLowerCase();
  if (!loc) return true;
  // Indeed India writes "KA, IN".
  if (/(^|,\s*)IN$/.test((job.location || '').trim())) return true;
  const indian = cfg.accept.filter((a) => a !== 'remote');
  if (indian.some((a) => loc.includes(a))) return true;
  // Remote counts only when it is open to India: "Remote - US" is not.
  if (/remote/.test(loc)) return /apac|asia|anywhere|global|worldwide/.test(loc) || /^\s*remote\s*$/.test(loc);
  return false;
}

export function scoreJob(job, resume, config) {
  const reasons = [];
  const title = job.title || '';
  const desc = job.description || '';
  const reject = (why) => ({ score: 0, rejected: why, reasons: [why], matched: [], missing: [] });

  if (!locationOk(job, config.locations)) return reject(`location: ${job.location}`);
  if (!ROLE_OK.test(title)) return reject('not a developer role');
  if (ROLE_WRONG.test(title) && !ROLE_STRONG.test(title)) return reject('different specialisation');
  if (SENIOR.test(title) && !JUNIOR.test(title)) return reject('senior title');
  if (INTERN.test(title) && !config.candidate.includeInternships) return reject('internship');

  const years = job.experienceRange ? parseInt(job.experienceRange, 10) : minYearsRequired(desc);
  if (years !== null && years > config.candidate.maxYearsRequired) return reject(`asks ${years}+ years`);

  let score = 0;

  // Role fit: 0-30
  if (/\bmern\b/i.test(title)) { score += 30; reasons.push('MERN role'); }
  else if (/full[\s-]?stack/i.test(title)) { score += 27; reasons.push('full-stack role'); }
  else if (/back[\s-]?end|node/i.test(title)) { score += 25; reasons.push('backend role'); }
  else if (/software|sde|swe|developer|engineer/i.test(title)) { score += 15; reasons.push('general SWE role'); }

  // Seniority fit: 0-20
  if (years !== null && years <= 1) { score += 20; reasons.push(`asks ${years} yr`); }
  else if (JUNIOR.test(title) || JUNIOR.test(desc.slice(0, 3000))) { score += 18; reasons.push('junior / fresher'); }
  else if (years === 2) { score += 10; reasons.push('asks 2 yrs'); }
  else if (years === null) { score += 8; reasons.push('no years stated'); }

  // Skills: 0-45. Share of the JD's tech that the resume has, plus core-stack bonus.
  const jdSkills = findSkills(`${title}\n${desc}`);
  const matched = jdSkills.filter((s) => resume.skills.includes(s));
  const missing = jdSkills.filter((s) => !resume.skills.includes(s));
  if (jdSkills.length) {
    score += Math.round(35 * (matched.length / jdSkills.length));
    const core = ['Node.js', 'Express', 'React', 'MongoDB'].filter((s) => matched.includes(s)).length;
    score += core * 2.5;
    reasons.push(`${matched.length}/${jdSkills.length} skills match`);
  } else {
    score += 10;
    reasons.push('no skills listed');
  }

  // Location: 0-5
  if (/remote/i.test(job.location) || job.remote) { score += 5; reasons.push('remote'); }
  else if (/kolkata|west bengal|\bwb\b/i.test(job.location)) { score += 5; reasons.push('near home'); }

  return { score: Math.min(100, Math.round(score)), rejected: null, reasons, matched, missing, years };
}
