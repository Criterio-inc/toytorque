// ---------------------------------------------------------------------------
// Saker att köra rakt igenom: kartongväggar, burkpyramider och konrader.
// Ger listor för nivådatans props. Föremålen är lätta, så de flyger undan
// utan att stoppa bilen, och de ligger kvar där de hamnar resten av loppet.
//
// at är var på varvet föremålen står (0..1 av banans längd), lateral meter
// från mittlinjen och along meter framåt därifrån.
// ---------------------------------------------------------------------------

const CARTON = [0xb98a52, 0xc79a5e, 0xa97c46];
const CANS = [0xd8362b, 0x2f7fd8, 0xf2c230, 0x43a047, 0xe8e6de];

// Vägg av kartonger tvärs en del av vägen: across stycken i bredd, layers på höjden
export function cartonWall(at, { lateral = 0, along = 0, across = 5, layers = 2 } = {}) {
  const out = [];
  for (let l = 0; l < layers; l++) for (let k = 0; k < across - (l % 2); k++) {
    out.push({ kind: 'carton', at, along, up: l, lateral: lateral + (k - (across - 1 - (l % 2)) / 2) * 0.205, color: CARTON[(k + l) % 3] });
  }
  return out;
}

// Burkpyramid: base burkar i nedersta raden
export function canPyramid(at, { lateral = 0, along = 0, base = 4 } = {}) {
  const out = [];
  for (let l = 0; l < base; l++) for (let k = 0; k < base - l; k++) {
    out.push({ kind: 'tin', at, along, up: l, lateral: lateral + (k - (base - l - 1) / 2) * 0.072, color: CANS[(k + l * 2) % CANS.length] });
  }
  return out;
}

// Rad av koner längs vägen (slalom eller avspärrning)
export function coneRow(at, { lateral = 0, along = 0, count = 5, gap = 0.7, drift = 0 } = {}) {
  return Array.from({ length: count }, (_, k) => ({ kind: 'cone', at, along: along + k * gap, lateral: lateral + k * drift, color: 0xff6a12 }));
}
