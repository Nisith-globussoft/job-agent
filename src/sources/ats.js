// Companies' own job boards: Greenhouse, Lever and Ashby publish public JSON APIs.
import { htmlToText } from '../text.js';

const get = async (url) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

async function greenhouse(board) {
  const data = await get(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true`);
  return data.jobs.map((j) => ({
    source: 'greenhouse',
    company: j.company_name || board,
    title: j.title,
    location: j.location?.name || '',
    remote: /remote/i.test(j.location?.name || ''),
    url: j.absolute_url,
    applyUrl: `https://job-boards.greenhouse.io/${board}/jobs/${j.id}`,
    form: { ats: 'greenhouse', board, id: String(j.id) },
    posted: (j.first_published || j.updated_at || '').slice(0, 10) || null,
    description: htmlToText(j.content || ''),
  }));
}

async function lever(board) {
  const data = await get(`https://api.lever.co/v0/postings/${board}?mode=json`);
  return data.map((j) => {
    const locs = [j.categories?.location, ...(j.categories?.allLocations || [])].filter(Boolean);
    const lists = (j.lists || []).map((l) => `${l.text}\n${htmlToText(l.content)}`).join('\n');
    return {
      source: 'lever',
      company: board,
      title: j.text,
      location: [...new Set(locs)].join(' / '),
      remote: j.workplaceType === 'remote',
      url: j.hostedUrl,
      applyUrl: j.applyUrl || `${j.hostedUrl}/apply`,
      form: { ats: 'lever', board, id: j.id },
      posted: j.createdAt ? new Date(j.createdAt).toISOString().slice(0, 10) : null,
      description: `${j.descriptionPlain || ''}\n${lists}\n${j.additionalPlain || ''}`,
    };
  });
}

async function ashby(board) {
  const data = await get(`https://api.ashbyhq.com/posting-api/job-board/${board}`);
  return data.jobs.filter((j) => j.isListed !== false).map((j) => ({
    source: 'ashby',
    company: board,
    title: j.title,
    location: [j.location, ...(j.secondaryLocations || []).map((s) => s.location)].filter(Boolean).join(' / '),
    remote: !!j.isRemote,
    url: j.jobUrl,
    applyUrl: j.applyUrl || `${j.jobUrl}/application`,
    form: { ats: 'ashby', board, id: j.id },
    posted: (j.publishedAt || '').slice(0, 10) || null,
    description: j.descriptionPlain || htmlToText(j.descriptionHtml || ''),
  }));
}

const FETCHERS = { greenhouse, lever, ashby };

export async function fetchAts(atsConfig, log, run) {
  const tasks = [];
  for (const [ats, boards] of Object.entries(atsConfig)) {
    if (!FETCHERS[ats]) continue;
    for (const board of boards) tasks.push([ats, board]);
  }
  const jobs = [];
  const cutoff = Date.now() - (atsConfig.maxAgeDays || 45) * 864e5;
  let i = 0;
  let done = 0;
  const failed = [];
  run?.agent('ats', 'running', `0/${tasks.length} boards`, 0);
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (i < tasks.length) {
      const [ats, board] = tasks[i++];
      try {
        const found = await FETCHERS[ats](board);
        const fresh = found.filter((j) => !j.posted || Date.parse(j.posted) >= cutoff);
        jobs.push(...fresh);
        run?.add('ats', fresh.length);
      } catch (e) {
        failed.push(`${ats}/${board}`);
        log(`  ${ats}/${board}: ${e.message}`);
      }
      run?.agent('ats', 'running', `${++done}/${tasks.length} boards`);
    }
  }));
  log(`  ATS boards: ${tasks.length} boards, ${jobs.length} recent postings`);
  run?.agent('ats', failed.length === tasks.length ? 'error' : 'done',
    `${tasks.length - failed.length}/${tasks.length} boards` + (failed.length ? `, failed: ${failed.join(', ')}` : ''));
  return jobs;
}
