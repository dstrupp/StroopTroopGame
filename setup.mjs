// Runs as the Netlify build step. Lays the flat repo out into the folders Netlify expects.
import fs from "fs";
const cp = (src, dir) => {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(src, `${dir}/${src}`);
  console.log(`${src} -> ${dir}/`);
};
["index.html", "app.js", "icon.png"].forEach((f) => cp(f, "public"));
["store.mjs", "ai.mjs", "autopilot.mjs", "run-autopilot.mjs"].forEach((f) => cp(f, "netlify/functions"));
cp("league.mjs", "shared");
console.log("Layout ready.");
