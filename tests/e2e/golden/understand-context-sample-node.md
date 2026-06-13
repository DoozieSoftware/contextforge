# Understand: src/services/billing.ts — context package


---
Files Scanned: 5
Files Selected: 3
Repo Size:     356 tokens
Context Size:  417 tokens
Reduction:     -17.1%


# CONTEXT PACKAGE

## src/services/billing.ts

*service · 259 tokens · target file; imports db.ts; imported by invoices.ts*

```
1 │ import { pool } from "./db";
 2 │ 
 3 │ export interface Invoice {
 4 │   id: string;
 5 │   amountCents: number;
 6 │   taxCents: number;
 7 │ }
 8 │ 
 9 │ export async function createInvoice(amountCents: number, region: string): Promise<Invoice> {
10 │   const rates: Record<string, number> = { CA: 0.0875, NY: 0.08, TX: 0.0625 };
11 │   const taxCents = Math.floor(amountCents * (rates[region] ?? 0));
12 │   const r = await pool.query(
13 │     "INSERT INTO invoices(amount_cents, tax_cents) VALUES ($1, $2) RETURNING id, amount_cents, tax_cents",
14 │     [amountCents, taxCents],
15 │   );
16 │   return {
17 │     id: r.rows[0].id,
18 │     amountCents: r.rows[0].amount_cents,
19 │     taxCents: r.rows[0].tax_cents,
20 │   };
21 │ }
22 │
```

## src/services/db.ts

*service · 33 tokens · imported by billing.ts*

```
1 │ import { Pool } from "pg";
2 │ 
3 │ export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
4 │
```

## src/pages/api/invoices.ts

*route · route · 125 tokens · imports billing.ts*

```
1 │ import type { NextApiRequest, NextApiResponse } from "next";
 2 │ import { createInvoice } from "../../services/billing";
 3 │ 
 4 │ export default async function handler(req: NextApiRequest, res: NextApiResponse) {
 5 │   if (req.method !== "POST") return res.status(405).end();
 6 │   const { amount, region } = req.body ?? {};
 7 │   const inv = await createInvoice(Number(amount), String(region));
 8 │   res.status(201).json(inv);
 9 │ }
10 │
```

