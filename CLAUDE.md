# CLAUDE.md: ToyTorque

Arbetsregler för Claude Code i det här repot. Läs hela filen innan du ändrar något.

## Vad det här är

ToyTorque är ett racingspel med radiostyrda leksaksbilar. Det körs i webbläsaren och som Mac-app via Tauri, och är byggt med Vite, three.js och Rapier (`@dimforge/rapier3d-compat`). Repot är publikt under MIT-licensen. Ägare är Pär Levander (Critero Consulting). Han är inte utvecklare, så förklara val och resultat på enkel svenska.

Spelet hade ett arbetsnamn fram till 2026-10-25, och därför heter den lokala mappen fortfarande `~/Projects/revolt`. Den äldre historiken finns i ett privat arkivrepo och ska inte föras över hit.

## Inspiration, inte lån

Detta är den viktigaste regeln i repot. Spelet får ta intryck av andra spel men får aldrig innehålla deras namn, banor, karaktärer, citat, logotyper eller varumärken. Det gäller kod, kommentarer, skyltar i banorna, bil- och förarnamn, dokumentation och commit-meddelanden.

- Skriv aldrig namnet på förebildsspelet. I kommentarer skriver du vad koden gör, inte vilket spel den härmar.
- Nya namn på bilar, förare, banor och leksaksmärken ska vara egna. Kolla att de inte ligger nära ett känt varumärke. Det gäller även namn som bara liknar ett känt varumärke, till exempel en seriefigur eller en tidning.
- Bygg inte en bana efter skärmdumpar från ett annat spel. Teman som kök, museum eller trädgård är fria, men dragningen ska vara egen.
- Inga filer (modeller, texturer, ljud, typsnitt) från andra får läggas in utan en licens som tillåter det. Ny tredjepartskod läggs till i `THIRD_PARTY_LICENSES.txt` och `public/licenser.txt`, och nämns i menyns "Om spelet".

## Kommandon

```bash
npm run dev     # Vite, http://localhost:5173 (launch.json-namn "revolt", port 5190)
npm test        # scripts/sim-test.mjs: körtester utan grafik i Node, ungefär 250 st
npm test rasket # bara tester för en bil eller bana
npm run build   # dist/ med base './' (fungerar i undermapp och i Tauri)
npm run app     # Tauri-bygge, universal Mac-app
./scripts/release.sh  # signerad och notariserad DMG på Skrivbordet
```

Kör `npm test` och `npm run build` innan du säger att något är klart. Ändringar som syns i spelet ska också provköras i webbläsaren. `?level=<id>&car=<id>&ai=0..7&diff=easy|normal|hard` startar ett lopp direkt utan meny, och `window.DBG` finns i dev-läge för felsökning.

## Arkitektur

- `src/main.js` laddar Rapier, skapar `Game`, menyn och ljudet. Listan `LEVELS` styr banvalet.
- `src/core/`: `game.js` äger renderare, fysikvärld, nivå, bilar, lopp, kamera och HUD. `physics.js` har fast steg på 120 Hz och kollisionsgrupper. `events.js` är händelsekanalen (`game.events`).
- `src/vehicle/`: `vehicle.js` är ett raycast-fordon med däckmodell, `carDefs.js` innehåller alla 21 bilar i fem klasser, och `carModel.js`, `carShell.js` och `carParts.js` ritar karosserna i kod.
- `src/level/`: varje bana är data (`<bana>.js`: rutt, höjder, hopp, genvägar) plus en art-fil (`<tema>Art.js`) som bygger miljön. `levelBuilder.js` bygger fysiken utan scen, så att testerna kan köra banorna i Node.
- `src/track/track.js`: `buildTrackData` är ren data med `nearest`, `poseAt` och ideallinje. Vägen är en trimesh-collider.
- `src/race/`: lopp, placering, mästerskap, framsteg, spökbil och repris.
- `src/ai/pathFollower.js`: datorförarna.
- `src/weapons/`: vapen, sannolikheter per placering och effekter.
- `src/audio/`: all musik och alla ljud syntetiseras med Web Audio. Det finns inga ljudfiler.
- `src/editor/`: banbyggaren. `src/stunt/`: stuntarenan.
- `src/ui/`: meny, HUD och starteffekter. Loggan är en SVG i `menu.js`.

Enheterna är SI och skalan är riktig RC-skala: bilen är ungefär 0,5 m lång och gravitationen är 11 m/s².

## Lägga till en bana

1. Skapa `src/level/<id>.js` med nivådata och vid behov en art-fil.
2. Lägg till den i `LEVELS` i `src/main.js` och i banlistorna i `scripts/sim-test.mjs`.
3. Ge den en beskrivning i `menu.js`, musik i `audio/music.js` och en tidsutmaning i `race/progress.js`.
4. Kör `npm test`. Alla bilar ska klara tre varv utan att välta eller fastna.

Lärdomar om banor: ett hopp ska ligga på en rak med fartsträcka och vara linjärt brant ända ut i kanten. Starten ska ligga mitt på en raksträcka. Kurvradier måste vara större än vägbredden, annars korsar kantvallarna banan.

## Saker som inte får ändras

- Nycklarna i localStorage heter `revolt.*` (`revolt.settings`, `revolt.progress`, `revolt.ghost.<bana>.<bil>` med flera) av historiska skäl. Byter du namn på dem försvinner spelarnas sparade framsteg.
- `base: './'` i `vite.config.js` måste vara kvar, eftersom webbversionen ligger i en undermapp och Mac-appen läser filerna lokalt.
- Bundle-id:t `se.criteroconsulting.toytorque` ska vara kvar så att Mac-appen uppdateras på plats.

## Publicering

- **GitHub:** `Criterio-inc/toytorque` (publikt). Commit-meddelanden skrivs på svenska.
- **Webben:** spelet ligger på `https://www.criteroconsulting.se/spel/toytorque/`. Det byggs från `origin/main` med `node verktyg/spel.mjs toytorque` i `~/Projects/criteroconsulting-webb` (kräver nätverk utanför sandlådan). Pusha till main först.
- **Mac-appen:** `./scripts/release.sh`. Certifikatet och lösenordet hämtas ur nyckelringen och får aldrig skrivas ut eller läggas i repot.

## Stil

- Kod, kommentarer och gränssnittstexter skrivs på svenska. Följ stilen i den kringliggande koden.
- Kommentarer förklarar varför, inte vad.
- Inga hemligheter, personuppgifter eller filer från `_ref/` får hamna i git.
