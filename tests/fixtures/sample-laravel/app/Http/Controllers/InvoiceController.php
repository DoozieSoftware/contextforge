<?php
namespace App\Http\Controllers;

use App\Services\InvoiceService;
use App\Http\Requests\InvoiceStoreRequest;
use App\Models\Invoice;

class InvoiceController extends Controller
{
    public function __construct(private InvoiceService $invoices) {}

    public function store(InvoiceStoreRequest $request)
    {
        $invoice = $this->invoices->createInvoice($request);
        return response()->json(['id' => $invoice->id], 201);
    }

    public function recalculate(Invoice $invoice)
    {
        $this->invoices->recalculateTax($invoice);
        return response()->json(['ok' => true]);
    }
}
