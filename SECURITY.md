# Security

## How Tilawave handles data

Tilawave is a static website with no server, database, accounts or analytics.

- **Data stays on the device.** Everything a person records (prayer tracker, qada, khatam, hifz, bookmarks, settings) is kept in their browser's `localStorage`. They can export it, or delete it, from Settings.
- **No secrets.** Every service the site uses is a free public API that needs no key, so there are no keys or credentials to steal.
- **Untrusted text is escaped.** Commentary that arrives as HTML (tafsir, surah introductions) passes through an allow-list sanitizer (`sanitizeHtml` in `common.js`). All other text from APIs is escaped before display.
- **Location is shared only on request.** It is used only when the person taps "Use my location" or "Find mosques". The [README's Privacy section](README.md#privacy) lists where it is sent.

## Reporting a vulnerability

Please don't open a public issue for a security problem. Report it privately through the repository's **Security → Report a vulnerability** page on GitHub. If that page isn't available, contact the maintainer through their GitHub profile.

Include:
- the affected page;
- the steps to reproduce the problem;
- what an attacker could achieve.

You'll get a reply as soon as possible. Fixes are released by updating the site.
