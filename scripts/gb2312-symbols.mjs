const decoder = new TextDecoder("gb18030", { fatal: true });
const characters = new Set();

for (let lead = 0xb0; lead <= 0xf7; lead += 1) {
  for (let trail = 0xa1; trail <= 0xfe; trail += 1) {
    const character = decoder.decode(Uint8Array.of(lead, trail));
    const codePoint = character.codePointAt(0);
    if (
      character.length === 1 &&
      codePoint !== undefined &&
      codePoint < 0xe000
    ) {
      characters.add(character);
    }
  }
}

if (process.argv.includes("--count")) {
  process.stdout.write(String(characters.size));
} else {
  process.stdout.write(
    [...characters]
      .toSorted(
        (left, right) =>
          (left.codePointAt(0) ?? 0) - (right.codePointAt(0) ?? 0),
      )
      .join(""),
  );
}
