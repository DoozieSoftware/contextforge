import { MockProvider } from "~/llm/mock.js";

/**
 * Returns a MockProvider pre-loaded with the canned responses the e2e
 * tests expect. The planner returns a small selection; the writer returns
 * the brief's required sections.
 *
 * Match keys are deliberately distinct so the mock can route the right
 * canned response to the right command's writer pass.
 */
export function makeMockProvider(): MockProvider {
  const mock = new MockProvider("mock-model");

  // ---- PLANNER responses ----
  mock.respond(/Select up to .* files that will help a writer explain/i, {
    content: JSON.stringify({
      selectedFiles: [
        "app/Services/InvoiceService.php",
        "app/Models/Invoice.php",
        "app/Models/Customer.php",
        "app/Services/TaxCalculator.php",
        "app/Http/Requests/InvoiceStoreRequest.php",
        "app/Http/Controllers/InvoiceController.php",
        "routes/web.php",
        "tests/Feature/InvoiceServiceTest.php",
      ],
      planNotes: "Selected files cover the service, its dependencies, and the controller/test path.",
    }),
    toolCalls: [],
    tokensIn: 800,
    tokensOut: 220,
  });

  mock.respond(/The user's query is:/i, {
    content: JSON.stringify({
      selectedFiles: [
        "app/Services/InvoiceService.php",
        "app/Services/TaxCalculator.php",
        "app/Models/Invoice.php",
      ],
      planNotes: "Tax-related: focused on the tax calculator and its callers.",
    }),
    toolCalls: [],
    tokensIn: 600,
    tokensOut: 180,
  });

  mock.respond(/deeper LLM review/i, {
    content: JSON.stringify({
      selectedFiles: [
        "app/Services/InvoiceService.php",
        "app/Http/Controllers/InvoiceController.php",
      ],
      planNotes: "Picked files with the highest review risk.",
    }),
    toolCalls: [],
    tokensIn: 500,
    tokensOut: 160,
  });

  mock.respond(/Pick up to .* files that give relevant context to break/i, {
    content: JSON.stringify({
      selectedFiles: ["app/Services/InvoiceService.php", "app/Models/Invoice.php"],
      planNotes: "Picked files that match the requirement's domain.",
    }),
    toolCalls: [],
    tokensIn: 400,
    tokensOut: 140,
  });

  mock.respond(/Pick up to .* files that give relevant context for the proposal/i, {
    content: JSON.stringify({
      selectedFiles: ["app/Services/InvoiceService.php"],
      planNotes: "Single anchor file.",
    }),
    toolCalls: [],
    tokensIn: 350,
    tokensOut: 120,
  });

  // ---- WRITER responses ----
  // Each writer response is matched on a unique substring from the writer
  // system prompt so the mock routes correctly.

  mock.respond(/You are a senior software engineer\. The user wants a structured "understand" report/i, {
    content: `## Purpose
Invoices are created and tax-recalculated by \`InvoiceService\`, with a small set of dependencies on \`Customer\`, the store request validator, and a \`TaxCalculator\`.

## Dependencies
- app/Models/Invoice.php — the persisted entity.
- app/Models/Customer.php — owns the tax region.
- app/Http/Requests/InvoiceStoreRequest.php — input validation.
- app/Services/TaxCalculator.php — tax math by region.
- app/Http/Controllers/InvoiceController.php — the HTTP entrypoint.

## Data Flow
1. \`POST /invoices\` hits \`InvoiceController::store\`.
2. The controller calls \`InvoiceService::createInvoice\` with the validated request.
3. \`InvoiceService\` reads the customer and asks \`TaxCalculator\` for the tax amount in cents.
4. A new \`Invoice\` row is persisted with status "draft".
5. \`POST /invoices/{id}/recalculate\` re-runs the tax math against the current amount and region.

## Risk Areas
- Tax rate table in \`TaxCalculator\` is hard-coded; new regions silently get 0.
- \`createInvoice\` does not run inside an explicit DB transaction.
- No exception handling for the missing \`tax_region\` on a customer.
- Recalculation does not emit a domain event.

## Suggested Reading Order
1. app/Http/Controllers/InvoiceController.php — entry point
2. app/Http/Requests/InvoiceStoreRequest.php — validates input
3. app/Services/InvoiceService.php — orchestration
4. app/Services/TaxCalculator.php — tax math
5. tests/Feature/InvoiceServiceTest.php — current coverage`,
    tokensIn: 1200,
    tokensOut: 520,
  });

  mock.respond(/You are a senior software engineer triaging a production incident/i, {
    content: `## Probable Root Causes
- app/Services/TaxCalculator.php — the rate table is hard-coded; if the customer's region is missing, tax silently drops to 0.
- app/Services/InvoiceService.php — recalculation runs in a save() without a transaction; partial failures can leave a row inconsistent.

## Affected Files
- app/Services/TaxCalculator.php
- app/Services/InvoiceService.php
- app/Models/Invoice.php
- app/Http/Controllers/InvoiceController.php

## Confidence Level
High — the package contains the tax math, the caller, and the persistence layer.

## Suggested Fixes
- app/Services/TaxCalculator.php — throw on unknown region instead of returning 0.
- app/Services/InvoiceService.php — wrap recalculation in DB::transaction().
- app/Http/Controllers/InvoiceController.php — add error responses for the new exception.

## Regression Tests
- tests/Feature/InvoiceServiceTest.php — add a "throws on unknown region" test.
- tests/Feature/InvoiceServiceTest.php — add a "recalculation is atomic" test.`,
    tokensIn: 900,
    tokensOut: 480,
  });

  mock.respond(/You are a senior reviewer doing a focused code review of the diff/i, {
    content: `## Critical
- app/Services/InvoiceService.php:12 — hard-coded tax region fallback returns 0, causing silent revenue loss.

## High
- app/Http/Controllers/InvoiceController.php:18 — no try/catch on recalculate; downstream failure returns 500 with no body.

## Medium
- app/Services/InvoiceService.php:25 — recalculation does not emit a domain event for downstream consumers.

## Low
- routes/web.php:5 — controller-action string syntax used inconsistently.`,
    tokensIn: 950,
    tokensOut: 320,
  });

  mock.respond(/You are a senior product engineer\. The user has shared a requirement document/i, {
    content: `## Epic
Add tax-region support for international customers.

## Features
- Per-region tax rules
- Tax migration path for existing invoices

## Stories
- As a finance user, I want a new region added without a code change, so that we can roll out gradually.
- As a developer, I want a migration script to backfill missing tax rows.

## Tasks
- Add a tax_rates table and a migration
- Refactor TaxCalculator to read from the table
- Backfill script for legacy invoices
- Update InvoiceService::recalculateTax to load the rate

## Estimates
- DB schema + migration: M (4h)
- Refactor TaxCalculator: S (2h)
- Backfill script: M (3h)
- Tests: S (2h)

## Dependencies
- DBA review of the new table.

## Risks
- Legacy invoices with no region need a default.`,
    tokensIn: 700,
    tokensOut: 400,
  });

  mock.respond(/You are a senior architect\. The user has shared an understanding document/i, {
    content: `## Scope
- New tax-rates data store and admin endpoint.

## Assumptions
- The current Laravel app is the only system that needs this.

## Modules
- app/Models/TaxRate.php — Eloquent model
- app/Http/Controllers/Admin/TaxRateController.php — CRUD
- database/migrations/*_create_tax_rates_table.php — schema
- app/Services/TaxCalculator.php — refactor

## Effort
- TaxRate model: S (1h)
- Migration: S (1h)
- TaxRateController: M (4h)
- TaxCalculator refactor: M (3h)
- Tests: M (4h)

## Risk
- Performance: hot path now hits the DB.
- Migration: data backfill could lock the invoices table.

## Implementation Plan
1. Add migration and TaxRate model.
2. Refactor TaxCalculator to use the new model.
3. Add admin controller and routes.
4. Write backfill command.
5. Add feature tests.`,
    tokensIn: 700,
    tokensOut: 420,
  });

  return mock;
}
