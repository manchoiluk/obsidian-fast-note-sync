const fs = require("fs");
const path = require("path");

const dtsPath = path.join(__dirname, "..", "src", "pb", "v1", "sync.d.ts");

if (fs.existsSync(dtsPath)) {
    let content = fs.readFileSync(dtsPath, "utf8");

    // 移除第一行的 eslint-disable
    // Remove eslint-disable from the first line
    content = content.replace(/^\/\*\s*eslint-disable\s*\*\/\r?\n?/, "");

    // 将 { [k: string]: any } 替换为 { [k: string]: unknown }
    // Replace { [k: string]: any } with { [k: string]: unknown }
    content = content.replace(/\{\s*\[\s*k\s*:\s*string\s*\]\s*:\s*any\s*\}/g, "{ [k: string]: unknown }");

    fs.writeFileSync(dtsPath, content, "utf8");
    console.log("Successfully patched sync.d.ts: removed eslint-disable and replaced any with unknown.");
} else {
    console.error("sync.d.ts not found at " + dtsPath);
}
