# 🕌 Prayer Times & Qibla

A simple, mobile-friendly website that shows today's prayer times for any city and the Qibla direction.

## Features

- Today's prayer times (Fajr, Sunrise, Dhuhr, Asr, Maghrib, Isha)
- Next prayer highlighted with a live countdown, including tomorrow's Fajr after Isha
- Gregorian and Hijri dates; rolls over to the new day at midnight
- Search by city, or use your device location (shown as a city name)
- Times are always for the selected city's own timezone
- Calculation method and Asr school (Hanafi / Standard) settings
- Qibla bearing, plus a live compass on phones that tells you which way to turn
- Remembers your last location and settings
- Shareable links, e.g. `?city=Karachi&country=Pakistan`
- Clear error messages for unknown cities, denied location and lost connection
- Automatic dark mode

## Tech

Plain HTML, CSS and JavaScript — no build step. Prayer times come from the free [Aladhan API](https://aladhan.com/prayer-times-api), city names are turned into coordinates with [Open-Meteo Geocoding](https://open-meteo.com/en/docs/geocoding-api), and device locations are named with [BigDataCloud](https://www.bigdatacloud.com/free-api/free-reverse-geocode-to-city-api). The Qibla bearing is calculated in the browser.

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
