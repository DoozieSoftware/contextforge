<?php
use Illuminate\Support\Facades\Route;
use App\Http\Controllers\InvoiceController;

Route::post('/invoices', [InvoiceController::class, 'store']);
Route::post('/invoices/{invoice}/recalculate', [InvoiceController::class, 'recalculate']);
