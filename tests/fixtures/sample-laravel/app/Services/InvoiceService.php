<?php
namespace App\Services;

use App\Models\Invoice;
use App\Models\Customer;
use App\Http\Requests\InvoiceStoreRequest;
use App\Services\TaxCalculator;

class InvoiceService
{
    public function __construct(private TaxCalculator $tax) {}

    public function createInvoice(InvoiceStoreRequest $req): Invoice
    {
        $customer = Customer::findOrFail($req->customer_id);
        $subtotal = $req->amount_cents;
        $taxCents = $this->tax->calculate($customer, $subtotal);

        $invoice = new Invoice([
            'customer_id' => $customer->id,
            'amount_cents' => $subtotal,
            'tax_cents' => $taxCents,
            'status' => 'draft',
        ]);
        $invoice->save();
        return $invoice;
    }

    public function recalculateTax(Invoice $invoice): Invoice
    {
        $customer = $invoice->customer;
        $invoice->tax_cents = $this->tax->calculate($customer, $invoice->amount_cents);
        $invoice->save();
        return $invoice;
    }
}
