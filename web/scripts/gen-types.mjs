// Generates Supabase TypeScript types and writes them as UTF-8.
// PowerShell's > operator writes UTF-16; this script avoids that.
// Usage: pnpm gen:types
import { execSync } from "child_process";
import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, "../lib/db/types.ts");

const output = execSync("supabase gen types typescript --linked", {
  cwd: resolve(__dirname, ".."),
}).toString("utf8");

writeFileSync(outPath, output, "utf8");
console.log(`✓ Types written to lib/db/types.ts (${output.length} bytes)`);
