import { describe, it, expect } from "vitest";
import { redactSecrets } from "~/context/redact.js";

describe("redact", () => {
  it("redacts api_key = \"...\"", () => {
    const r = redactSecrets(`const x = { apiKey: "abcd-efgh-ijkl-mnop-qrstuvwxyz" };`);
    expect(r).toContain("<REDACTED:SECRET>");
    expect(r).not.toContain("abcd-efgh-ijkl-mnop-qrstuvwxyz");
  });

  it("redacts AWS-shaped access keys", () => {
    const r = redactSecrets(`aws = "AKIAIOSFODNN7EXAMPLE"`);
    expect(r).toContain("<REDACTED:AWS_KEY>");
    expect(r).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });

  it("redacts GitHub tokens", () => {
    const r = redactSecrets(`token = "ghp_abcDEF1234567890abcdefghijklmnopqrst"`);
    expect(r).toContain("<REDACTED:GITHUB_TOKEN>");
  });

  it("redacts JWTs", () => {
    const r = redactSecrets(`cookie: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature_here_xxxx"`);
    expect(r).toContain("<REDACTED:JWT>");
  });

  it("redacts URL basic auth", () => {
    const r = redactSecrets(`const u = "https://user:supersecretpass@db.example.com";`);
    expect(r).toContain("<REDACTED:BASIC_AUTH_PASSWORD>");
    expect(r).not.toContain("supersecretpass");
  });

  it("leaves innocuous strings alone", () => {
    const r = redactSecrets(`const name = "Alice"; const city = "San Francisco";`);
    expect(r).toContain("Alice");
    expect(r).toContain("San Francisco");
  });
});
