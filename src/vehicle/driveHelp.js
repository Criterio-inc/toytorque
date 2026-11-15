import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Körhjälp för spelaren, utöver antisladd och antispinn i fordonet:
//  - Bromshjälp: bilen släpper gasen och bromsar själv inför kurvor om den
//    går fortare än banan tål. Spelaren kan hålla gasen i botten.
//  - Styrhjälp: rattutslaget jämnas ut mot det vägen kräver, och bilen rätar
//    upp sig längs vägen när spelaren inte styr.
// Styrkan följer inställningen Körhjälp (Av 0, Normal 0,4, Mycket 1).
// Datorförarna använder inte detta, de har sin egen förare.
//
// Ren funktion: läser bilen, loppläget och banan och ger nya styrdon.
// ---------------------------------------------------------------------------

const _out = { throttle: 0, steer: 0 };
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();

export function helpControls(controls, vehicle, racer, track, level) {
  if (!(level > 0) || !track?.lineSpeed || racer.trackIndex < 0 || vehicle.grounded < 2) return controls;
  const T = track, N = T.N, i = racer.trackIndex;
  const lv = vehicle.body.linvel();
  const speed = Math.hypot(lv.x, lv.z);
  let throttle = controls.throttle || 0, steer = controls.steer || 0;

  // --- Bromshjälp -----------------------------------------------------------
  // Banans egen fartkurva (samma som datorförarna kör efter) har inbromsningen
  // inräknad. Normal tillåter en bra bit över den, Mycket nästan ingenting.
  const ahead = Math.round((1.5 + speed * 0.35) / T.spacing);
  let target = Infinity;
  for (let k = 0; k <= ahead; k += 2) target = Math.min(target, T.lineSpeed[(i + k) % N]);
  const allowed = target * (1.32 - 0.26 * level);
  if (throttle > 0 && speed > allowed) {
    const over = (speed - allowed) / Math.max(allowed, 1);
    throttle = over > 0.06 ? -Math.min(1, over * 6) * level : 0;
  }

  // --- Styrhjälp -------------------------------------------------------------
  // Tangenter ger allt eller inget, och det är lätt att styra för mycket och
  // pendla mellan väggarna. Hjälpen räknar ut vilket rattutslag vägen kräver
  // (mot en punkt en bit fram, i den fil bilen redan ligger i) och blandar in
  // det i spelarens styrning. Utan styrning rätar bilen upp sig längs vägen.
  // Styr spelaren tydligt åt andra hållet får spelaren bestämma.
  if (speed > 1.5) {
    const p = T.pts[i], n = T.normals[i], pos = vehicle.currPos;
    const lat = (pos.x - p.x) * n.x + (pos.z - p.z) * n.z;
    const lim = T.roadHalf * 0.6;
    const tp = T.poseAt((i + Math.round((2.2 + speed * 0.22) / T.spacing)) % N, Math.max(-lim, Math.min(lim, lat)));
    _q.copy(vehicle.currQuat).invert();
    _v.set(tp.x - pos.x, 0, tp.z - pos.z).applyQuaternion(_q);
    const angle = Math.atan2(_v.x, _v.z); // + = vänster, samma räknesätt som datorförarna
    const ideal = Math.max(-1, Math.min(1, angle / (vehicle.def.steerMax * 0.8)));
    // Utan styrning tar hjälpen det mesta själv, så att bilen följer vägen genom mjuka kurvor
    let k = (Math.abs(steer) < 0.05 ? 0.88 : 0.62) * level;
    // En bit utanför vägen släpper hjälpen taget: på öppna banor ska det gå att gena över gräset
    k *= Math.max(0, Math.min(1, 1 - (Math.abs(lat) - T.roadHalf) / 2.5));
    if (steer * ideal < 0 && Math.abs(steer) > 0.5) k *= 0.3;
    steer = steer * (1 - k) + ideal * k;
  }
  _out.throttle = throttle; _out.steer = steer;
  return _out;
}

