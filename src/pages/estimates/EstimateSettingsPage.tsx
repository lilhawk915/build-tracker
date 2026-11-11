import { Link } from 'react-router-dom';
import { store, useData } from '../../data';
import { NumberCell, TextBlock, TextCell, useEstimating } from '../../estimator/ui';

const LOGO_LIMIT = 500 * 1024;

export function EstimateSettingsPage() {
  const { data, run, say } = useData();
  const { settings } = useEstimating();
  const company = data.company_settings[0];
  const defaults = data.markup_defaults[0];
  if (!company || !defaults) return <div className="alert" role="alert">Quote settings are missing. Reload the page to try again.</div>;
  const setCompany = (patch: Record<string, unknown>) => run(() => store.update('company_settings', 'main', patch as never), 'Saved.');
  const setDefault = (patch: Record<string, unknown>) => run(() => store.update('markup_defaults', 'main', patch as never), 'Saved.');
  const text = (label: string, key: 'name' | 'address' | 'phone' | 'email' | 'license') => (
    <div className="inrow"><span>{label}</span><TextCell className="field" label={label} value={company[key]} onCommit={(v) => setCompany({ [key]: v.trim() })} /></div>
  );
  const pct = (label: string, key: 'sales_tax_pct' | 'contingency_pct' | 'overhead_pct' | 'profit_pct') => (
    <div className="inrow"><span>{label} %</span><NumberCell className="field num" label={`Default ${label}`} value={Number(defaults[key])} onCommit={(v) => setDefault({ [key]: v ?? 0 })} /></div>
  );

  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <Link to="/estimates">← Estimates</Link>
      <h1>Quote settings</h1>
      <section className="panel stack">
        <h3>Your company, on every quote PDF</h3>
        {text('Company name', 'name')}
        {text('Address', 'address')}
        {text('Phone', 'phone')}
        {text('Email', 'email')}
        {text('License number', 'license')}
        <div className="inrow">
          <span>Logo</span>
          <span className="row">
            {company.logo_data_url && <img src={company.logo_data_url} alt="Company logo" style={{ maxHeight: 48, maxWidth: 140 }} />}
            <input type="file" accept="image/png,image/jpeg" aria-label="Upload logo" onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              if (f.size > LOGO_LIMIT) { say('err', 'That logo is over 500 KB. Use a smaller PNG or JPG.'); return; }
              const r = new FileReader();
              r.onload = () => void setCompany({ logo_data_url: String(r.result) });
              r.readAsDataURL(f);
            }} />
            {company.logo_data_url && <button className="btn tiny" onClick={() => setCompany({ logo_data_url: null })}>Remove logo</button>}
          </span>
        </div>
      </section>
      <section className="panel stack">
        <h3>Starting markups for new quotes <span className="chip">admins only</span></h3>
        <p className="muted small">Changing these never changes a quote you already started. Each quote keeps its own.</p>
        {pct('Sales tax on materials', 'sales_tax_pct')}
        {pct('Contingency', 'contingency_pct')}
        {pct('Overhead', 'overhead_pct')}
        {pct('Profit', 'profit_pct')}
      </section>
      <section className="panel stack">
        <h3>Starting terms for new quotes</h3>
        <div className="inrow"><span>Valid for (days)</span><NumberCell className="field num" label="Default days valid" value={company.default_validity_days} min={1} onCommit={(v) => v && setCompany({ default_validity_days: Math.round(v) })} /></div>
        <label className="field">Assumptions, exclusions, and conditions<TextBlock label="Default assumptions" rows={10} value={company.default_assumptions || settings.defaultAssumptions} onCommit={(v) => setCompany({ default_assumptions: v })} /></label>
      </section>
    </div>
  );
}
