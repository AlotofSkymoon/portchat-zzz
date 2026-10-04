import { transform } from "sucrase";
import fs from "fs";
const files = process.argv.slice(2);
let bad = 0;
for (const f of files) {
  const code = fs.readFileSync(f, "utf8");
  try {
    transform(code, { transforms: ["typescript", "jsx"], jsxRuntime: "automatic" });
    console.log("OK  ", f);
  } catch (e) {
    bad++;
    console.log("FAIL", f, "\n   ", String(e.message).split("\n")[0]);
  }
}
process.exit(bad ? 1 : 0);
