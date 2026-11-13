import { Buffer } from 'buffer';
import { Document, Font, Image, Page, StyleSheet, Text, View, pdf } from '@react-pdf/renderer';
import { validUntil } from './domain/house/defaults';
import { priceProject } from './domain/pricing/resolve';
import { DIVISIONS, type CatalogItem, type Project, type Settings } from './domain/types';
export type QuoteMode = 'client' | 'internal';

// The PDF library expects Node's Buffer when reading images. Without it, logos are silently dropped.
(globalThis as unknown as { Buffer: typeof Buffer }).Buffer ??= Buffer;
// Whole words only: no "encapsula-tion" breaks.
Font.registerHyphenationCallback((word) => [word]);

const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const pct = (n: number) => `${Math.round(n * 100) / 100}%`;
const qty = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });

const s = StyleSheet.create({
  page: { padding: 40, paddingTop: 44, paddingBottom: 48, fontSize: 9.5, fontFamily: 'Helvetica', color: '#1e293b' },
  stamp: { position: 'absolute', top: 14, left: 40, right: 40, textAlign: 'center', color: '#b91c1c', fontFamily: 'Helvetica-Bold', fontSize: 11 },
  footer: { position: 'absolute', bottom: 22, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between', color: '#64748b', fontSize: 8 },
  header: { flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 1.5, borderBottomColor: '#1e293b', paddingBottom: 10, marginBottom: 12 },
  logo: { maxWidth: 130, maxHeight: 60, marginBottom: 4, objectFit: 'contain', objectPositionX: 0 },
  company: { fontFamily: 'Helvetica-Bold', fontSize: 13 },
  title: { fontFamily: 'Helvetica-Bold', fontSize: 16, textAlign: 'right' },
  meta: { textAlign: 'right', marginTop: 2 },
  info: { flexDirection: 'row', gap: 20, marginBottom: 12 },
  infoCol: { flex: 1 },
  label: { color: '#64748b', fontSize: 8, textTransform: 'uppercase', marginBottom: 1 },
  bold: { fontFamily: 'Helvetica-Bold' },
  tableHead: { flexDirection: 'row', backgroundColor: '#334155', color: 'white', paddingVertical: 3, paddingHorizontal: 4, fontFamily: 'Helvetica-Bold', fontSize: 8 },
  row: { flexDirection: 'row', paddingVertical: 2.5, paddingHorizontal: 4, borderBottomWidth: 0.5, borderBottomColor: '#e2e8f0' },
  divisionRow: { flexDirection: 'row', paddingVertical: 3, paddingHorizontal: 4, backgroundColor: '#e2e8f0', fontFamily: 'Helvetica-Bold' },
  totalRow: { flexDirection: 'row', paddingVertical: 5, paddingHorizontal: 4, borderTopWidth: 1.5, borderTopColor: '#1e293b', fontFamily: 'Helvetica-Bold', fontSize: 11 },
  right: { textAlign: 'right' },
  summary: { marginTop: 10, marginLeft: 'auto', width: 240 },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 1.5 },
  sectionTitle: { fontFamily: 'Helvetica-Bold', fontSize: 10.5, marginTop: 14, marginBottom: 4 },
  sigRow: { flexDirection: 'row', gap: 20, marginTop: 26 },
  sigBlock: { flex: 1 },
  qbox: { width: 230, backgroundColor: '#f1f5f9' },
  qboxTitle: { backgroundColor: '#475569', color: 'white', fontFamily: 'Helvetica-Bold', fontSize: 15, paddingVertical: 6, paddingHorizontal: 8 },
  qboxRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, paddingHorizontal: 8 },
  qboxTotal: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, paddingHorizontal: 8, backgroundColor: '#475569', color: 'white', fontFamily: 'Helvetica-Bold', fontSize: 12 },
  sigLine: { borderBottomWidth: 0.75, borderBottomColor: '#1e293b', height: 22 },
});

const longDate = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : iso);

const COL = { item: { flex: 1 }, q: { width: 44 }, unit: { width: 46 }, m: { width: 58 }, l: { width: 58 }, mt: { width: 62 }, lt: { width: 62 }, t: { width: 66 } };

interface QuoteProps {
  mode: QuoteMode;
  project: Project;
  catalog: CatalogItem[];
  settings: Settings;
  versionLabel?: string;
}

function QuoteDocument({ mode, project, catalog, settings, versionLabel }: QuoteProps) {
  const { lines, totals, divisions, unverifiedCount, markups: m } = priceProject(project, catalog, settings);
  const c = settings.company;
  const through = validUntil(project.date, project.validityDays);
  const depositPct = project.depositPct ?? 0;
  const deposit = Math.round(totals.grandTotal * depositPct) / 100;
  const { counted } = priceProject(project, catalog, settings);
  const detail = (l: (typeof lines)[number], note: string) => {
    const points = (l.description ?? '').split('\n').map((x) => x.trim()).filter(Boolean);
    return (
      <View key={l.key} wrap={false} style={{ marginBottom: 7 }}>
        <Text style={s.bold}>{l.name}{note ? <Text style={{ fontFamily: 'Helvetica', color: '#64748b' }}>{`  ·  ${note}`}</Text> : null}</Text>
        {points.map((x, i) => <Text key={i} style={{ paddingLeft: 10 }}>{`•  ${x}`}</Text>)}
      </View>
    );
  };
  const contact = [c.address, c.phone, c.email, c.license ? `License: ${c.license}` : ''].filter(Boolean);

  return (
    <Document title={`Quote - ${project.clientName || project.address}`} author={c.name}>
      <Page size="LETTER" style={s.page} orientation={mode === 'internal' ? 'landscape' : 'portrait'}>
        {unverifiedCount > 0 && (
          <Text style={s.stamp} fixed>
            DRAFT – placeholder pricing. {unverifiedCount} lines are not real prices. Do not send.
          </Text>
        )}
        <View style={s.footer} fixed>
          <Text>{mode === 'internal' ? 'INTERNAL - contains cost and markup. Do not send to client.' : c.name}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>

        <View style={s.header}>
          <View>
            {c.logoDataUrl && <Image src={c.logoDataUrl} style={s.logo} />}
            {c.name && <Text style={s.company}>{c.name}</Text>}
            {contact.map((line) => (
              <Text key={line}>{line}</Text>
            ))}
          </View>
          {mode === 'client' ? (
            <View style={s.qbox}>
              <Text style={s.qboxTitle}>{project.quoteNumber ? `Quote #${project.quoteNumber}` : 'Quote'}</Text>
              {project.date ? <View style={s.qboxRow}><Text>Date</Text><Text>{longDate(project.date)}</Text></View> : null}
              {through ? <View style={s.qboxRow}><Text>Good through</Text><Text>{longDate(through)}</Text></View> : null}
              {versionLabel ? <View style={s.qboxRow}><Text>Version</Text><Text>{versionLabel}</Text></View> : null}
              <View style={s.qboxTotal}><Text>Total</Text><Text>{usd(totals.grandTotal)}</Text></View>
            </View>
          ) : (
          <View>
            <Text style={s.title}>Internal Estimate</Text>
            {project.quoteNumber ? <Text style={[s.meta, s.bold]}>Quote #{project.quoteNumber}</Text> : null}
            {project.date && <Text style={s.meta}>Date: {project.date}</Text>}
            {through && <Text style={s.meta}>Valid through: {through}</Text>}
            {versionLabel && <Text style={s.meta}>Version: {versionLabel}</Text>}
          </View>
          )}
        </View>

        <View style={s.info}>
          <View style={s.infoCol}>
            <Text style={s.label}>Client</Text>
            <Text style={s.bold}>{project.clientName || ' '}</Text>
          </View>
          <View style={s.infoCol}>
            <Text style={s.label}>Property</Text>
            <Text style={s.bold}>{project.address || ' '}</Text>
          </View>
          {project.kind === 'house' && (
            <View style={s.infoCol}>
              <Text style={s.label}>Heated area</Text>
              <Text style={s.bold}>{qty(project.inputs.heatedSqft)} sq ft</Text>
            </View>
          )}
        </View>
        {project.notes.trim() !== '' && (
          <View style={{ marginBottom: 10 }}>
            <Text style={s.label}>Notes</Text>
            <Text>{project.notes}</Text>
          </View>
        )}

        {mode === 'client' ? (
          <View>
            <View style={s.tableHead} fixed>
              <Text style={{ flex: 1 }}>{project.kind === 'custom' ? 'Scope of work' : 'Division'}</Text>
              <Text style={[{ width: 100 }, s.right]}>Amount</Text>
            </View>
            {divisions
              .filter((d) => d.clientAmount !== 0 || (project.kind === 'custom' && counted.some((l) => l.division === d.division)))
              .map((d) => (
                <View key={d.division} wrap={false}>
                  <View style={project.kind === 'custom' ? s.divisionRow : s.row}>
                    <Text style={{ flex: 1 }}>{d.division}</Text>
                    <Text style={[{ width: 100 }, s.right]}>{usd(d.clientAmount)}</Text>
                  </View>
                  {/* A custom quote lists its scope items by name, with no prices, like a contractor's scope sheet. */}
                  {project.kind === 'custom' &&
                    counted
                      .filter((l) => l.division === d.division)
                      .map((l) => (
                        <View style={s.row} key={l.key}>
                          <Text style={{ flex: 1, paddingLeft: 10 }}>{l.name}{l.tag === 'optional' ? ' (optional)' : ''}</Text>
                        </View>
                      ))}
                </View>
              ))}
            <View style={s.totalRow} wrap={false}>
              <Text style={{ flex: 1 }}>Total</Text>
              <Text style={[{ width: 120 }, s.right]}>{usd(totals.grandTotal)}</Text>
            </View>
          </View>
        ) : (
          <View>
            <View style={s.tableHead} fixed>
              <Text style={COL.item}>Item</Text>
              <Text style={[COL.q, s.right]}>Qty</Text>
              <Text style={[COL.unit, { paddingLeft: 4 }]}>Unit</Text>
              <Text style={[COL.m, s.right]}>Mat/unit</Text>
              <Text style={[COL.l, s.right]}>Labor/unit</Text>
              <Text style={[COL.mt, s.right]}>Material</Text>
              <Text style={[COL.lt, s.right]}>Labor</Text>
              <Text style={[COL.t, s.right]}>Total</Text>
            </View>
            {DIVISIONS.map((division) => {
              const own = lines.filter((l) => l.division === division);
              if (own.length === 0) return null;
              const sum = divisions.find((d) => d.division === division);
              const lineRow = (l: (typeof own)[number]) => (
                <View style={s.row} key={l.key} wrap={false}>
                  <Text style={COL.item}>
                    {l.name}
                    {l.hasGrades ? ` (${l.grade})` : ''}
                    {l.unverified ? ' *' : ''}
                  </Text>
                  <Text style={[COL.q, s.right]}>{qty(l.qty)}</Text>
                  <Text style={[COL.unit, { paddingLeft: 4 }]}>{l.unit}</Text>
                  <Text style={[COL.m, s.right]}>{usd(l.materialUnit)}</Text>
                  <Text style={[COL.l, s.right]}>{usd(l.laborUnit)}</Text>
                  <Text style={[COL.mt, s.right]}>{usd(l.material)}</Text>
                  <Text style={[COL.lt, s.right]}>{usd(l.labor)}</Text>
                  <Text style={[COL.t, s.right]}>{usd(l.total)}</Text>
                </View>
              );
              return (
                <View key={division}>
                  {/* Header and first line stay together, so a header is never stranded at a page bottom. */}
                  <View wrap={false}>
                    <View style={s.divisionRow}>
                      <Text style={{ flex: 1 }}>{division}</Text>
                      <Text style={[COL.mt, s.right]}>{usd(sum?.material ?? 0)}</Text>
                      <Text style={[COL.lt, s.right]}>{usd(sum?.labor ?? 0)}</Text>
                      <Text style={[COL.t, s.right]}>{usd(sum?.direct ?? 0)}</Text>
                    </View>
                    {lineRow(own[0])}
                  </View>
                  {own.slice(1).map(lineRow)}
                </View>
              );
            })}
            {unverifiedCount > 0 && <Text style={{ marginTop: 4, color: '#b91c1c' }}>* Unverified placeholder price</Text>}
            <View style={s.summary} wrap={false}>
              {(
                [
                  ['Material', totals.material],
                  ['Labor', totals.labor],
                  [`Sales tax on materials (${m.salesTaxPct}%)`, totals.tax],
                  ['Subtotal', totals.subtotal],
                  [`Contingency (${m.contingencyPct}%)`, totals.contingency],
                  [`Overhead (${m.overheadPct}%)`, totals.overhead],
                  [m.profitAmount !== null ? 'Profit (flat amount)' : `Profit (${m.profitPct}%)`, totals.profit],
                ] as [string, number][]
              ).map(([label, value]) => (
                <View style={s.sumRow} key={label}>
                  <Text>{label}</Text>
                  <Text>{usd(value)}</Text>
                </View>
              ))}
              <View style={s.totalRow}>
                <Text style={{ flex: 1 }}>Grand total</Text>
                <Text>{usd(totals.grandTotal)}</Text>
              </View>
              {project.kind === 'house' && (
                <View style={s.sumRow}>
                  <Text>Cost per heated sq ft</Text>
                  <Text>{usd(totals.costPerSqft)}</Text>
                </View>
              )}
            </View>
          </View>
        )}

        {/* What each item covers, in words. Options that are not in the price are listed with their price. */}
        {mode === 'client' && project.kind === 'custom' && lines.some((l) => (l.description ?? '').trim() || l.tag === 'not_included') && (
          <View>
            <Text style={s.sectionTitle} minPresenceAhead={30}>Scope details</Text>
            {lines.filter((l) => l.tag !== 'not_included' && (l.description ?? '').trim()).map((l) => detail(l, l.tag === 'optional' ? 'Optional' : ''))}
            {lines.filter((l) => l.tag === 'not_included').map((l) => detail(l, l.clientPrice != null ? `Option, not included in the total: ${usd(l.clientPrice)}` : 'Option, not included in the total'))}
          </View>
        )}

        {project.assumptions.trim() !== '' && (
          <View>
            <Text style={s.sectionTitle} minPresenceAhead={20}>
              Assumptions and exclusions
            </Text>
            <Text>{project.assumptions}</Text>
          </View>
        )}

        {mode === 'client' && depositPct > 0 && (
          <View wrap={false}>
            <Text style={s.sectionTitle}>Payment terms</Text>
            <Text>
              {pct(depositPct)} deposit ({usd(deposit)}) is due when this quote is signed. Material is ordered and the work is scheduled once the deposit is received.
            </Text>
            <Text>The balance ({usd(totals.grandTotal - deposit)}) is due on completion.</Text>
          </View>
        )}

        {mode === 'client' && (
        <View wrap={false}>
          <Text style={s.sectionTitle}>Acceptance</Text>
          <Text>
            By signing below, the client accepts this quote and its terms. The signed quote is the agreement for this work.
          </Text>
          {through ? <Text>This quote is good through {longDate(through)}, because material prices change.</Text> : null}
          <Text>Any change to this scope needs a signed change order, with its price, before that work is done.</Text>
          <View style={s.sigRow}>
            <View style={s.sigBlock}>
              <View style={s.sigLine} />
              <Text>Client signature</Text>
            </View>
            <View style={{ width: 110 }}>
              <View style={s.sigLine} />
              <Text>Date</Text>
            </View>
          </View>
          <View style={s.sigRow}>
            <View style={s.sigBlock}>
              <View style={s.sigLine} />
              <Text>{c.name || 'Contractor'} signature</Text>
            </View>
            <View style={{ width: 110 }}>
              <View style={s.sigLine} />
              <Text>Date</Text>
            </View>
          </View>
        </View>
        )}
      </Page>
    </Document>
  );
}

export function renderQuotePdf(props: QuoteProps): Promise<Blob> {
  return pdf(<QuoteDocument {...props} />).toBlob();
}
