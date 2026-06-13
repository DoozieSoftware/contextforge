import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { offlineBreakdown, offlineProposal } from "../../src/commands/offline.js";
import { detectProjectMemory, writeProjectMemory } from "../../src/memory/project.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("offline templates (deterministic, not placeholders)", () => {
  let tmp: string;
  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-offline-tpl-"));
    fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "src/billing.ts"), "export const x = 1;\n");
    fs.writeFileSync(path.join(tmp, "src/invoice.ts"), "export const y = 2;\n");
    fs.writeFileSync(path.join(tmp, "package.json"), "{}");
    writeProjectMemory(tmp, detectProjectMemory(tmp));
  });
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("offlineBreakdown extracts bullets from the source requirement", () => {
    const mem = detectProjectMemory(tmp);
    const req = "# Req\n\n- Add billing support\n- Wire up invoice PDFs\n- Send email receipt\n";
    const body = offlineBreakdown(req, tmp, mem);
    expect(body).toMatch(/## Epic/);
    expect(body).toMatch(/## Features/);
    expect(body).toMatch(/billing support/);
    expect(body).toMatch(/## Tasks/);
    expect(body).toMatch(/## Estimates/);
    expect(body).toMatch(/## Dependencies/);
    expect(body).toMatch(/## Risks/);
  });

  it("offlineBreakdown matches keyword against the repo for Dependencies", () => {
    const mem = detectProjectMemory(tmp);
    const body = offlineBreakdown("Add new billing flow", tmp, mem);
    expect(body).toMatch(/## Dependencies/);
    expect(body).toMatch(/billing\.ts/);
  });

  it("offlineProposal extracts ## sections and lists touch points", () => {
    const mem = detectProjectMemory(tmp);
    const understanding = "# Understanding\n\n## Problem\nWe need better billing.\n\n## Goals\nShip invoice PDFs.\n";
    const body = offlineProposal(understanding, tmp, mem);
    expect(body).toMatch(/## Scope/);
    expect(body).toMatch(/## Assumptions/);
    expect(body).toMatch(/Problem|Goals/);
    expect(body).toMatch(/## Modules/);
    expect(body).toMatch(/## Effort/);
    expect(body).toMatch(/## Risk/);
    expect(body).toMatch(/## Implementation Plan/);
  });
});
