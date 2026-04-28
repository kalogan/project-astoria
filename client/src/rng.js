export function createRNG(seed) {
  let s = seed >>> 0;
  const rng = {
    next() {
      s |= 0; s = s + 0x6D2B79F5 | 0;
      let z = Math.imul(s ^ s >>> 15, 1 | s);
      z = z + Math.imul(z ^ z >>> 7, 61 | z) ^ z;
      return ((z ^ z >>> 14) >>> 0) / 4294967296;
    },
    nextInt(min, max) { return Math.floor(rng.next() * (max - min + 1)) + min; },
    nextFloat(min, max) { return rng.next() * (max - min) + min; },
    getSeed() { return seed; },
    reset()   { s = seed >>> 0; },
    logSeed() { console.log(`[RNG] seed=${seed}`); },
  };
  return rng;
}
