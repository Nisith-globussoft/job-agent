# job-agent

Collects backend / full-stack / MERN jobs from many sources, scores each one against your
resume, and writes a ranked page with an Apply link for each match.

## Run

```bash
npm install
node src/cli.js run          # fetch everything, score it, write data/report.html
node src/cli.js top 30       # best 30 in the terminal
node src/cli.js mark <id> applied     # or skipped / shortlisted
node src/cli.js rescore      # after editing config.json, without fetching again
```

Open `data/report.html` in a browser.

## Dashboard

```bash
npm start                    # http://localhost:4317
```

Shows each agent live (running / waiting / done / error / planned) with its count, the totals
(collected, matches, new today, shortlisted, applied), collected vs matched per source, why jobs
were dropped, applications per day, every run, and the job list with Apply / Applied / Shortlist /
Skip. "Run now" starts a run in the background and the page follows it. It listens on
127.0.0.1 only.

## Sources

| Source | How | Notes |
|---|---|---|
| Greenhouse, Lever, Ashby | the companies' own public job-board APIs | best quality; list in `config.json` -> `ats` |
| Indeed India | `ts-jobspy` | no login |
| LinkedIn | `ts-jobspy`, guest job listings | no login, your account is never used |
| Naukri | `ts-jobspy` | currently blocked (HTTP 406) |

## Matching

A job is dropped when it is outside India / India-open remote, is not a developer role, is a
different specialisation (data, mobile, DevOps, QA, frontend-only...), has a senior title, or
asks for more than `maxYearsRequired` years. The rest get 0-100:

- role fit (MERN > full-stack > backend > general SWE): up to 30
- seniority fit (fresher / 0-1 yrs best): up to 20
- share of the JD's skills that are on your resume, plus Node/Express/React/MongoDB: up to 45
- remote or near Kolkata: up to 5

Every score lists its reasons, and the skills you have (green) and lack (red).

## Files

- `config.json` -- search terms, locations, company boards, years, minimum score
- `data/resume.pdf` -- the resume the skills are read from
- `data/jobs.json` -- every job seen, with its status (a re-run never resets a status)
- `data/report.html` -- the ranked page
