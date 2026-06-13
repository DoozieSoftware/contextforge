from dataclasses import dataclass
from typing import Optional

@dataclass
class Invoice:
    id: str
    amount_cents: int
    tax_cents: int
    region: Optional[str] = None

RATES = {"CA": 0.0875, "NY": 0.08, "TX": 0.0625}

def calculate_tax(amount_cents: int, region: str) -> int:
    rate = RATES.get(region, 0)
    return int(amount_cents * rate)

def create_invoice(amount_cents: int, region: str) -> Invoice:
    tax = calculate_tax(amount_cents, region)
    return Invoice(id="x", amount_cents=amount_cents, tax_cents=tax, region=region)
