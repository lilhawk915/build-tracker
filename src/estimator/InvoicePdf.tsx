import { Buffer } from 'buffer';
import { Document, Image, Page, StyleSheet, Text, View, pdf } from '@react-pdf/renderer';
import { invoiceBalance, invoiceTotal } from '../domain/invoice';
import type { Invoice } from '../domain/types';
import type { CompanyInfo } from './domain/types';

// The PDF library expects Node's Buffer when reading images. Without it, logos are silently dropped.
(globalThis as unknown as { Buffer: typeof Buffer }).Buffer ??= Buffer;

const usd = (cents: number) => (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const longDate = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '');

const s = StyleSheet.create({
  page: { padding: 44, fontSize: 10, fontFamily: 'Helvetica', color: '#1e293b' },
  header: { flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 1.5, borderBottomColor: '#1e293b', paddingBottom: 12, marginBottom: 16 },
  logo: { maxWidth: 130, maxHeight: 60, marginBottom: 4, objectFit: 'contain', objectPositionX: 0 },
  company: { fontFamily: 'Helvetica-Bold', fontSize: 13 },
  title: { fontFamily: 'Helvetica-Bold', fontSize: 20, letterSpacing: 2, textAlign: 'right' },
  metaRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 2 },
  metaLabel: { width: 70, color: '#475569' },
  metaValue: { width: 110 },
  info: { flexDirection: 'row', gap: 20, marginBottom: 16 },
  infoCol: { flex: 1 },
  label: { color: '#64748b', fontSize: 8, textTransform: 'uppercase', marginBottom: 2 },
  bold: { fontFamily: 'Helvetica-Bold' },
  head: { flexDirection: 'row', backgroundColor: '#e2e8f0', paddingVertical: 6, paddingHorizontal: 6, fontFamily: 'Helvetica-Bold' },
  row: { flexDirection: 'row', paddingVertical: 8, paddingHorizontal: 6, borderBottomWidth: 0.5, borderBottomColor: '#e2e8f0' },
  desc: { flex: 1, paddingRight: 12 },
  amt: { width: 100, textAlign: 'right' },
  sumRow: { flexDirection: 'row', paddingVertical: 3, paddingHorizontal: 6 },
  totalRow: { flexDirection: 'row', paddingVertical: 7, paddingHorizontal: 6, borderTopWidth: 1.5, borderTopColor: '#1e293b', fontFamily: 'Helvetica-Bold', fontSize: 13 },
  paidStamp: { marginTop: 10, color: '#15803d', fontFamily: 'Helvetica-Bold', fontSize: 14, textAlign: 'right' },
  notes: { marginTop: 22 },
  foot: { marginTop: 30, color: '#475569', fontSize: 9.5 },
});

function InvoiceDocument({ invoice: i, company: c, quoteNumber }: { invoice: Invoice; company: CompanyInfo; quoteNumber?: number }) {
  const total = invoiceTotal(i);
  const paid = Number(i.paid_cents);
  const balance = invoiceBalance(i);
  const contact = [c.address, c.phone, c.email, c.license ? `License: ${c.license}` : ''].filter(Boolean);
  const meta: [string, string][] = [['Invoice #', String(i.number)], ['Date', longDate(i.invoice_date)], ...(quoteNumber ? [['Quote #', String(quoteNumber)] as [string, string]] : []), ['Terms', i.terms], ...(i.due_date ? [['Due', longDate(i.due_date)] as [string, string]] : [])];
  return (
    <Document title={`Invoice ${i.number} - ${i.bill_to || i.address}`} author={c.name}>
      <Page size="LETTER" style={s.page}>
        <View style={s.header}>
          <View>
            {c.logoDataUrl && <Image src={c.logoDataUrl} style={s.logo} />}
            {c.name && <Text style={s.company}>{c.name}</Text>}
            {contact.map((line) => <Text key={line}>{line}</Text>)}
          </View>
          <View>
            <Text style={s.title}>{i.kind === 'deposit' ? 'DEPOSIT INVOICE' : i.kind === 'final' ? 'FINAL INVOICE' : 'INVOICE'}</Text>
            {meta.map(([k, v]) => (
              <View key={k} style={s.metaRow}><Text style={s.metaLabel}>{k}</Text><Text style={[s.metaValue, k === 'Invoice #' ? s.bold : {}]}>{v}</Text></View>
            ))}
          </View>
        </View>
        <View style={s.info}>
          <View style={s.infoCol}><Text style={s.label}>Bill to</Text><Text style={s.bold}>{i.bill_to || ' '}</Text></View>
          <View style={s.infoCol}><Text style={s.label}>Property</Text><Text style={s.bold}>{i.address || ' '}</Text></View>
        </View>
        <View style={s.head}><Text style={s.desc}>Description</Text><Text style={s.amt}>Amount</Text></View>
        {i.lines.map((l, n) => (
          <View key={n} style={s.row} wrap={false}>
            <View style={s.desc}><Text style={s.bold}>{l.description}</Text>{l.detail ? <Text>{l.detail}</Text> : null}</View>
            <Text style={s.amt}>{usd(Number(l.amount_cents) || 0)}</Text>
          </View>
        ))}
        {paid > 0 && (
          <>
            <View style={s.sumRow}><Text style={s.desc}>Total</Text><Text style={s.amt}>{usd(total)}</Text></View>
            <View style={s.sumRow}><Text style={s.desc}>Paid{i.paid_date ? ` (${longDate(i.paid_date)})` : ''}</Text><Text style={s.amt}>-{usd(paid)}</Text></View>
          </>
        )}
        <View style={s.totalRow}><Text style={s.desc}>{paid > 0 ? 'Balance due' : 'Total due'}</Text><Text style={s.amt}>{usd(Math.max(balance, 0))}</Text></View>
        {total > 0 && balance <= 0 && <Text style={s.paidStamp}>PAID IN FULL - THANK YOU</Text>}
        {i.notes.trim() !== '' && <View style={s.notes}><Text style={s.label}>Notes</Text><Text>{i.notes}</Text></View>}
        <Text style={s.foot}>Thank you for your business.{c.name ? ` Please make payment to ${c.name}.` : ''}</Text>
      </Page>
    </Document>
  );
}

export async function renderInvoicePdf(invoice: Invoice, company: CompanyInfo, quoteNumber?: number): Promise<Blob> {
  return pdf(<InvoiceDocument invoice={invoice} company={company} quoteNumber={quoteNumber} />).toBlob();
}
