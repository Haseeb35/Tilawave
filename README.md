# 🕌 Prayer Times & Qibla

A simple, mobile-friendly website that shows today's prayer times for any city and the Qibla direction.

## Features

- Today's prayer times (Fajr, Sunrise, Dhuhr, Asr, Maghrib, Isha)
- Next prayer highlighted with a live countdown
- Gregorian and Hijri dates
- Search by city or use your device location
- Calculation method and Asr school (Hanafi / Shafi'i) settings
- Qibla direction in degrees, plus a live compass on phones
- Remembers your last location
- Automatic dark mode

## Tech

Plain HTML, CSS and JavaScript — no build step. Prayer times come from the free [Aladhan API](https://aladhan.com/prayer-times-api), and city names are turned into coordinates with [Open-Meteo Geocoding](https://open-meteo.com/en/docs/geocoding-api). The Qibla bearing is calculated in the browser.

## Run locally

Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

> Location and the live compass need HTTPS (or localhost) to work.

## Deploy with GitHub Pages

1. Push this folder to a GitHub repository.
2. Go to **Settings → Pages**.
3. Under **Source**, choose **Deploy from a branch**, select `main` and `/ (root)`, then **Save**.
4. Your site will be live at `https://<your-username>.github.io/<repo-name>/`.
