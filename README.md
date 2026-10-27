# Tilawave — Quran, Prayer Times & Qibla

A calm, mobile-friendly Islamic companion site: prayer times for any city, the Qibla direction, the Holy Quran with translations, tafsir and recitation, a hadith library, Quranic duas and the 99 Names, a zakat calculator, a tasbih counter and an Islamic calendar.

## Features

### Prayer times (`index.html`)
- Today's times (Fajr, Sunrise, Dhuhr, Asr, Maghrib, Isha) for any city or your device location
- Next prayer with a live countdown, including tomorrow's Fajr after Isha
- Sky that changes with the time of day, and a sun path from Fajr to Isha
- Gregorian and Hijri dates; rolls over to the new day at midnight
- Calculation method and Asr school (Hanafi / Standard)
- **Prayer alerts** — a chime, an on-page banner and a browser notification at each prayer time (while the page is open)
- **Ramadan mode** — shows when Sehri ends and Iftar begins during Ramadan
- **Verse of the Day** — a real verse in Arabic with English and Urdu translation and recitation
- **Hadith of the Day** — from Sahih al-Bukhari or Sahih Muslim, in English, Urdu and Arabic
- **Prayer tracker** — tick each prayer, see the last 7 days, your streak of all-five days and unmarked prayers
- Qibla bearing and a live compass on phones that tells you which way to turn
- **Today notes**: a Jummah reminder for Surah Al-Kahf, sunnah fasts coming up tomorrow (Mondays, Thursdays, the White Days, Arafah, Ashura), your daily khatam reading target, unmarked prayers after Isha, and Surah Al-Mulk before sleep
- **Qada counter**: prayers to make up, with one-tap import of unmarked prayers from the tracker
- **Nearby mosques** from OpenStreetMap, with distance, walking time and directions
- Shareable links, e.g. `?city=Karachi&country=Pakistan`

### Quran (`quran.html`)
- All 114 surahs with Arabic names, meanings, verse counts and Makki/Madani
- All 30 paras (juz) with their traditional names and exact verse ranges; read a whole para (`quran.html?juz=30`)
- **Khatam tracker** — mark paras complete, set a goal (7–60 days) with a daily target, reading streak and khatam count
- Reader with Uthmani Arabic text and a choice of 9 English translations (Saheeh International, Asad, Pickthall, Yusuf Ali, Hilali & Khan, Maududi, Itani, Wahiduddin Khan, Arberry) and 6 Urdu translations (Jalandhry, Maududi, Kanz-ul-Iman, Junagarhi, Ahmed Ali, Tahir ul Qadri)
- **Transliteration** under each verse, for readers learning Arabic
- **Tafsir** on every verse in a side panel: Ibn Kathir (English, abridged), Ma'ariful Quran (English) and Tafsir Ibn Kathir (Urdu); shows when a note covers a passage of several verses
- **About this surah** — Maududi's introduction (name, period of revelation, themes) in English or Urdu
- Choose English, Urdu, both or Arabic only; adjustable Arabic text size
- Recitation by Mishary Alafasy, Abdul Basit, As-Sudais, Al-Husary or Maher Al-Muaiqly — play a whole surah or from any verse, with the current verse highlighted
- **Uthmani or Indo-Pak script** for the Arabic text
- **Repeat a verse** 3, 5 or 10 times for memorising, and a **sleep timer** for recitation
- **Keyboard shortcuts** in the reader: Space, ← →, B (bookmark), T (tafsir), S (share)
- **Share a verse as an image** for WhatsApp or Instagram
- **Hifz tracker**: mark surahs as memorised, see your progress and practise the next one
- Popular surahs (Yaseen, Al-Kahf, Al-Mulk, Ar-Rahman, Al-Waqi'ah, Ayat al-Kursi) one tap away
- Bookmarks, "Continue reading" and links to any verse (`quran.html?surah=18#ayah-10`)
- Search the whole Quran in English or Urdu, with your recent searches

### Hadith library (`hadith.html`)
- Ten collections: Sahih al-Bukhari, Sahih Muslim, Sunan Abu Dawud, Jami' at-Tirmidhi, Sunan an-Nasa'i, Sunan Ibn Majah, Muwatta Malik, and the Forty Hadith of an-Nawawi, Hadith Qudsi and Shah Waliullah
- Browse book by book, or jump straight to a hadith number
- English, Urdu or Arabic, with the Arabic original alongside if you like
- Grades from the scholars where the edition provides them
- Search within a book, copy a hadith, share it as an image, link to it (`hadith.html?c=bukhari&b=1#h-1`) or print a book

### Duas & 99 Names (`duas.html`)
- Over 40 supplications from the Quran, grouped by topic (forgiveness, guidance, hardship, family, knowledge, this life and the next), with who made them where the verse says so
- Each in Arabic with transliteration, translation and recitation; only verse references are listed in the code, every word comes from the Quran API
- The 99 Names of Allah with meanings; mark names as learned and practise them in a quiz

### Zakat (`zakat.html`)
- Gold (in grams or tola, with purity), silver, cash, bank balances, money owed to you, shares, business stock, less debts due now
- Live international gold and silver prices in 18 currencies, or enter your own
- Silver or gold nisab (612.36 g / 87.48 g), with a meter showing how close you are
- Zakat al-Fitr total for your household
- Everything stays in your browser

### Settings (`settings.html`)
- Calculation method and Asr school
- **Adjust prayer times** by minutes (Fajr to Isha) to match your local mosque; applies to the home page, alerts and the monthly timetable
- **Hijri date adjustment** (±2 days) for local moon sighting; applies everywhere Hijri dates are shown
- Quran translation, reciter, Arabic script and transliteration; theme (system, light, dark)
- **Backup and restore** all your data to a file, or reset everything

### Everywhere
- **Quick search** (search icon, Ctrl/⌘ K or /): jump to a surah, a verse (`2:255`), a para (`para 30`), a hadith (`bukhari 1000`) or any page
- **Share today's prayer times** as an image for WhatsApp, from the home page
- Link previews for WhatsApp, X and Facebook, a designed 404 page, and an offline page for pages not yet saved

### Tasbih (`tasbih.html`)
- After-prayer mode: SubhanAllah 33, Alhamdulillah 33, Allahu Akbar 34
- Free count with a choice of dhikr and target, undo, reset, and today / all-time totals
- Tap, Space or Enter to count; vibrates on phones

### Calendar (`calendar.html`)
- Ramadan countdown (or the current day of Ramadan)
- Upcoming Islamic dates: Islamic New Year, Ashura, Mawlid, Isra and Mi'raj, Shab-e-Barat, Ramadan, Laylat al-Qadr, Eid al-Fitr, Arafah, Eid al-Adha
- Printable monthly prayer timetable for your city

Plus light/dark mode on every page, remembered in the browser.

### Install as an app & offline
- Installable on Android, iPhone (Share → Add to Home Screen) and desktop Chrome/Edge, with its own icon
- Works offline: every page opens; surahs, paras, tafsir and hadith books you've read stay available; prayer times are saved for this month and next
- Recitation audio needs a connection

## Data sources

- Prayer times: [Aladhan API](https://aladhan.com/prayer-times-api)
- Quran text, translations, audio and search: [AlQuran.cloud API](https://alquran.cloud/api) — verses are always loaded from the API, never typed by hand
- City search: [Open-Meteo Geocoding](https://open-meteo.com/en/docs/geocoding-api)
- Device location names: [BigDataCloud](https://www.bigdatacloud.com/free-api/free-reverse-geocode-to-city-api)
- Tafsir, surah introductions and Indo-Pak text: [Quran.com API](https://api-docs.quran.com/)
- Nearby mosques: [OpenStreetMap](https://www.openstreetmap.org/) via Overpass, with Nominatim as a fallback
- Hadith: [hadith-api](https://github.com/fawazahmed0/hadith-api) — the book list in `data/hadith-books.json` is generated from its index
- 99 Names: [Aladhan API](https://aladhan.com/islamic-calendar-api)
- Gold and silver prices: [currency-api](https://github.com/fawazahmed0/exchange-api)
- Islamic dates are calculated in the browser with the Umm al-Qura calendar and may differ by a day from local moon sighting.

## Tech

Plain HTML, CSS and JavaScript, with no framework, no dependencies and no build step. It's a static site, so any static host can serve it. A service worker makes it installable and usable offline.

### Project structure

```
├── index.html, app.js          Home: prayer times, sky, tracker, qada, Qibla, mosques
├── quran.html, quran.js        Quran index and reader
├── hadith.html, hadith.js      Hadith library
├── duas.html, duas.js          Quranic duas and the 99 Names
├── zakat.html, zakat.js        Zakat calculator
├── calendar.html, calendar.js  Islamic dates and monthly timetable
├── tasbih.html, tasbih.js      Dhikr counter
├── settings.html, settings.js  Preferences, adjustments, backup
├── 404.html, offline.html      Status pages
├── common.js                   Shared by every page (storage, APIs, theme, quick search, motion)
├── style.css                   All styles, light and dark themes
├── sw.js                       Service worker (offline caching)
├── manifest.webmanifest        Install-as-app metadata
├── data/hadith-books.json      Book index for the hadith collections
├── icons/                      Logo, app icons, link-preview image
└── tests/                      End-to-end tests (headless Chrome)
```

## Privacy

There are no accounts and no analytics. Everything you track (prayers, qada, khatam, hifz, bookmarks, settings) is stored only in your browser, and you can export it from Settings. The site calls the public APIs listed above and loads its fonts from Google Fonts. Your location leaves the device only when you choose "Use my location" or "Find mosques": coordinates go to Aladhan and BigDataCloud for prayer times and the place name, or to OpenStreetMap for mosques.

## Run locally

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

> Location, notifications and the live compass need HTTPS (or localhost) to work.

## Tests

With the local server running, `tests/run-all.sh` runs every end-to-end suite in headless Chrome (needs Google Chrome and Node 22+). The suites drive Chrome directly over the DevTools protocol, with no npm packages. They expect the server at `http://localhost:8000` and Chrome at its standard macOS location; change `BASE` and the Chrome path at the top of a suite to run it elsewhere. Some suites call the live APIs, so they need an internet connection.

## Deploy with GitHub Pages

GitHub Pages is free for public repositories; on a private repository it needs a paid GitHub plan. Any other static host (Netlify, Cloudflare Pages, Vercel) works too.

1. Push this folder to a GitHub repository.
2. Go to **Settings → Pages**.
3. Under **Source**, choose **Deploy from a branch**, select `main` and `/ (root)`, then **Save**.
4. Your site will be live at `https://<your-username>.github.io/<repo-name>/`.
5. For link previews, change `og:image` in each page's `<head>` to the full address, e.g. `https://<your-username>.github.io/<repo-name>/icons/og-image.png` (WhatsApp and Facebook need a full URL).

## Known limitations

- Prayer times, Quran text, tafsir, hadith and prices come from free public APIs. If one is down or rate-limited, that part of the site shows an error until it recovers; pages and data you've already opened keep working offline.
- Hijri dates use the Umm al-Qura calendar and can differ from local moon sighting; adjust them in Settings.
- Prayer alerts work only while a Tilawave tab is open; there are no push notifications.
- Recitation audio needs a connection.
- Nearby mosques are only as complete as OpenStreetMap's data for your area.
- Zakat uses international spot prices for gold and silver; local prices can differ, so the calculator lets you enter your own.

## Contributing

Issues and suggestions are welcome. For code changes, keep to plain HTML, CSS and JavaScript, check light and dark mode on desktop and phone widths, and run `tests/run-all.sh` before opening a pull request. Islamic text (Quran, hadith, tafsir) must come from the data sources above, never typed by hand.

## License

[MIT](LICENSE) © 2026 Abdul Haseeb Dar
