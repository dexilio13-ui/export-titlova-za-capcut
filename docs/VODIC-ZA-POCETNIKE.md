# Vodič za početnike — Export titlova za CapCut

Ovaj vodič je za osobe koje **nikada nisu pokrenule web aplikaciju ili svoj server**.
Pročitaj od početka do kraja; sve komande su tačne i kopiraju se jedna po jedna.

---

## Deo 1 — Šta je ovo i kome je namenjeno

**Problem:** imaš video (TikTok, Reels, Shorts, intervju, podcast) i na njemu neko govori.
Ručno prepisivanje titlova oduzima sat vremena.

**Rešenje:** ubaciš video na sajt, dobiješ transkripciju sa tačnim vremenima (timestamp),
preuzmeš `.srt` fajl i uvezeš ga u CapCut — CapCut sam podeli ekran na segmente.

**Link za testiranje:** <https://dexilio13-ui.github.io/export-titlova-za-capcut/>

Ne treba ništa da instaliraš — radi se u browseru (Chrome, Edge, Firefox, Safari).

---

## Deo 2 — Kako koristiti sajt (3 koraka)

### Korak 1: Izaberi jezik
Na vrhu kartice je padajuća lista **Language / Jezik**. Podrazumevano je **Serbian**.
Ako video nije na srpskom, izaberi odgovarajući jezik — model će lakše prepoznati reči.

### Korak 2: Ubaci video
- **Prevuci fajl** na veliko područje, **ili** klikni **Choose video** i izaberi fajl sa računara
- Prihvatljivi formati: **MP4** i **MOV**
- Ako je fajl prevelik ili nije MP4/MOV, sajt će ti reći **šta je tačno problem**
- Odmah ispod videa se vide: ime fajla, veličina i dužina videa

### Korak 3: Pokreni transkripciju
Klikni **Transcribe video** i sačekaj. Ispod se vide koraci:

```
Uploading video…        ████████░░  68%
Preparing audio…
Transcribing Serbian speech…
Creating subtitles…
Done ✓
```

> **Napomena:** prvi put posle pauze traje 30–60 sekundi (server se "budi" — besplatni plan Rendera).
> Sledeći put je brzo.

---

## Deo 3 — Šta da radiš sa transkripcijom

Kad se traci završi, dobijaš 4 dugmeta i listu linija:

| Dugme | Šta radi |
|---|---|
| **Download SRT** | Preuzima `ime-videa.sr.srt` — ovo uvoziš u CapCut |
| **Download TXT** | Preuzima `ime-videa.transcript.txt` — čist tekst, bez vremena i brojeva |
| **Copy all** | Kopira ceo tekst u clipboard (za dokumenta, prezentacije, prevod) |
| **Copy** (svaka linija) | Kopira samo tu jednu rečenicu |
| **Show timestamps** | Uključuje/isključuje prikaz vremena pored teksta |

### Izmena teksta pre preuzimanja
Ako je nešto pogrešno prepoznato (čest je slučaj sa imenima, brojevima, žargonom):

1. Klikni **Edit text** na toj liniji
2. Ispravi tekst u velikom polju
3. Ako treba, popravi i **Start** / **End** vreme (format `00:00:03,620`)
4. Klikni **Save changes**

Vremena se **ne menjaju** dok ih sam ne izmeniš — sve ostaje tačno prema zvuku.

---

## Deo 4 — Uvoz titlova u CapCut (5 koraka)

1. U CapCut-u otvori projekat i idi na **Text** (Tekst)
2. Klikni **Import subtitles** / **Import captions**
3. Izaberi preuzeti `.srt` fajl
4. CapCut popuni tekst i **sam razdeli timeline** na segmente prema vremenima
5. Stilizuj kako hoćeš (font, boja, animacija) i eksportuj

**Saveti:**
- Ako ti nešto ne radi u mobilnoj verziji CapCut-a, koristi desktop verziju
- Edituj titlove u CapCut-u, ne u SRT fajlu — brže je
- Ako je neki segment premalen (npr. 0.2 s), obriši ga u CapCut-u da ne „treperi"

---

## Deo 5 — Rešavanje problema

| Poruka na sajtu | Šta znači | Šta uraditi |
|---|---|---|
| **Unsupported file** | Fajl nije MP4/MOV | Izvezi video kao MP4 |
| **File is too large** | Prelaziš limit | Skrati video ili kompresuj (vidi ispod) |
| **Backend offline** | Sajt ne može da dopre do servera | Sačekaj minut (server spava) i probaj opet |
| **We could not read the audio track** | Video nema zvuka (mutiran je) | Proveri da video stvarno ima zvuk |
| **Transcription failed** | Server ili mreža | Probaj opet posle minuta |
| Ništa se ne dešava 2 min | Predugačak video | Iseci na delove po 5–10 min |

**Kako smanjiti video (bez programa):**
Na telefonu snimi manje, ili u bilo kojem editoru izvezi sa manjom rezolucijom (720p umesto 4K).

**Ako imaš ffmpeg (naprednije):**
```bash
ffmpeg -i vide.mp4 -vn -ac 1 -ar 16000 -c:a libopus -b:a 32k zvuk.ogg
```
Ovo daje mali fajl sa zvukom koji aplikacija može da obradi čak i kroz 25 MB limit.

---

## Deo 6 — Sve radi na besplatnim servisima

| Komponenta | Gde je | Koliko košta |
|---|---|---|
| Frontend (sajt) | GitHub Pages | besplatno |
| Backend (server) | Render, free plan | besplatno |
| Prepoznavanje govora | Groq `whisper-large-v3-turbo` | ~0,04 $ po satu transkripcije |

Praktično: 60 minuta govora košta oko **4 centa**.

---

## Deo 7 — Ako želiš sopstvenu kopiju (za programere)

### 7.1 Šta je potrebno
- [Node.js](https://nodejs.org) 18 ili noviji (proveri: `node -v`)
- [Git](https://git-scm.com)
- Besplatan [Groq ključ](https://console.groq.com/keys)

### 7.2 Pokretanje backend-a na svom računaru

```bash
# 1. Preuzmi projekat
git clone https://github.com/dexilio13-ui/export-titlova-za-capcut.git
cd export-titlova-za-capcut/backend

# 2. Instaliraj zavisnosti
npm install

# 3. Napravi .env fajl (na Windows-u: `copy .env.example .env`)
cp .env.example .env

# 4. Otvori .env u bilo kojem tekst editoru i upiši svoj ključ:
#    GROQ_API_KEY=gsk_tvoj_kljuc_ovde

# 5. Pokreni
npm run dev
```

Proveri da radi — u browseru otvori: <http://localhost:3000/api/health>
Trebalo bi da piše `{"ok":true, ...}`.

### 7.3 Pokretanje sajta na svom računaru

U **drugom terminalu**, iz foldera projekta:

```bash
cd frontend
# bilo koji mali server; ako imaš Python:
python -m http.server 8080
```

Otbori <http://localhost:8080>.

> **Važno:** nemoj otvarati `index.html` dvoklikom (kao fajl). Za `file://` browser blokira
> kopiranje u clipboard i CORS ne radi — uvek preko `http://`.

Ako nemaš Python, možeš u `frontend` folderu pokrenuti Node server iz projekta:
```bash
node tools/static-server.js frontend 8080
```

### 7.4 Povezivanje sajta sa svojim backendom

Otvori `frontend/js/config.js` i promeni jednu jednu liniju:

```js
API_BASE_URL: "http://localhost:3000",
```

### 7.5 Slanje izmena na GitHub

```bash
git add .
git commit -m "moja izmena"
git push
```
GitHub Pages automatski redeploy-uje sajt.

---

## Deo 8 — Bezbednost (kratko i važno)

1. **API ključ NIKAD ne ide u frontend.** On stoji samo kao env promenljiva na serveru.
   Zato ne stavljaj ključ u `config.js`, u HTML, niti u bilo koji fajl u `frontend/` folderu.
2. **`.env` je u `.gitignore`** — neće se zauvek u repozitorijum.
3. **Videoi se ne čuvaju** — fajl se briše odmah posle transkripcije.
4. **Rotiraj ključ povremeno:** <https://console.groq.com/keys> → napravi novi → stavi na
   Render (Environment) → obriši stari.
5. **CORS je zatvoren** za tuđe sajtove u produkciji (samo tvoj domen ima pristup).

---

## Deo 9 — Najčešća pitanja

**Koliko traje transkripcija?** 5–20 sekundi za video do minut, zavisno od dužine i opterećenja servera.

**Da li mogu da koristim komercijalno (sadržaj za TikTok/YouTube)?** Da. Whisper model je
MIT licenciran, a ti si vlasnik svog teksta. Proveri uslove korišćenja Groq-a za tvoj plan.

**Koliko je precizno?** Najbolje rezultate daje jasan govor, bez glazbe u pozadini i bez više
istovremenih govornika. Za srpski se koriste dijakritike č, ć, š, ž, đ i ćirilica se čuva.

**Mogu li da koristim srpski dijalekat ili makedonski?** Model prepoznaje i dijalektove;
izaberi „Serbian" u listi jezika.

**Šta je word-level timestamp?** Vremenska oznaka svake rečene reči — čuvamo je u aplikaciji
za buduće funkcije (karaoke titlovi, animovane titlove), a trenutno je koristiš samo za SRT.

**Da li se video negde snima?** Ne. Fajl ide na server, obradi se i obriše. Jedino ostaje
tehnicki log servera (veličina fajla, vreme, greške) — bez sadržaja i bez ključeva.

---

## Brze komande za kopiranje

```bash
# Backend lokalno
cd backend && npm install && npm run dev

# Sajt lokalno
node tools/static-server.js frontend 8080

# Testovi
cd backend && npm test

# Deploy: sa ide na main, Pages i Render se redeploy-uju sami
git push
```