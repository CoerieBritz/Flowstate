// Copies bundled static assets into public/ before `vite dev` / `vite build`.
//
// Why: Vite cannot resolve imported assets (CSS url() or JS imports) when the
// project path contains '#' (this repo lives under "##Claude Projects").
// Files in public/ are copied to dist/ verbatim and need no resolution, so the
// fonts still ship inside the app and work offline.
//
// Sources stay authoritative: fonts come from the installed @fontsource
// packages, the logo from src/assets/logo.png. The copies are gitignored.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pub = join(root, "public");

const FONTS = [
  ["rajdhani", "rajdhani-latin-500-normal.woff2"],
  ["rajdhani", "rajdhani-latin-600-normal.woff2"],
  ["rajdhani", "rajdhani-latin-700-normal.woff2"],
  ["jetbrains-mono", "jetbrains-mono-latin-400-normal.woff2"],
  ["jetbrains-mono", "jetbrains-mono-latin-600-normal.woff2"],
  ["jetbrains-mono", "jetbrains-mono-latin-700-normal.woff2"],
];

mkdirSync(join(pub, "fonts"), { recursive: true });
for (const [pkg, file] of FONTS) {
  copyFileSync(join(root, "node_modules", "@fontsource", pkg, "files", file), join(pub, "fonts", file));
}
copyFileSync(join(root, "src", "assets", "logo.png"), join(pub, "logo.png"));
console.log(`[copy-assets] ${FONTS.length} fonts + logo -> public/`);
