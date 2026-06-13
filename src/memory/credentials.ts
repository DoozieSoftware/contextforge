import fs from "node:fs";
import { credentialsFile, configDir } from "../util/config.js";
import { ensureDir } from "../util/fs.js";

export interface Credentials {
  provider: "anthropic" | "openai" | "openai-compat";
  apiKey: string;
  baseUrl?: string;
  plannerModel?: string;
  writerModel?: string;
  createdAt: string;
}

export function readCredentials(): Credentials | null {
  try {
    if (!fs.existsSync(credentialsFile())) return null;
    return JSON.parse(fs.readFileSync(credentialsFile(), "utf-8"));
  } catch {
    return null;
  }
}

export function writeCredentials(creds: Credentials): string {
  ensureDir(configDir());
  try {
    fs.chmodSync(configDir(), 0o700);
  } catch {
    // best-effort on platforms that don't support chmod
  }
  fs.writeFileSync(credentialsFile(), JSON.stringify(creds, null, 2), "utf-8");
  try {
    fs.chmodSync(credentialsFile(), 0o600);
  } catch {
    // best-effort
  }
  return credentialsFile();
}

export function credentialsPath(): string {
  return credentialsFile();
}
