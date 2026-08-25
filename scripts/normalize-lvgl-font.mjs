import { readFile, writeFile } from "node:fs/promises";

const path = process.argv[2];
if (!path) {
  throw new Error("font output path is required");
}

const source = await readFile(path, "utf8");
const normalized = source
  .replace(
    /^ \* Opts: .*$/m,
    " * Source: Noto Sans SC; GB2312 6763 characters plus UI punctuation",
  )
  .replace(/\.line_height = \d+,/, ".line_height = 19,")
  .replace(/\.base_line = \d+,/, ".base_line = 4,");

if (normalized === source) {
  throw new Error("generated font format was not recognized");
}

await writeFile(path, normalized);
