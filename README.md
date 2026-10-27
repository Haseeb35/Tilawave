# Tilawave — Quran, Prayer Times & Qibla

A calm, mobile-friendly Islamic companion site: prayer times for any city, the Qibla direction, the Holy Quran with translations and recitation, a tasbih counter and an Islamic calendar.

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
- Shareable links, e.g. `?city=Karachi&country=Pakistan`

### Quran (`quran.html`)
- All 114 surahs with Arabic names, meanings, verse counts and Makki/Madani
- All 30 paras (juz) with their traditional names and exact verse ranges; read a whole para (`quran.html?juz=30`)
- **Khatam tracker** — mark paras complete, set a goal (7–60 days) with a daily target, reading streak and khatam count
- Reader with Uthmani Arabic text, Saheeh International (English) and Fateh Muhammad Jalandhry (Urdu)
- Choose English, Urdu, both or Arabic only; adjustable Arabic text size
- Recitation by Mishary Alafasy, Abdul Basit, As-Sudais, Al-Husary or Maher Al-Muaiqly — play a whole surah or from any verse, with the current verse highlighted
- Bookmarks, "Continue reading" and links to any verse (`quran.html?surah=18#ayah-10`)
- Search the whole Quran in English or Urdu

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
- Works offline: every page opens, surahs and paras you've read stay available, and prayer times are saved for this month and next
- Recitation audio needs a connection

## Data sources

- Prayer times: [Aladhan API](https://aladhan.com/prayer-times-api)
- Quran text, translations, audio and search: [AlQuran.cloud API](https://alquran.cloud/api) — verses are always loaded from the API, never typed by hand
- City search: [Open-Meteo Geocoding](https://open-meteo.com/en/docs/geocoding-api)
- Device location names: [BigDataCloud](https://www.bigdatacloud.com/free-api/free-reverse-geocode-to-city-api)
- Hadith: [hadith-api](https://github.com/fawazahmed0/hadith-api) (Sahih al-Bukhari and Sahih Muslim)
- Islamic dates are calculated in the browser with the Umm al-Qura calendar and may differ by a day from local moon sighting.

## Tech

Plain HTML, CSS and JavaScript — no build step. `common.js` holds code shared by every page.

## Run locally

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

> Location, notifications and the live compass need HTTPS (or localhost) to work.

## Deploy with GitHub Pages

1. Push this folder to a GitHub repository.
2. Go to **Settings → Pages**.
3. Under **Source**, choose **Deploy from a branch**, select `main` and `/ (root)`, then **Save**.
4. Your site will be live at `https://<your-username>.github.io/<repo-name>/`.
