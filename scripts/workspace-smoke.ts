export function workspaceSmoke(): { ok: true; node: string; pnpm: string } {
  const node = process.versions.node;
  const pkgEnv = process.env as { npm_package_manager?: string };
  const pnpm = pkgEnv.npm_package_manager ?? "unknown";
  return { ok: true, node, pnpm };
}
