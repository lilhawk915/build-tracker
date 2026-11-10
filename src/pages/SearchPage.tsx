import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Empty, FileLink, Status } from '../components/ui';
import { useData } from '../data';
import { highlightParts, jobYear, KIND_LABEL, search, type JobHit, type SearchKind } from '../domain/search';
import { JOB_TYPES, jobTypeLabel } from '../domain/types';

const COLLAPSED = 6;

function Marked({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlightParts(text, query).map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
    </>
  );
}

function Hit({ hit, query }: { hit: JobHit; query: string }) {
  const [all, setAll] = useState(false);
  const { job, records } = hit;
  const shown = all ? records : records.slice(0, COLLAPSED);
  const facts = [jobTypeLabel(job), jobYear(job), job.address, job.plan_name, job.client_name].filter(Boolean).join(' · ');
  return (
    <article className="hit">
      <header>
        <div>
          <Link to={`/jobs/${job.id}/record`}><h2><Marked text={job.name} query={query} /></h2></Link>
          <span className="muted small"><Marked text={facts} query={query} /></span>
        </div>
        <Status s={job.status} />
      </header>
      {shown.map((r) => (
        <div className="hitrow" key={r.key}>
          <span className="kind">{KIND_LABEL[r.kind]}</span>
          <div>
            <Link to={`/jobs/${job.id}/${r.tab}`}><Marked text={r.title} query={query} /></Link>
            {r.detail && <div className="small muted"><Marked text={r.detail} query={query} /></div>}
          </div>
          {r.filePath ? <FileLink path={r.filePath} label="Open file" /> : <span />}
        </div>
      ))}
      {records.length > COLLAPSED && !all && (
        <div className="hitrow">
          <button className="linkish" onClick={() => setAll(true)}>Show all {records.length} matches</button>
        </div>
      )}
    </article>
  );
}

export function SearchPage() {
  const { data } = useData();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const kind = (params.get('kind') ?? '') as SearchKind | '';
  const year = params.get('year') ?? '';
  const vendorId = params.get('sub') ?? '';
  const jobType = params.get('type') ?? '';

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };

  const hits = useMemo(() => search(data, q, { kind, year, vendorId, jobType }), [data, q, kind, year, vendorId, jobType]);
  const years = [...new Set(data.jobs.map(jobYear).filter(Boolean))].sort().reverse();
  const vendors = [...data.vendors].sort((a, b) => a.name.localeCompare(b.name));
  const filtered = Boolean(q.trim() || kind || year || vendorId || jobType);
  const clear = () => setParams(new URLSearchParams(), { replace: true });

  return (
    <div className="stack">
      <h1>All jobs</h1>
      <input
        type="search"
        className="bigsearch"
        aria-label="Search all jobs"
        placeholder="A color, paint code, sub, address, client, drawing…"
        value={q}
        onChange={(e) => set('q', e.target.value)}
      />
      <div className="filters">
        <label className="field">
          <span>Show</span>
          <select value={kind} onChange={(e) => set('kind', e.target.value)}>
            <option value="">Everything</option>
            {(Object.entries(KIND_LABEL) as [SearchKind, string][]).filter(([k]) => k !== 'job').map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Type of job</span>
          <select value={jobType} onChange={(e) => set('type', e.target.value)}>
            <option value="">Any type</option>
            {JOB_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Year</span>
          <select value={year} onChange={(e) => set('year', e.target.value)}>
            <option value="">Any year</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Sub used</span>
          <select value={vendorId} onChange={(e) => set('sub', e.target.value)}>
            <option value="">Any sub</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </label>
      </div>
      <p className="muted small" role="status">
        {hits.length} of {data.jobs.length} job{data.jobs.length === 1 ? '' : 's'}.
        {' '}Search reads file names and titles, not the text inside a drawing.
      </p>
      {hits.length === 0 ? (
        <Empty>
          {data.jobs.length === 0 ? 'Add your first job from the Today page.' : (
            <>
              {filtered ? 'No jobs match. Try fewer words or ' : 'No jobs yet. '}
              {filtered && <button className="linkish" onClick={clear}>clear the search</button>}
            </>
          )}
        </Empty>
      ) : hits.map((h) => <Hit key={h.job.id} hit={h} query={q} />)}
    </div>
  );
}
