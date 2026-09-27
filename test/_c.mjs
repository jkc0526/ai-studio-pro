import { execFileSync } from "node:child_process";
for (const f of ["test/verify-video-mode.mjs", "test/qa-agnes-video.mjs"]) {
  let out = "";
  try { out = execFileSync(process.execPath, [f], { encoding: "utf8" }); }
  catch (e) { out = (e.stdout || "") + (e.stderr || ""); }
  const pass = (out.match(/\u2705/g) || []).length;
  const fail = (out.match(/\u274c/g) || []).length;
  console.log(`${f}: pass=${pass} fail=${fail}`);
}
