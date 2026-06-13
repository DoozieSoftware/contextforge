<?php
namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Customer extends Model
{
    protected $fillable = ['name', 'email', 'tax_region'];

    public function invoices()
    {
        return $this->hasMany(Invoice::class);
    }
}
