import type { NextApiRequest, NextApiResponse } from "next";
import { createInvoice } from "../../services/billing";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();
  const { amount, region } = req.body ?? {};
  const inv = await createInvoice(Number(amount), String(region));
  res.status(201).json(inv);
}
