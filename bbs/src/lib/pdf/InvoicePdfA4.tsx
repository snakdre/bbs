import {
  Document,
  Page,
  StyleSheet,
  Text,
  View
} from "@react-pdf/renderer";
import type { PdfInvoiceProps } from "./types";

const GOLD = "#B8973A";
const BLACK = "#0F0F0F";
const MUTED = "#666666";
const BORDER = "#E5E5E5";

const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 36,
    paddingHorizontal: 42,
    fontSize: 10,
    color: BLACK,
    fontFamily: "Helvetica"
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 2,
    borderBottomColor: GOLD,
    paddingBottom: 12,
    marginBottom: 18
  },
  brand: {
    fontSize: 14,
    color: GOLD,
    fontWeight: 700,
    letterSpacing: 0.5
  },
  metaLabel: {
    fontSize: 8,
    color: MUTED,
    letterSpacing: 1,
    textTransform: "uppercase"
  },
  invoiceNumber: {
    fontSize: 13,
    fontWeight: 700,
    fontFamily: "Courier"
  },
  addressLine: { fontSize: 8, color: MUTED, marginTop: 1 },
  billBlock: { flexDirection: "row", justifyContent: "space-between", marginBottom: 16 },
  balanceCallout: {
    alignItems: "flex-end"
  },
  balanceAmount: {
    fontSize: 16,
    fontWeight: 700,
    color: BLACK
  },
  linesTable: {
    marginBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: BORDER
  },
  linesHead: {
    flexDirection: "row",
    backgroundColor: "#F5F0E8",
    paddingVertical: 6,
    paddingHorizontal: 4
  },
  linesRow: {
    flexDirection: "row",
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderTopWidth: 1,
    borderTopColor: BORDER
  },
  colDesc: { flex: 3 },
  colQty: { flex: 0.8, textAlign: "right" },
  colUnit: { flex: 1, textAlign: "right" },
  colTotal: { flex: 1, textAlign: "right" },
  totalsBlock: { alignSelf: "flex-end", width: 200, marginTop: 4 },
  totalsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 2
  },
  totalsFinal: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: BLACK,
    paddingTop: 4,
    marginTop: 4,
    fontWeight: 700
  },
  paymentsSection: { marginTop: 18 },
  paymentsHeader: {
    fontSize: 8,
    color: MUTED,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 4
  },
  footer: {
    marginTop: 24,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    paddingTop: 8,
    textAlign: "center",
    fontSize: 8,
    color: MUTED
  }
});

export function InvoicePdfA4(props: PdfInvoiceProps) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>{props.business.name.toUpperCase()}</Text>
            {props.business.address && (
              <Text style={styles.addressLine}>{props.business.address}</Text>
            )}
            {(props.business.phone || props.business.email) && (
              <Text style={styles.addressLine}>
                {[props.business.phone, props.business.email].filter(Boolean).join(" · ")}
              </Text>
            )}
            {props.business.taxId && (
              <Text style={styles.addressLine}>Tax ID: {props.business.taxId}</Text>
            )}
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={styles.metaLabel}>Invoice</Text>
            <Text style={styles.invoiceNumber}>{props.invoiceNumber}</Text>
            <Text style={styles.addressLine}>Issued {props.issuedDate}</Text>
            {props.dueDate && (
              <Text style={styles.addressLine}>Due {props.dueDate}</Text>
            )}
          </View>
        </View>

        <View style={styles.billBlock}>
          <View style={{ flex: 1 }}>
            <Text style={styles.metaLabel}>Bill to</Text>
            <Text style={{ fontWeight: 700, marginTop: 2 }}>{props.customer.name}</Text>
            {props.customer.email && (
              <Text style={styles.addressLine}>{props.customer.email}</Text>
            )}
            {props.customer.billingAddress && (
              <Text style={styles.addressLine}>{props.customer.billingAddress}</Text>
            )}
          </View>
          <View style={styles.balanceCallout}>
            <Text style={styles.metaLabel}>Balance due</Text>
            <Text style={styles.balanceAmount}>{props.balanceLabel}</Text>
          </View>
        </View>

        <View style={styles.linesTable}>
          <View style={styles.linesHead}>
            <Text style={[styles.colDesc, { fontWeight: 700 }]}>Description</Text>
            <Text style={[styles.colQty, { fontWeight: 700 }]}>Qty</Text>
            <Text style={[styles.colUnit, { fontWeight: 700 }]}>Unit</Text>
            <Text style={[styles.colTotal, { fontWeight: 700 }]}>Total</Text>
          </View>
          {props.lines.map((l, i) => (
            <View key={i} style={styles.linesRow}>
              <Text style={styles.colDesc}>{l.description}</Text>
              <Text style={styles.colQty}>{l.quantityLabel}</Text>
              <Text style={styles.colUnit}>{l.unitLabel}</Text>
              <Text style={styles.colTotal}>{l.totalLabel}</Text>
            </View>
          ))}
        </View>

        <View style={styles.totalsBlock}>
          <View style={styles.totalsRow}>
            <Text style={{ color: MUTED }}>Subtotal</Text>
            <Text>{props.subtotalLabel}</Text>
          </View>
          <View style={styles.totalsRow}>
            <Text style={{ color: MUTED }}>Discount</Text>
            <Text>-{props.discountLabel}</Text>
          </View>
          <View style={styles.totalsRow}>
            <Text style={{ color: MUTED }}>Tax</Text>
            <Text>{props.taxLabel}</Text>
          </View>
          <View style={styles.totalsFinal}>
            <Text>Total</Text>
            <Text>{props.totalLabel}</Text>
          </View>
        </View>

        {props.payments.length > 0 && (
          <View style={styles.paymentsSection}>
            <Text style={styles.paymentsHeader}>Payments</Text>
            {props.payments.map((p, i) => (
              <Text key={i} style={{ marginBottom: 2 }}>
                {p.amountLabel} · {p.method} · {p.dateLabel}
                {p.tenderNote ? ` — ${p.tenderNote}` : ""}
              </Text>
            ))}
          </View>
        )}

        <View style={styles.footer}>
          {props.paymentTerms && <Text>{props.paymentTerms}</Text>}
          {props.footer && <Text>{props.footer}</Text>}
          {!props.paymentTerms && !props.footer && (
            <Text>Thank you for your business</Text>
          )}
        </View>
      </Page>
    </Document>
  );
}
