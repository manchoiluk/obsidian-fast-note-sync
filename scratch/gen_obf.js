import fs from 'fs';
import path from 'path';

function obfuscate(filePath) {
    const buffer = fs.readFileSync(filePath);
    const base64 = buffer.toString('base64');
    return base64.split('').reverse().join('');
}

const kofiPath = 'scripts/kofi.png';
const wxPath = 'scripts/wxds.png';

const kofiObf = obfuscate(kofiPath);
const wxObf = obfuscate(wxPath);

function chunkString(str, size) {
    const numChunks = Math.ceil(str.length / size);
    const chunks = new Array(numChunks);
    for (let i = 0, o = 0; i < numChunks; ++i, o += size) {
        chunks[i] = str.substr(o, size);
    }
    return chunks;
}

console.log('// KOFI');
console.log(JSON.stringify(chunkString(kofiObf, 100), null, 2));
console.log('// WX');
console.log(JSON.stringify(chunkString(wxObf, 100), null, 2));
