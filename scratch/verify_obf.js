import fs from 'fs';

const decodeImage = (chunks) => {
  const reversed = chunks.join("");
  return "data:image/png;base64," + reversed.split("").reverse().join("");
};

// Read original for comparison
const originalKofi = fs.readFileSync('scripts/kofi.png').toString('base64');

// Read generated icons.ts to get chunks
const iconsContent = fs.readFileSync('src/lib/icons.ts', 'utf8');
const kofiChunksMatch = iconsContent.match(/const KofiChunks: string\[\] = (\[[\s\S]*?\]);/);

if (kofiChunksMatch) {
    const kofiChunks = JSON.parse(kofiChunksMatch[1]);
    const decoded = decodeImage(kofiChunks);
    const expected = "data:image/png;base64," + originalKofi;
    
    if (decoded === expected) {
        console.log('Kofi image deobfuscation test passed!');
    } else {
        console.error('Kofi image deobfuscation test failed!');
        console.log('Decoded start:', decoded.substring(0, 50));
        console.log('Expected start:', expected.substring(0, 50));
    }
} else {
    console.error('Could not find KofiChunks in src/lib/icons.ts');
}
