# Mariam El Nabeya Duck Shop 🦆

A gift shop for collecting Ducks (Duck Points) and swapping them for real gifts.
Girls pick gifts and send the request on WhatsApp.

- **Shop:** https://mariamelnabeya.github.io
- **Admin (owner only):** https://mariamelnabeya.github.io/admin.html

## Everyday use (no code needed)
Open the admin page and sign in. There you can:
- **＋ Add a gift**: choose a photo, type name, description, category, price in Ducks and how many, then **Publish**.
  The photo is edited automatically (background removed, soft duck-yellow backdrop). Untick "Make the photo pretty" to use the photo as it is.
- **− / +** and **Sold out** to change stock after a request is confirmed on WhatsApp.
- **Edit**, **Delete**, or hide a gift for now.
- **✨ Re-edit photos** to redo photos (one by one, or "Do them all for me").
- **Download backup** now and then, and keep it with your original photos.

## How it works
- The website files live on GitHub Pages (free).
- Gifts and photos live in Supabase (free plan). `js/config.js` has the project address and the **publishable** key, which is public by design.
  The database is locked with row-level security: everyone can read gifts, only the admin account can change them. New sign-ups are turned off.
- `supabase-setup.sql` is the database setup (already run once).
- `.github/workflows/keepalive.yml` reads the gift list every 3 days so the free Supabase project doesn't pause.
  If GitHub emails that the workflow was disabled after 60 days without changes, open the repository > **Actions** and turn it back on.
- If Supabase can't be reached, the shop shows the starter list in `gifts.json`.

## Never put in this folder
Passwords, or any key starting with `sb_secret_`. Only the publishable key (`sb_publishable_...`) belongs in `js/config.js`.

## Change the WhatsApp number
Edit `whatsappNumber` in `js/config.js` (country code + number, digits only).
