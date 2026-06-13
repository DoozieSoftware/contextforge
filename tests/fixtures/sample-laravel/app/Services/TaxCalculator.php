<?php
namespace App\Services;

use App\Models\Customer;

class TaxCalculator
{
    /**
     * Tax rate by region (basis points).
     * @var array<string,int>
     */
    private const RATES = [
        'CA' => 875,
        'NY' => 800,
        'TX' => 625,
    ];

    public function calculate(Customer $customer, int $amountCents): int
    {
        $bps = self::RATES[$customer->tax_region] ?? 0;
        return intdiv($amountCents * $bps, 10_000);
    }
}
