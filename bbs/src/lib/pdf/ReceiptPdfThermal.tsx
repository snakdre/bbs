import {
  Document,
  Page,
  StyleSheet,
  Text,
  View
} from "@react-pdf/renderer";
import type { PdfInvoiceProps } from "./types";

const BLACK = "#000000";
const MUTED = "#555555";

// 80mm ≈ 226.77pt. Height is auto for thermal.
const PAGE_WIDTH = 226.77;

const styles = StyleSheet.create({
  page: {
    paddingTop: 12,
    paddingBottom: 12,
    paddingHorizontal: 12,
    fontSize: 8,
    color: BLACK,
    fontFamily: "Helvetica"
  },
  brand: {
    fontSize: 11,
    fontWeight: 700,
    textAlign: "center",
    marginBottom: 4
  },
  center: { textAlign: "center", fontSize: 8, color: MUTED },
  bar: {
    height: 1.5,
    backgroundColor: BLACK,
    marginVertical: 6
  },
  monoCenter: {
    fontFamily: "Courier",
    fontSize: 8,
    textAlign: "center",
    marginBottom: 4
  },
  lineRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 2,
    borderBottomWidth: 0.5,
    borderBottomColor: "#e5e5e5"
  },
  lineName: { flex: 1, paddingRight: 4 },
  lineTotal: { fontVariant: ["tabular-nums"] },
  lineSub: { fontSize: 7, color: MUTED, marginTop: 1 },
  totalsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 1
  },
  totalsFinal: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
    marginTop: 4,
    fontWeight: 700,
    fontSize: 11,
    borderTopWidth: 1,
    borderTopColor: BLACK
  },
  footer: {
    marginTop: 10,
    textAlign: "center",
    fontSize: 7,
    color: MUTED
  }
});

export function ReceiptPdfThermal(props: PdfInvoiceProps) {
  return (
    <Document>
      <Page size={{ width: PAGE_WIDTH, height: "auto" as unknown as number }} style={styles.page}>
        <Text style={styles.brand}>{props.business.name}</Text>
        {props.business.address && <Text style={styles.center}>{props.business.address}</Text>}
        {props.business.phone && <Text style={styles.center}>{props.business.phone}</Text>}

        <View style={styles.bar} />

        <Text style={styles.monoCenter}>
          {props.invoiceNumber} · {props.issuedDate}
        </Text>

        {props.lines.map((l, i) => (
          <View key={i} style={styles.lineRow}>
            <View style={styles.lineName}>
              <Text>{l.description}</Text>
              <Text style={styles.lineSub}>{l.quantityLabel} × {l.unitLabel}</Text>
            </View>
            <Text style={styles.lineTotal}>{l.totalLabel}</Text>
          </View>
        ))}

        <View style={{ marginTop: 8 }}>
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
          <>
            <View style={styles.bar} />
            {props.payments.map((p, i) => (
              <View key={i}>
                <View style={styles.totalsRow}>
                  <Text style={{ color: MUTED }}>{p.method}</Text>
                  <Text>{p.amountLabel}</Text>
                </View>
                {p.tenderNote && (
                  <Text style={styles.lineSub}>{p.tenderNote}</Text>
                )}
              </View>
            ))}
          </>
        )}

        <View style={styles.footer}>
          <Text>Thank you for your business</Text>
        </View>
      </Page>
    </Document>
  );
}
