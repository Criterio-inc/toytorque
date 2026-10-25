// ---------------------------------------------------------------------------
// Vapnen (pickups). Sannolikheter i procent per placering:
// ledaren får mest försvar och attack framåt, den sista mest ikapphämtning.
// Tider och styrkor i meter och sekunder.
// ---------------------------------------------------------------------------

export const WEAPONS = {
  shockwave: { name: 'Chockvåg', shots: 1 },
  firework: { name: 'Fyrverkeri', shots: 1 },
  fireworkPack: { name: 'Fyrverkeripack', shots: 3 },
  electro: { name: 'Elchock', shots: 1 },
  bomb: { name: 'Bomb', shots: 1, onPickup: true },
  oil: { name: 'Oljefläck', shots: 1 },
  balloons: { name: 'Vattenballonger', shots: 3 },
  bearing: { name: 'Kullager', shots: 1 },
  turbo: { name: 'Turbobatteri', shots: 1 },
  clone: { name: 'Falsk pickup', shots: 1 },
  star: { name: 'Stjärna', shots: 1 },
};

//                 1:a  mitten  sist  dator
const TABLE = {
  shockwave:    [5, 10, 20, 10],
  firework:     [18, 10, 3, 10],
  fireworkPack: [5, 10, 15, 5],
  bomb:         [10, 10, 2, 10],
  balloons:     [5, 10, 15, 10],
  electro:      [18, 10, 2, 5],
  oil:          [18, 10, 2, 15],
  bearing:      [4, 10, 21, 15],
  turbo:        [8, 10, 17, 10],
  clone:        [9, 10, 2, 10],
  star:         [0, 0, 1, 0],
};

// Slumpa ett vapen. col: 0 = ledare, 1 = mitten, 2 = sist, 3 = datorförare.
export function rollWeapon(col, rand = Math.random) {
  const ids = Object.keys(TABLE);
  const total = ids.reduce((s, id) => s + TABLE[id][col], 0);
  let r = rand() * total;
  for (const id of ids) {
    r -= TABLE[id][col];
    if (r <= 0) return id;
  }
  return ids[0];
}

// Kolumn utifrån placering
export function tableColumn(position, count, isPlayer) {
  if (!isPlayer) return 3;
  if (position === 1) return 0;
  if (position === count) return 2;
  return 1;
}

export const TUNE = {
  pickupRegrow: 10, // s innan en plockad pickup växer tillbaka
  pickupRadius: 0.42,
  rouletteTime: 2.2, // spelarens roulette
  shockwave: { speed: 22, life: 2, radius: 1.1, lift: 4.2 },
  firework: { speed: 18, life: 1.6, lockRange: 25, lockCone: 0.5, turn: 5, blast: 1.2, lift: 3.2 },
  electro: { time: 10, range: 1.0, stun: 3.5 },
  bomb: { fuse: 10, passCooldown: 1, blast: 1.4, lift: 4.5 },
  oil: { life: 30, radius: 0.55, slip: 2.5 },
  balloons: { fwd: 9, up: 5, burst: 0.8, wet: 1.6 },
  bearing: { life: 30, radius: 0.11, mass: 3 },
  turbo: { time: 8, top: 1.12, power: 1.5 },
  clone: { blast: 1.0, lift: 3.5 },
  star: { stun: 3 },
};
