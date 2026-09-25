# ygo-tracker

Tracker per duelli di Yu-Gi-Oh! tra amici: contatore LP, storico partite, classifica dei mazzi,
liste carte con import/export `.ydk` e un **Laboratorio regole** per verificare le interazioni tra carte.

Sito: https://p3rzy.github.io/ygo-tracker/

## File

- `index.html` — struttura delle pagine
- `style.css` — stili
- `app.js` — tracker (duello, partite, statistiche, mazzi, sincronizzazione JSONBin)
- `lab.js` — Laboratorio regole

## Laboratorio regole

Il Laboratorio usa il motore di [EDOPro](https://github.com/edo9300/edopro) per applicare regole ed effetti ufficiali.
Tutti i componenti vengono scaricati dai CDN al momento dell'uso; nessuno è copiato in questo repository.

| Componente | Autori | Licenza |
|---|---|---|
| [ygopro-core](https://github.com/edo9300/ygopro-core) (motore delle regole) | Project Ignis / edo9300 | AGPLv3 |
| [ocgcore-wasm](https://github.com/n1xx1/ocgcore-wasm) (motore compilato per il browser) | n1xx1 | MIT |
| [CardScripts](https://github.com/ProjectIgnis/CardScripts) (script degli effetti) | Project Ignis | AGPLv3 |
| [Distribution](https://github.com/ProjectIgnis/Distribution) (testi di sistema, nomi archetipi) | Project Ignis | AGPLv3 |
| Dati e immagini delle carte | [YGOPRODeck](https://ygoprodeck.com) | secondo i termini di YGOPRODeck |

Il database delle carte di EDOPro (BabelCDB) non dichiara una licenza e **non viene usato**: i dati delle carte
arrivano da YGOPRODeck e sono convertiti nel formato del motore. Gli archetipi sono ricavati dai nomi delle carte,
quindi in rari casi possono differire da quelli ufficiali.

## Licenza

Questo progetto è distribuito sotto licenza **GNU Affero General Public License v3.0** (vedi `LICENSE`),
necessaria perché integra il motore di EDOPro.

Progetto non ufficiale e senza scopo di lucro, non affiliato a Konami né a Project Ignis.
Yu-Gi-Oh! e i relativi nomi, testi e immagini delle carte sono proprietà dei rispettivi titolari.
