# ToyTorque, version 2: banor utan kanter

Plan för ett senare ombygge, efter tester, granskning och DMG av version 1.

## Målbild

Planen är banor utan vägkanter. Banan är rummet självt: väggar, kyldiskar, hyllor, kassadiskar, trappor, rabatter och staket stänger in bilen. Det som visar vägen är golvet, med målade linjer, kakelrader, mattor, pilar och skyltar. Man kan köra fritt på hela golvet, och det som stoppar en är saker som finns på riktigt i världen.

I dag är varje bana ett vägband med låga sarger längs båda sidor, och miljön ligger runt omkring som dekor. Det ska vändas: miljön blir banan.

## Vad som ändras i motorn

1. **Banlinjen blir osynlig.** Mittlinjen finns kvar som en rutt, eftersom den behövs för varvräkning, placering, kontrollpunkter, återställning med F och datorförarnas körlinje. Men den ritar inget vägband och bygger inga sarger. En ny inställning på banan, `edges: 'world'`, stänger av vägbandet och sargerna. Gamla banor fungerar som förut tills de byggs om.

2. **Det som syns är det som stoppar.** En hjälpfunktion, `solid(...)`, skapar både bilden och kollisionen av samma mått. Då kan det inte uppstå osynliga väggar eller saker man kör rakt igenom. Det är samma typ av fel som de vi har hittat i Lagret och Kvarteret nu.

3. **Golvet visar vägen.** Från rutten genereras golvmarkeringar: målad tejp, kantlinjer, en rad röda klinkers, mattlöpare eller grusgångar. Varje bana väljer stil. Pilar och varningsskyltar ställs ut automatiskt före skarpa kurvor, precis som i dag.

4. **Korridorer i stället för vägbredd.** Banans bredd bestäms av hur långt det är mellan väggarna, inte av ett tal i banfilen. En avståndskarta räknas ut från alla hinder när banan laddas. Den visar hur mycket fritt golv som finns på varje punkt längs rutten.

5. **Datorförarna läser av rummet.** Körlinjen läggs inom den fria ytan från avståndskartan, så att förarna kan skära kurvor nära en kyldisk utan att köra in i den. Strålar framåt och åt sidorna fångar hinder som ligger i vägen, som kundvagnar eller annat löst. Genvägar blir alternativa vägar i ett nät av ruttpunkter i stället för specialfall.

6. **Varvräkning och återställning.** Kontrollpunkterna blir portar tvärs över korridoren, mellan väggarna. F och automatisk återställning sätter bilen på närmaste ruttpunkt framåt, mitt i korridoren och åt rätt håll.

7. **Fel väg och utanför banan.** Eftersom golvet är öppet kan man köra in i en återvändsgränd eller ett sidorum. Det är tillåtet. Om man åker baklänges längs rutten visas en varning, och man blir återställd först om man fastnat på riktigt.

## Banorna en och en

Banor där rummet redan är en naturlig bana byggs om först:

| Ordning | Bana | Naturliga kanter |
|---|---|---|
| 1 | Supermarketen | Hyllgångar, kyldiskar, frysdiskar, kassadiskar och lastkaj. Röda klinkerrader visar vägen. |
| 2 | Museet | Salsväggar, montrar, trappor mellan våningar och avspärrningsrep. |
| 3 | Lagret | Pallställ, pallstaplar, containrar och lastbilsramper. Gul golvtejp. |
| 4 | Köket | Köksskåp, bord och stolsben, golvlister och mattkanter. |
| 5 | Leksaksaffären | Hyllgondoler, disk och leksaksberg. |
| 6 | Kryssaren | Reling, däckshus, trappor mellan däck och livbåtar. |
| 7 | Spökstaden | Husväggar, trottoarkanter, staket och ladugårdar. |
| 8 | Trädgården | Rabattkanter, häckar, krukor, staket och gräsmattekanter. |
| 9 | Kvarteret | Trottoarkanter, staket, häckar, bilar och garage. |

Utomhusbanorna får mjukare kanter, till exempel trottoarkanter, gräs som bromsar och häckar.

Banbyggaren får byggdelar som är väggar och rum i stället för vägbitar med sarg.

## Arbetsgång

1. **Motorn (en agent):** `edges: 'world'`, `solid()`, golvmarkeringar, avståndskartan, korridorbredd, nya kontrollportar och återställning. Den provas på en enkel testbana.
2. **Datorförarna (en agent):** körlinje inom fri yta, hinderstrålar och ruttnät för genvägar.
3. **Supermarketen först (en agent):** byggs om helt som pilot. Du provkör och säger vad du tycker innan resten byggs om.
4. **Övriga åtta banor:** tre agenter i taget, en grupp åt gången.
5. **Tester:**
   - en fri-yta-kontroll som visar att korridoren inte är för smal någonstans,
   - letning efter ställen där bilar fastnar, med alla bilar på alla banor,
   - varvtester och fullt fält,
   - prestanda per bana.
6. **Granskningsrunda,** sedan en ny DMG och webbversion.

## Risker

- **Datorförarna är det svåraste.** Utan sarger kan de köra in i sidorum. Avståndskartan och ruttportarna ska förhindra det, men det kräver mycket provkörning.
- **Fler kolliderare kan göra fysiken tyngre.** Väggar och hyllor slås därför ihop till få stora kolliderare per rum.
- **Öppna golv gör banorna lättare att förstå fel.** Golvmarkeringar och skyltar måste vara tydliga, annars vet spelaren inte vart den ska.
- **Omfattningen** är ungefär som att bygga om Köket nio gånger plus en ny motor. Räkna med flera arbetsdagar med agenter.
