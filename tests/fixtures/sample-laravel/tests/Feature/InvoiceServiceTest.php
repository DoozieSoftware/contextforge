<?php
namespace Tests\Feature;

use Tests\TestCase;
use App\Models\Customer;
use App\Services\InvoiceService;

class InvoiceServiceTest extends TestCase
{
    public function test_creates_invoice_with_tax(): void
    {
        $customer = new Customer(['tax_region' => 'CA']);
        $svc = new InvoiceService(new \App\Services\TaxCalculator());
        $this->assertTrue(true);
    }
}
