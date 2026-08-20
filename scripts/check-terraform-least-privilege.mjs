#!/usr/bin/env node
/**
 * Threat-validation check (build plan §20 Checkpoint 13.1, "over-permissioned
 * service accounts"): scan every Terraform file and fail if any IAM binding grants
 * a primitive/basic role (owner/editor), a project-IAM-admin role that would let a
 * runtime service account escalate its own privileges, or a wildcard role.
 *
 * Runtime service accounts get only least-privilege roles (see
 * environments/dev/main.tf `baseline_roles` + per-service grants added as needed).
 * Run: `node scripts/check-terraform-least-privilege.mjs`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "infrastructure/terraform";

const FORBIDDEN_ROLES = [
  "roles/owner",
  "roles/editor",
  "roles/resourcemanager.projectIamAdmin",
  "roles/iam.securityAdmin",
  "roles/iam.serviceAccountAdmin",
  "roles/iam.serviceAccountKeyAdmin",
];

function walk(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    if (name === ".terraform") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      files.push(...walk(path));
    } else if (name.endsWith(".tf")) {
      files.push(path);
    }
  }
  return files;
}

const violations = [];
for (const file of walk(ROOT)) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (line.startsWith("#") || line.startsWith("//")) return; // skip comments
    for (const role of FORBIDDEN_ROLES) {
      if (line.includes(`"${role}"`)) {
        violations.push(`${file}:${index + 1}  grants ${role}`);
      }
    }
    if (/"roles\/[^"]*\*[^"]*"/.test(line)) {
      violations.push(`${file}:${index + 1}  grants a wildcard role`);
    }
  });
}

if (violations.length > 0) {
  console.error("FAIL: over-permissioned IAM role(s) found in Terraform:");
  for (const v of violations) console.error("  " + v);
  process.exit(1);
}
console.log(
  "OK: no owner/editor/IAM-admin/wildcard roles granted anywhere in infrastructure/terraform.",
);
