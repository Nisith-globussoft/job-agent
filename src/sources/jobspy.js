// Indeed and LinkedIn (guest listings, no login) through ts-jobspy.
import { scrapeJobs } from 'ts-jobspy';

export async function fetchJobspy(search, log, run) {
  const jobs = [];
  for (const site of search.jobspySites) {
    run?.agent(site, 'running', 'starting', 0);
    let failed = 0;
    for (const [i, term] of search.terms.entries()) {
      run?.agent(site, 'running', `"${term}" (${i + 1}/${search.terms.length})`);
      const result = await scrapeJobs({
        sites: [site],
        searchTerm: term,
        location: search.location,
        country: search.country,
        resultsWanted: search.resultsPerSite,
        hoursOld: search.hoursOld,
        timeoutMs: 180000,
        descriptionFormat: 'plain',
        ...(site === 'linkedin' ? { linkedin: { fetchDescription: search.linkedinDescriptions } } : {}),
      });
      const s = result.meta.sites[0];
      const err = s.error ? ' -- ' + (s.error.message || s.error) : '';
      log(`  ${site.padEnd(9)} "${term}": ${s.status}, ${s.jobs} jobs${err}`);
      if (s.status === 'error') failed++;
      for (const j of result.jobs) {
        jobs.push({
          source: j.site,
          company: j.company || '',
          title: j.title || '',
          location: j.location || '',
          remote: !!j.isRemote,
          url: j.jobUrl,
          applyUrl: j.jobUrlDirect || j.jobUrl,
          posted: j.datePosted || null,
          description: j.description || '',
          emails: j.emails || [],
          experienceRange: j.experienceRange || null,
        });
      }
      run?.add(site, result.jobs.length);
    }
    if (failed === search.terms.length) run?.agent(site, 'error', 'every search failed');
    else run?.agent(site, 'done', failed ? `${failed} searches failed` : `${search.terms.length} searches`);
  }
  return jobs;
}
