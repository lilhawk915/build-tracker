import { Buffer } from 'buffer';
import { Document, Image, Page, StyleSheet, Text, View, pdf } from '@react-pdf/renderer';
import type { CompanyInfo } from './domain/types';

// The PDF library expects Node's Buffer when reading images. Without it, logos are silently dropped.
(globalThis as unknown as { Buffer: typeof Buffer }).Buffer ??= Buffer;

const usd = (cents: number) => (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

export interface ChangeOrderSheet {
  number: number; description: string; price_cents: number; date: string;
  job_name: string; client: string; address: string; quote_number?: number;
  /** Contract price before this change: original price plus earlier approved change orders. */
  contract_before_cents: number;
}

const s = StyleSheet.create({
  page: { padding: 44, fontSize: 10.5, fontFamily: 'Helvetica', color: '#1e293b' },
  header: { flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 1.5, borderBottomColor: '#1e293b', paddingBottom: 12, marginBottom: 16 },
  logo: { maxWidth: 130, maxHeight: 60, marginBottom: 4, objectFit: 'contain', objectPositionX: 0 },
  company: { fontFamily: 'Helvetica-Bold', fontSize: 13 },
  title: { fontFamily: 'Helvetica-Bold', fontSize: 20, letterSpacing: 1, textAlign: 'right' },
  meta: { textAlign: 'right', marginTop: 2 },
  info: { flexDirection: 'row', gap: 20, marginBottom: 16 },
  infoCol: { flex: 1 },
  label: { color: '#64748b', fontSize: 8, textTransform: 'uppercase', marginBottom: 2 },
  bold: { fontFamily: 'Helvetica-Bold' },
  box: { borderWidth: 0.75, borderColor: '#cbd5e1', padding: 10, marginBottom: 16, minHeight: 70 },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, width: 280, marginLeft: 'auto' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, width: 280, marginLeft: 'auto', borderTopWidth: 1.5, borderTopColor: '#1e293b', fontFamily: 'Helvetica-Bold' },
  note: { marginTop: 18 },
  sigRow: { flexDirection: 'row', gap: 20, marginTop: 30 },
  sigBlock: { flex: 1 },
  sigLine: { borderBottomWidth: 0.75, borderBottomColor: '#1e293b', height: 22 },
});

function ChangeOrderDocument({ co, company: c }: { co: ChangeOrderSheet; company: CompanyInfo }) {
  const contact = [c.address, c.phone, c.email, c.license ? `License: ${c.license}` : ''].filter(Boolean);
  const after = co.contract_before_cents + co.price_cents;
  return (
    <Document title={`Change order ${co.number} - ${co.job_name}`} author={c.name}>
      <Page size="LETTER" style={s.page}>
        <View style={s.header}>
          <View>
            {c.logoDataUrl && <Image src={c.logoDataUrl} style={s.logo} />}
            {c.name && <Text style={s.company}>{c.name}</Text>}
            {contact.map((line) => <Text key={line}>{line}</Text>)}
          </View>
          <View>
            <Text style={s.title}>CHANGE ORDER</Text>
            <Text style={[s.meta, s.bold]}>Change order #{co.number}</Text>
            <Text style={s.meta}>Date: {co.date}</Text>
            {co.quote_number ? <Text style={s.meta}>Changes Quote #{co.quote_number}</Text> : null}
          </View>
        </View>
        <View style={s.info}>
          <View style={s.infoCol}><Text style={s.label}>Client</Text><Text style={s.bold}>{co.client || ' '}</Text></View>
          <View style={s.infoCol}><Text style={s.label}>Property</Text><Text style={s.bold}>{co.address || ' '}</Text></View>
        </View>
        <Text style={s.label}>Change to the work</Text>
        <View style={s.box}><Text>{co.description}</Text></View>
        <View style={s.sumRow}><Text>Contract price before this change</Text><Text>{usd(co.contract_before_cents)}</Text></View>
        <View style={s.sumRow}><Text>{co.price_cents < 0 ? 'Credit for this change' : 'Price of this change'}</Text><Text>{usd(co.price_cents)}</Text></View>
        <View style={s.totalRow}><Text>New contract price</Text><Text>{usd(after)}</Text></View>
        <Text style={s.note}>
          This change is added to the agreement for this job and is billed on the final invoice. Work on this change starts only after this change order is signed.
        </Text>
        <View wrap={false}>
          <View style={s.sigRow}>
            <View style={s.sigBlock}><View style={s.sigLine} /><Text>Client signature</Text></View>
            <View style={{ width: 110 }}><View style={s.sigLine} /><Text>Date</Text></View>
          </View>
          <View style={s.sigRow}>
            <View style={s.sigBlock}><View style={s.sigLine} /><Text>{c.name || 'Contractor'} signature</Text></View>
            <View style={{ width: 110 }}><View style={s.sigLine} /><Text>Date</Text></View>
          </View>
        </View>
      </Page>
    </Document>
  );
}

export function renderChangeOrderPdf(co: ChangeOrderSheet, company: CompanyInfo): Promise<Blob> {
  return pdf(<ChangeOrderDocument co={co} company={company} />).toBlob();
}
