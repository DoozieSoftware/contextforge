import { describe, it, expect } from "vitest";
import { parsePhp } from "~/scanner/parsers/php.js";
import { parseTs } from "~/scanner/parsers/ts.js";
import { parsePython } from "~/scanner/parsers/python.js";

describe("PHP parser", () => {
  it("extracts use statements, classes, traits, methods, and routes", async () => {
    const src = `<?php
namespace App\\Services;
use App\\Models\\Invoice;
use App\\Http\\Requests\\InvoiceStoreRequest as Req;

class InvoiceService
{
    public function createInvoice(Req $req): Invoice
    {
        return new Invoice();
    }

    public function testCreateInvoiceWithEmptyPayload()
    {
        $this->assertTrue(true);
    }
}

trait Taxable {}

Route::post('/invoices', [InvoiceController::class, 'store']);
Route::get('/invoices/{id}', 'InvoiceController@show');
`;
    const r = await parsePhp("app/Services/InvoiceService.php", src);
    expect(r.language).toBe("php");
    const useLines = r.imports.map((i) => i.raw);
    expect(useLines).toContain("App\\Models\\Invoice");
    expect(useLines).toContain("App\\Http\\Requests\\InvoiceStoreRequest");
    const names = r.symbols.map((s) => s.name);
    expect(names).toContain("App\\Services");
    expect(names).toContain("InvoiceService");
    const methods = r.symbols.filter((s) => s.kind === "method").map((s) => s.name);
    expect(methods).toContain("createInvoice");
    const tests = r.tests.map((t) => t.name);
    expect(tests).toContain("testCreateInvoiceWithEmptyPayload");
    const routes = r.routes.map((rt) => `${rt.method} ${rt.path}`);
    expect(routes).toContain("POST /invoices");
    expect(r.routes[0]?.handler).toContain("InvoiceController");
    expect(r.tags).toContain("service");
  });
});

describe("TS parser", () => {
  it("extracts imports, classes, tests, and Next.js route handlers", async () => {
    const src = `import { foo } from "./bar";
import type { Baz } from "../types";
import * as db from "./db";
const x = require("./legacy");

export class Billing {
  go() {}
}

export function createInvoice() {}

it("computes tax", () => {
  expect(1).toBe(1);
});

export async function POST(req: Request) {
  return new Response("ok");
}
`;
    const r = await parseTs("src/services/billing.ts", src);
    const raws = r.imports.map((i) => i.raw);
    expect(raws).toContain("./bar");
    expect(raws).toContain("../types");
    expect(raws).toContain("./db");
    expect(raws).toContain("./legacy");
    expect(r.symbols.map((s) => s.name)).toContain("Billing");
    expect(r.symbols.map((s) => s.name)).toContain("createInvoice");
    expect(r.tests.map((t) => t.name)).toContain("computes tax");
    expect(r.routes.map((rt) => rt.method)).toContain("POST");
    expect(r.tags).toContain("service");
  });
});

describe("Python parser", () => {
  it("extracts imports, classes, decorated functions, and FastAPI routes", async () => {
    const src = `from typing import Optional
from app.billing import calculate_tax, Invoice
import os
import json

class InvoiceService:
    def go(self):
        pass

@app.post("/invoices")
def post_invoice(amount: int, region: str = "CA"):
    return {"ok": True}

def test_calculate_tax_ca():
    assert calculate_tax(10000, "CA") == 875
`;
    const r = await parsePython("app/views.py", src);
    expect(r.imports.map((i) => i.raw)).toContain("typing");
    expect(r.imports.map((i) => i.raw)).toContain("app.billing");
    expect(r.imports.map((i) => i.raw)).toContain("os");
    expect(r.symbols.map((s) => s.name)).toContain("InvoiceService");
    expect(r.routes.map((rt) => `${rt.method} ${rt.path}`)).toContain("POST /invoices");
    expect(r.tests.map((t) => t.name)).toContain("test_calculate_tax_ca");
  });
});


describe("TS parser extras", () => {
  it("extracts arrow-function components and decorators", async () => {
    const src = `import React from "react";

@Component({ selector: "app-root" })
export class AppComponent {}

@Injectable()
export class Service {
  @Trace()
  public go() {}
}

export const HomePage = () => <div>hi</div>;
export const Settings = (props: Props) => null;
export default DefaultPage;
`;
    const r = await parseTs("src/app.tsx", src);
    const names = r.symbols.map((s) => s.name);
    expect(names).toContain("HomePage");
    expect(names).toContain("Settings");
    // DefaultPage is a re-export, not a const declaration — not tracked
    const decorated = r.symbols.filter((s) => s.kind === "decorator");
    expect(decorated.some((d) => d.annotation === "Component")).toBe(true);
    expect(decorated.some((d) => d.annotation === "Injectable")).toBe(true);
    expect(decorated.some((d) => d.annotation === "Trace")).toBe(true);
  });
});


describe("Python parser extras", () => {
  it("captures return type annotations and async/await", async () => {
    const src = `import asyncio

async def fetch(url: str) -> dict:
    response = await http.get(url)
    return response.json()

def compute(x: int) -> int:
    return x * 2

class Service:
    async def run(self) -> None:
        await asyncio.sleep(0)
`;
    const r = await parsePython("app/service.py", src);
    const fetch = r.symbols.find((s) => s.name === "fetch");
    expect(fetch).toBeDefined();
    expect(fetch?.annotation).toContain("dict");
    const compute = r.symbols.find((s) => s.name === "compute");
    expect(compute?.annotation).toContain("int");
    expect(r.tags).toContain("async");
    expect(r.tags).toContain("await");
  });
});


describe("PHP parser extras", () => {
  it("captures PHP 8 attributes and return type declarations", async () => {
    const src = `<?php
namespace App\\Services;

use App\\Models\\Invoice;

#[Route("/api/invoices")]
#[ORM\\Entity]
class InvoiceService
{
    public function create(Invoice $inv): Invoice
    {
        return $inv;
    }

    public function list(): array
    {
        return [];
    }
}

trait Taxable {}

#[] // malformed, should be ignored
`;
    const r = await parsePhp("app/Services/InvoiceService.php", src);
    const attrNames = r.symbols.filter((s) => s.kind === "decorator").map((s) => s.name);
    expect(attrNames).toContain("Route");
    expect(attrNames).toContain("ORM\\Entity");
    const create = r.symbols.find((s) => s.name === "create");
    expect(create?.annotation ?? "").toContain("Invoice");
    const list = r.symbols.find((s) => s.name === "list");
    expect(list?.annotation ?? "").toContain("array");
  });
});
