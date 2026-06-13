import { pool } from "./db";

export interface Invoice {
  id: string;
  amountCents: number;
  taxCents: number;
}

export async function createInvoice(amountCents: number, region: string): Promise<Invoice> {
  const rates: Record<string, number> = { CA: 0.0875, NY: 0.08, TX: 0.0625 };
  const taxCents = Math.floor(amountCents * (rates[region] ?? 0));
  const r = await pool.query(
    "INSERT INTO invoices(amount_cents, tax_cents) VALUES ($1, $2) RETURNING id, amount_cents, tax_cents",
    [amountCents, taxCents],
  );
  return {
    id: r.rows[0].id,
    amountCents: r.rows[0].amount_cents,
    taxCents: r.rows[0].tax_cents,
  };
}
