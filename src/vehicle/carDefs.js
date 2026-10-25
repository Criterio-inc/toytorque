// ---------------------------------------------------------------------------
// Bildefinitioner. Klasserna anger grunddata (toppfart i mph, sekunder
// till toppfart, vikt i kg, drivning), men varje bil har fått en egen
// personlighet: grepp, vikt, styrning, stabilitet, luftkontroll och studs
// skiljer sig rejält. Inom en klass väger fördelarna upp nackdelarna.
// Namn, form och färg är våra egna. Mått i meter.
// ---------------------------------------------------------------------------

const MPH = 0.44704;

// Gemensam bas; varje bil skriver över det som skiljer.
const BASE = {
  drive: '4WD', // '4WD' | 'RWD' | 'FWD'
  topSpeed: 32 * MPH,
  accTime: 6.9, // sekunder till (nästan) toppfart
  reverseFrac: 0.45, // toppfart bakåt som andel av framåt
  mass: 1.2,
  body: { halfW: 0.115, halfH: 0.045, halfL: 0.25 }, // kollisionslåda
  wheel: { radius: 0.05, width: 0.045, x: 0.118, zF: 0.17, zR: -0.17, attachY: -0.02 },
  susp: { rest: 0.06, travel: 0.04, sag: 0.016, zeta: 0.32 },
  mu: 1.5, // däckens friktionstal
  cornering: 10, // sidogrepp per radian slip (styvhet), skalas med last
  steerMax: 0.36, // rad, största styrutslag vid stillastående
  steerMod: 0.62, // hur mycket styrutslaget minskar vid toppfart
  steerRate: 2.3, // styrningens hastighet (fullt utslag per sekund)
  rearGrip: 1.15, // bakdäckens sidostyvhet relativt fram (>1 = stabilare, mindre sladd)
  rearMu: 1, // bakdäckens friktionstal relativt fram (<1 = sladdglad, >1 = klistrad)
  steerAssist: 1.5, // >1 = kan styra lite över greppgränsen (sladd), 1 = precis vid gränsen
  engineRate: 4.5, // gaspådrag per sekund
  comY: -0.035, // masscentrum under lådans mitt
  rollCenter: 0.55, // 0 = däckkrafter i marken, 1 = i masscentrums höjd
  antiRoll: 60, // krängningshämmare, N per meter skillnad
  brakeMu: 0.9, // bromsens andel av greppet
  rollResist: 0.25, // m/s² utrullning
  airControl: 1.4, // lite luftkontroll (gas tippar nosen, styrning vrider)
  restitution: 0.15, // studs mot väggar och bilar
  bodyFriction: 0.12, // karossens friktion mot väggar och bilar
  landDamp: 22, // hur hårt tippning/roll dämpas efter en landning
  landTime: 0.35, // hur länge landningsdämpningen verkar (s)
  flipDelay: 1.5, // sekunder upp och ner innan bilen vänder sig själv
  assist: 0, // körhjälp 0..1: antispinn och antisladd (nybörjarbilar)
  desc: '',
  style: 'buggy',
  colors: { body: 0xd8352a, trim: 0x1b1d22, accent: 0xffd23f },
};

function def(over) {
  return {
    ...BASE,
    ...over,
    body: { ...BASE.body, ...(over.body || {}) },
    wheel: { ...BASE.wheel, ...(over.wheel || {}) },
    susp: { ...BASE.susp, ...(over.susp || {}) },
    colors: { ...BASE.colors, ...(over.colors || {}) },
  };
}

export const CARS = {
  // Rookie, 4WD, allroundbil. Startbilen. Som alla
  // Rookie-bilar: stabil bakvagn och styrning som stannar vid greppgränsen.
  rasket: def({
    id: 'rasket',
    name: 'Rasket',
    num: 7,
    cls: 'Rookie',
    engine: 'El',
    drive: '4WD',
    wheel: { radius: 0.056, width: 0.055, x: 0.125, attachY: -0.015 },
    susp: { rest: 0.07, travel: 0.05, sag: 0.02, zeta: 0.28 },
    topSpeed: 32.0 * MPH,
    accTime: 6.9,
    mass: 1.2,
    mu: 1.55,
    rearGrip: 1.45,
    rearMu: 1.05,
    steerAssist: 1.1,
    restitution: 0.08,
    desc: 'Allroundbilen: lagom av allt, stabil och lätt att lära sig.',
    style: 'buggy',
    colors: { body: 0xd8352a, trim: 0x1b1d22, accent: 0xffd23f },
  }),

  // Rookie, nybörjarbilen: massor av grepp, körhjälp och lugn styrning.
  // Snäll nog för ett barn, men långsammare än de andra Rookie-bilarna.
  nallen: def({
    id: 'nallen',
    name: 'Nallen',
    num: 5,
    cls: 'Rookie',
    engine: 'El',
    drive: '4WD',
    body: { halfW: 0.118, halfH: 0.048, halfL: 0.245 },
    wheel: { radius: 0.062, width: 0.064, x: 0.13, zF: 0.165, zR: -0.165, attachY: -0.014 },
    susp: { rest: 0.07, travel: 0.05, sag: 0.02, zeta: 0.5 },
    comY: -0.045,
    topSpeed: 29.0 * MPH,
    accTime: 9.5,
    mass: 1.5,
    mu: 2.0,
    cornering: 13,
    steerMax: 0.38,
    rearGrip: 1.6,
    rearMu: 1.15,
    steerAssist: 1.1,
    engineRate: 2.2,
    airControl: 0.7,
    antiRoll: 170,
    restitution: 0.05,
    landDamp: 40,
    landTime: 0.6,
    flipDelay: 0.6,
    assist: 1,
    desc: 'Massor av grepp, lugn och lätt att köra – perfekt för nybörjare.',
    style: 'buggy',
    colors: { body: 0xd9a066, trim: 0x5a3a24, accent: 0xff9ec7 },
  }),

  // Advanced, bakhjulsdriven sladdbil: lågt grepp och styrning långt förbi
  // greppgränsen, så bakvagnen går gärna ut.
  glidaren: def({
    id: 'glidaren',
    name: 'Glidaren',
    num: 21,
    cls: 'Advanced',
    engine: 'Glow',
    drive: 'RWD',
    body: { halfW: 0.12, halfH: 0.04, halfL: 0.26 },
    wheel: { radius: 0.046, width: 0.05, x: 0.12, zF: 0.175, zR: -0.175, attachY: -0.018 },
    susp: { rest: 0.05, travel: 0.035, sag: 0.014, zeta: 0.36 },
    comY: -0.03,
    topSpeed: 38.0 * MPH,
    accTime: 7.0,
    mass: 1.5,
    mu: 1.35,
    cornering: 9.5,
    steerRate: 3.0,
    rearGrip: 1.0,
    steerAssist: 2.0,
    desc: 'Glider genom kurvorna i långa sladdar – snabb för den som vågar.',
    style: 'touring',
    colors: { body: 0x2f6fe0, trim: 0xf2f2f2, accent: 0xff8a1f },
  }),

  // Pro, 4WD, snabb men planterad och förlåtande.
  raketen: def({
    id: 'raketen',
    name: 'Raketen',
    num: 3,
    cls: 'Pro',
    engine: 'Glow',
    drive: '4WD',
    body: { halfW: 0.122, halfH: 0.038, halfL: 0.265 },
    wheel: { radius: 0.047, width: 0.055, x: 0.122, zF: 0.18, zR: -0.175, attachY: -0.018 },
    susp: { rest: 0.048, travel: 0.032, sag: 0.012, zeta: 0.4 },
    comY: -0.03,
    topSpeed: 40.5 * MPH,
    accTime: 5.4,
    mass: 2.0,
    mu: 1.65,
    cornering: 12,
    rearGrip: 1.25,
    desc: 'Stabil fyrhjulsdrift som sitter som berget – förlåtande trots farten.',
    style: 'sport',
    colors: { body: 0xf2c418, trim: 0x15171c, accent: 0xe8331f },
  }),

  // --- Rookie ----------------------------------------------------------------

  // Tung bakhjulsdriven truck: seg i starten men svår att knuffa undan.
  // Extra grepp bak så den inte sladdar trots bakhjulsdriften.
  bjassen: def({
    id: 'bjassen',
    name: 'Bjässen',
    num: 44,
    cls: 'Rookie',
    engine: 'El',
    drive: 'RWD',
    body: { halfW: 0.12, halfH: 0.05, halfL: 0.255 },
    wheel: { radius: 0.064, width: 0.062, x: 0.132, zF: 0.165, zR: -0.165, attachY: -0.012 },
    susp: { rest: 0.075, travel: 0.055, sag: 0.022, zeta: 0.42 },
    comY: -0.04,
    topSpeed: 31.5 * MPH,
    accTime: 9.5,
    mass: 3.0,
    mu: 1.6,
    cornering: 10,
    rearGrip: 1.5,
    rearMu: 1.15,
    steerAssist: 1.05,
    engineRate: 3.0,
    airControl: 0.6,
    antiRoll: 160,
    restitution: 0.05,
    desc: 'Tung som ett kassaskåp: seg i starten, men knuffar undan alla.',
    style: 'truck',
    colors: { body: 0x6b8e23, trim: 0x2a1d12, accent: 0xf39c12 },
  }),

  // Framhjulsdriven gatbil: snäll och förutsägbar, plöjer hellre än sladdar.
  kanelbullen: def({
    id: 'kanelbullen',
    name: 'Kanelbullen',
    num: 16,
    cls: 'Rookie',
    engine: 'El',
    drive: 'FWD',
    body: { halfW: 0.118, halfH: 0.042, halfL: 0.255 },
    wheel: { radius: 0.047, width: 0.05, x: 0.12, zF: 0.17, zR: -0.17, attachY: -0.018 },
    susp: { rest: 0.052, travel: 0.036, sag: 0.015, zeta: 0.36 },
    comY: -0.032,
    topSpeed: 30.5 * MPH,
    accTime: 4.6,
    mass: 1.3,
    mu: 1.45,
    cornering: 10,
    rearGrip: 1.5,
    rearMu: 1.08,
    steerAssist: 1.1,
    engineRate: 6,
    restitution: 0.08,
    desc: 'Snabb från start och snäll i kurvorna, plöjer hellre än sladdar.',
    style: 'touring',
    colors: { body: 0xc8813a, trim: 0xf5e6c8, accent: 0x5a2e12 },
  }),

  // --- Amateur ---------------------------------------------------------------

  // Fjäderlätt 4WD-buggy med bäst acceleration av alla, men lätt att knuffa.
  virveln: def({
    id: 'virveln',
    name: 'Virveln',
    num: 27,
    cls: 'Amateur',
    engine: 'El',
    drive: '4WD',
    wheel: { radius: 0.054, width: 0.052, x: 0.124, attachY: -0.015 },
    susp: { rest: 0.068, travel: 0.05, sag: 0.019, zeta: 0.26 },
    topSpeed: 32.0 * MPH,
    accTime: 3.6,
    mass: 0.8,
    mu: 1.45,
    cornering: 11,
    steerRate: 3.0,
    engineRate: 7,
    airControl: 2.0,
    restitution: 0.28,
    desc: 'Rycker iväg som en raket, men är fjäderlätt och lätt att knuffa runt.',
    style: 'buggy',
    colors: { body: 0x18b8a8, trim: 0x10202a, accent: 0xff4f9a },
  }),

  // Hög och smal truck: hög toppfart men lågt grepp, lutar i kurvorna.
  giraffen: def({
    id: 'giraffen',
    name: 'Giraffen',
    num: 6,
    cls: 'Amateur',
    engine: 'El',
    drive: '4WD',
    body: { halfW: 0.115, halfH: 0.055, halfL: 0.25 },
    wheel: { radius: 0.066, width: 0.058, x: 0.128, zF: 0.165, zR: -0.165, attachY: -0.008 },
    susp: { rest: 0.08, travel: 0.06, sag: 0.025, zeta: 0.28 },
    comY: -0.01,
    rollCenter: 0.62,
    topSpeed: 36.0 * MPH,
    accTime: 6.8,
    mass: 2.2,
    mu: 1.35,
    cornering: 8.5,
    steerMax: 0.34,
    steerMod: 0.7,
    steerAssist: 1.4,
    airControl: 1.0,
    antiRoll: 45,
    desc: 'Hög toppfart på långa ben, men lutar och glider i kurvorna.',
    style: 'truck',
    colors: { body: 0xf2b134, trim: 0x5b3a1a, accent: 0xfff3d6 },
  }),

  // --- Advanced --------------------------------------------------------------

  // Tyngst av alla: långsam acceleration men nästan omöjlig att knuffa ur kurs.
  tjuren: def({
    id: 'tjuren',
    name: 'Tjuren',
    num: 88,
    cls: 'Advanced',
    engine: 'El',
    drive: '4WD',
    body: { halfW: 0.122, halfH: 0.05, halfL: 0.258 },
    wheel: { radius: 0.064, width: 0.064, x: 0.134, zF: 0.168, zR: -0.168, attachY: -0.012 },
    susp: { rest: 0.072, travel: 0.052, sag: 0.02, zeta: 0.42 },
    comY: -0.042,
    topSpeed: 34.5 * MPH,
    accTime: 9.5,
    mass: 3.5,
    mu: 1.6,
    cornering: 10,
    rearGrip: 1.35,
    engineRate: 3.0,
    airControl: 0.6,
    antiRoll: 200,
    restitution: 0.05,
    landDamp: 30,
    desc: 'Tyngst av alla: tar tid att komma upp i fart, men går inte att rubba.',
    style: 'truck',
    colors: { body: 0x8c1c13, trim: 0x1a1a1a, accent: 0xd9d9d9 },
  }),

  // Lättast av alla, framhjulsdriven: kvick, flygvan och studsig.
  flugan: def({
    id: 'flugan',
    name: 'Flugan',
    num: 61,
    cls: 'Advanced',
    engine: 'Glow',
    drive: 'FWD',
    body: { halfW: 0.118, halfH: 0.038, halfL: 0.255 },
    wheel: { radius: 0.046, width: 0.05, x: 0.12, zF: 0.175, zR: -0.17, attachY: -0.018 },
    susp: { rest: 0.048, travel: 0.032, sag: 0.012, zeta: 0.24 },
    comY: -0.03,
    topSpeed: 37.5 * MPH,
    accTime: 5.0,
    mass: 0.7,
    mu: 1.45,
    cornering: 11,
    steerRate: 3.2,
    rearGrip: 1.3,
    steerAssist: 1.6,
    airControl: 2.8,
    restitution: 0.3,
    desc: 'Lättast av alla: kvick och flygvan, men studsar som en pingisboll.',
    style: 'sport',
    colors: { body: 0x2bd45a, trim: 0x101010, accent: 0xf0f0f0 },
  }),

  // --- Semi-Pro --------------------------------------------------------------

  // 4WD glow-sportbil: snabbast ut ur kurvorna, lägre toppfart.
  pilen: def({
    id: 'pilen',
    name: 'Pilen',
    num: 19,
    cls: 'Semi-Pro',
    engine: 'Glow',
    drive: '4WD',
    body: { halfW: 0.12, halfH: 0.038, halfL: 0.26 },
    wheel: { radius: 0.047, width: 0.054, x: 0.121, zF: 0.178, zR: -0.174, attachY: -0.018 },
    susp: { rest: 0.048, travel: 0.032, sag: 0.012, zeta: 0.4 },
    comY: -0.03,
    topSpeed: 37.0 * MPH,
    accTime: 4.8,
    mass: 1.3,
    mu: 1.7,
    cornering: 13,
    steerRate: 2.8,
    rearGrip: 1.25,
    desc: 'Kvick och greppig: snabbast ut ur kurvorna, men lägre toppfart.',
    style: 'sport',
    colors: { body: 0x7a2fd0, trim: 0xf2f2f2, accent: 0x29e0ff },
  }),

  // Bakhjulsdriven glow-bil: lat acceleration men svindlande toppfart.
  draken: def({
    id: 'draken',
    name: 'Draken',
    num: 13,
    cls: 'Semi-Pro',
    engine: 'Glow',
    drive: 'RWD',
    body: { halfW: 0.12, halfH: 0.04, halfL: 0.265 },
    wheel: { radius: 0.047, width: 0.052, x: 0.121, zF: 0.18, zR: -0.18, attachY: -0.018 },
    susp: { rest: 0.05, travel: 0.034, sag: 0.013, zeta: 0.38 },
    comY: -0.03,
    topSpeed: 42.0 * MPH,
    accTime: 11.0,
    mass: 2.0,
    mu: 1.45,
    cornering: 9.5,
    steerMod: 0.7,
    rearGrip: 1.15,
    steerAssist: 1.6,
    engineRate: 3.5,
    desc: 'Svindlande toppfart, men lat i starten och tung i styrningen.',
    style: 'touring',
    colors: { body: 0x111418, trim: 0xd8352a, accent: 0x3fe08a },
  }),

  // --- Pro -------------------------------------------------------------------

  // Lätt bakhjulsdriven glow-sportbil: snabbast på raksträckan, sladdglad.
  kungen: def({
    id: 'kungen',
    name: 'Kungen',
    num: 1,
    cls: 'Pro',
    engine: 'Glow',
    drive: 'RWD',
    body: { halfW: 0.122, halfH: 0.036, halfL: 0.265 },
    wheel: { radius: 0.046, width: 0.056, x: 0.122, zF: 0.18, zR: -0.176, attachY: -0.018 },
    susp: { rest: 0.046, travel: 0.03, sag: 0.011, zeta: 0.42 },
    comY: -0.028,
    topSpeed: 43.5 * MPH,
    accTime: 5.4,
    mass: 1.0,
    mu: 1.5,
    cornering: 12,
    steerRate: 3.4,
    rearGrip: 1.05,
    steerAssist: 1.9,
    desc: 'Snabbast på raksträckan, men nervös bakvagn som kräver mjuk hand.',
    style: 'sport',
    colors: { body: 0xf4f4f6, trim: 0x1846c8, accent: 0xe8b818 },
  }),

  // --- Nya bilar (ralley, formel och ett rymdskepp) --------------------------

  // Rookie: fjäderlätt framhjulsdriven rallyhalvkombi, högst toppfart i
  // klassen och svävar långt i hoppen, men lite mindre grepp.
  smulan: def({
    id: 'smulan',
    name: 'Smulan',
    num: 12,
    cls: 'Rookie',
    engine: 'El',
    drive: 'FWD',
    body: { halfW: 0.116, halfH: 0.044, halfL: 0.245 },
    wheel: { radius: 0.05, width: 0.05, x: 0.12, zF: 0.165, zR: -0.165, attachY: -0.016 },
    susp: { rest: 0.058, travel: 0.042, sag: 0.017, zeta: 0.3 },
    comY: -0.034,
    topSpeed: 34.5 * MPH,
    accTime: 8.6,
    mass: 0.75,
    mu: 1.4,
    cornering: 11,
    rearGrip: 1.45,
    rearMu: 1.05,
    steerAssist: 1.1,
    engineRate: 5,
    airControl: 2.4,
    restitution: 0.1,
    desc: 'Fjäderlätt hoppboll: högst toppfart i klassen och svävar långt, men lite mindre grepp.',
    style: 'rally',
    colors: { body: 0xf4f1e6, trim: 0x1d3f8f, accent: 0xe8332a },
  }),

  // Amateur: fyrhjulsdriven rallybil med klistergrepp och stadiga landningar.
  grusgrisen: def({
    id: 'grusgrisen',
    name: 'Grusgrisen',
    num: 35,
    cls: 'Amateur',
    engine: 'El',
    drive: '4WD',
    body: { halfW: 0.117, halfH: 0.044, halfL: 0.248 },
    wheel: { radius: 0.052, width: 0.052, x: 0.122, zF: 0.168, zR: -0.168, attachY: -0.015 },
    susp: { rest: 0.062, travel: 0.046, sag: 0.018, zeta: 0.36 },
    comY: -0.034,
    topSpeed: 33.0 * MPH,
    accTime: 5.6,
    mass: 1.7,
    mu: 1.75,
    cornering: 11,
    rearGrip: 1.3,
    rearMu: 1.05,
    steerAssist: 1.4,
    airControl: 1.2,
    antiRoll: 100,
    landDamp: 32,
    desc: 'Klistrar fast i allt underlag och landar stadigt, men har låg toppfart.',
    style: 'rally',
    colors: { body: 0xf07ab0, trim: 0x2a1530, accent: 0xffe14a },
  }),

  // Amateur: lätt formelbil med bakhjulsdrift, vass styrning som sladdar.
  spurten: def({
    id: 'spurten',
    name: 'Spurten',
    num: 24,
    cls: 'Amateur',
    engine: 'El',
    drive: 'RWD',
    body: { halfW: 0.115, halfH: 0.036, halfL: 0.26 },
    wheel: { radius: 0.048, width: 0.058, x: 0.128, zF: 0.185, zR: -0.17, attachY: -0.018 },
    susp: { rest: 0.046, travel: 0.03, sag: 0.011, zeta: 0.42 },
    comY: -0.028,
    topSpeed: 35.0 * MPH,
    accTime: 5.4,
    mass: 1.0,
    mu: 1.4,
    cornering: 12,
    steerMax: 0.34,
    steerMod: 0.6,
    steerRate: 3.4,
    rearGrip: 1.0,
    steerAssist: 1.9,
    engineRate: 6,
    desc: 'Sladdkung på bakhjulen: vass styrning och sladdar för minsta gaspådrag.',
    style: 'formula',
    colors: { body: 0xe21f26, trim: 0xf2f2f2, accent: 0x111111 },
  }),

  // Advanced: glowdriven rallybil med enormt grepp. Belöning i tidskörning.
  lerkakan: def({
    id: 'lerkakan',
    name: 'Lerkakan',
    num: 52,
    cls: 'Advanced',
    engine: 'Glow',
    drive: '4WD',
    body: { halfW: 0.118, halfH: 0.044, halfL: 0.25 },
    wheel: { radius: 0.052, width: 0.054, x: 0.123, zF: 0.17, zR: -0.17, attachY: -0.015 },
    susp: { rest: 0.06, travel: 0.044, sag: 0.017, zeta: 0.34 },
    comY: -0.034,
    topSpeed: 35.5 * MPH,
    accTime: 6.2,
    mass: 1.8,
    mu: 1.8,
    cornering: 11.5,
    rearGrip: 1.3,
    rearMu: 1.05,
    steerAssist: 1.4,
    antiRoll: 100,
    landDamp: 32,
    desc: 'Rallybil med enormt grepp och stadiga landningar, men lägre toppfart.',
    style: 'rally',
    colors: { body: 0x8a5a2b, trim: 0x101010, accent: 0x9be03a },
  }),

  // Semi-Pro: lätt glowdriven formelbil med blixtsnabb styrning. Belöning i tidskörning.
  vinden: def({
    id: 'vinden',
    name: 'Vinden',
    num: 17,
    cls: 'Semi-Pro',
    engine: 'Glow',
    drive: 'RWD',
    body: { halfW: 0.116, halfH: 0.035, halfL: 0.265 },
    wheel: { radius: 0.048, width: 0.06, x: 0.13, zF: 0.19, zR: -0.172, attachY: -0.018 },
    susp: { rest: 0.045, travel: 0.03, sag: 0.011, zeta: 0.45 },
    comY: -0.027,
    topSpeed: 39.5 * MPH,
    accTime: 6.4,
    mass: 1.0,
    mu: 1.6,
    cornering: 14,
    steerRate: 3.0,
    rearGrip: 1.3,
    steerAssist: 1.4,
    airControl: 1.0,
    desc: 'Rakbladsvass formelbil: blixtsnabb styrning, men lätt att knuffa.',
    style: 'formula',
    colors: { body: 0x1fb6e8, trim: 0x0d1b3a, accent: 0xfff04a },
  }),

  // Semi-Pro: tung glow-truck, brutal i närkamp och svår att välta.
  bulldoggen: def({
    id: 'bulldoggen',
    name: 'Bulldoggen',
    num: 77,
    cls: 'Semi-Pro',
    engine: 'Glow',
    drive: '4WD',
    body: { halfW: 0.122, halfH: 0.05, halfL: 0.258 },
    wheel: { radius: 0.064, width: 0.064, x: 0.134, zF: 0.168, zR: -0.168, attachY: -0.012 },
    susp: { rest: 0.07, travel: 0.05, sag: 0.02, zeta: 0.42 },
    comY: -0.042,
    topSpeed: 37.5 * MPH,
    accTime: 8.0,
    mass: 3.3,
    mu: 1.6,
    cornering: 10,
    rearGrip: 1.3,
    engineRate: 3.2,
    airControl: 0.7,
    antiRoll: 200,
    restitution: 0.05,
    desc: 'Brutal i närkamp och svår att välta, men trög i kurvorna.',
    style: 'truck',
    colors: { body: 0x3a3f47, trim: 0xf0a020, accent: 0xf0a020 },
  }),

  // Pro: fyrhjulsdriven formelbil, greppmonstret.
  kometen: def({
    id: 'kometen',
    name: 'Kometen',
    num: 2,
    cls: 'Pro',
    engine: 'Glow',
    drive: '4WD',
    body: { halfW: 0.116, halfH: 0.035, halfL: 0.265 },
    wheel: { radius: 0.048, width: 0.062, x: 0.13, zF: 0.19, zR: -0.172, attachY: -0.018 },
    susp: { rest: 0.045, travel: 0.03, sag: 0.011, zeta: 0.42 },
    comY: -0.027,
    topSpeed: 40.5 * MPH,
    accTime: 5.0,
    mass: 1.5,
    mu: 1.9,
    cornering: 15,
    steerRate: 2.8,
    rearGrip: 1.3,
    steerAssist: 1.4,
    airControl: 1.0,
    desc: 'Greppmonster som går genom kurvorna som på räls, lägre toppfart.',
    style: 'formula',
    colors: { body: 0x1c1c22, trim: 0xff6a00, accent: 0x35e0ff },
  }),

  // Pro, hemlig: ett flygande tefat på hjul. Snabbast av alla, styr i luften.
  rymdskeppet: def({
    id: 'rymdskeppet',
    name: 'Rymdskeppet',
    num: 99,
    cls: 'Pro',
    engine: 'El',
    drive: '4WD',
    secret: true,
    body: { halfW: 0.12, halfH: 0.04, halfL: 0.25 },
    wheel: { radius: 0.048, width: 0.056, x: 0.125, zF: 0.17, zR: -0.17, attachY: -0.018 },
    susp: { rest: 0.05, travel: 0.034, sag: 0.012, zeta: 0.38 },
    comY: -0.034,
    topSpeed: 44.5 * MPH,
    accTime: 5.2,
    mass: 1.3,
    mu: 1.55,
    cornering: 12,
    rearGrip: 1.25,
    airControl: 3.6,
    restitution: 0.25,
    desc: 'Svävar som ett tefat: snabbast av alla och styr i luften, men halt.',
    style: 'saucer',
    colors: { body: 0xb8c4d0, trim: 0x2a2f3a, accent: 0x66ff7a },
  }),
};

export const CLASSES = ['Rookie', 'Amateur', 'Advanced', 'Semi-Pro', 'Pro'];

// Bilarna i klassordning
export const CAR_ORDER = [
  'rasket', 'nallen', 'bjassen', 'kanelbullen', 'smulan',
  'virveln', 'giraffen', 'grusgrisen', 'spurten',
  'glidaren', 'tjuren', 'flugan', 'lerkakan',
  'pilen', 'draken', 'vinden', 'bulldoggen',
  'raketen', 'kungen', 'kometen', 'rymdskeppet',
];

// Bilarna i en klass, i CAR_ORDER-ordning
export const carsInClass = (cls) => CAR_ORDER.map((id) => CARS[id]).filter((c) => c.cls === cls);
export const toMph = (ms) => ms / MPH;

const clamp01 = (x) => Math.max(0, Math.min(1, x));

// Bilens egenskaper som staplar 0..1 (bilvalet och testerna):
// fart, acceleration, grepp, vikt och svårighet. Svårigheten väger ihop hur
// lätt bilen sladdar (styrning förbi greppgränsen, bakhjulsdrift, lågt grepp,
// orolig bakvagn),
// hur snabb och kvick den är, och drar av för körhjälp.
export function carStats(d) {
  const mph = toMph(d.topSpeed);
  const hard = 0.35 * (d.steerAssist - 1)
    + (d.drive === 'RWD' ? 0.15 : 0)
    + 0.2 * (mph - 26) / 19
    + 0.25 * (1.9 - d.mu * Math.min(1, d.rearMu)) / 0.6
    + 0.25 * (1.5 - d.rearGrip * d.rearMu) / 0.6
    + 0.1 * (d.steerRate - 2) / 1.6
    - 0.5 * d.assist;
  return {
    fart: clamp01((mph - 26) / 19),
    acc: clamp01((12 - d.accTime) / 9),
    grepp: clamp01((d.mu * Math.min(1, d.rearMu) - 1.2) / 0.85),
    vikt: clamp01((d.mass - 0.5) / 3.1),
    svar: clamp01(hard),
  };
}

// Greppet datorförarna räknar med i kurvorna: däckens friktion, men lägre för
// sladdglada bakdäck och för bilar vars styrning inte når ända ut till
// greppgränsen (låg steerAssist). aiPace finjusterar per bil.
export const aiGrip = (d) => d.mu * Math.min(1, d.rearMu ?? 1) * Math.min(1, 0.68 + 0.64 * ((d.steerAssist ?? 1.5) - 1)) * (d.aiPace ?? 1);
