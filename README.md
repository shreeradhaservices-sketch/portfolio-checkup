# Portfolio Checkup — SR Wealth

This is built and tested. It works. Here's what it needs to go live.

## What this needs to run (important)

This tool is **not** a WordPress plugin — it's a small standalone program.
It needs three system tools already installed on the server: `qpdf`,
`pdftotext`, and Node.js. Most **ordinary WordPress shared hosting cannot
run this directly**, because shared hosting usually only runs PHP.

So before anything else, check ONE thing with your hosting provider
(the company you pay for srwealth.co.in hosting):

> "Does my hosting plan support Node.js applications? Look for
> 'Setup Node.js App' in cPanel."

This feature is now common on many Indian hosting providers (Hostinger,
GoDaddy, Bluehost, MilesWeb all offer it on many plans). If you have it,
you don't need to buy anything new.

**If your host says no** — the simplest fallback is a small separate
server (a "VPS"), which costs roughly ₹400–700/month (e.g. DigitalOcean,
Hostinger VPS, AWS Lightsail). Tell me which situation you're in and
I'll give you the exact next steps for that path.

## What's in this folder

- `server.js` — the program that receives the upload, decrypts it, reads it
- `parser.js` — the logic that reads scheme names and categorizes them
- `category-map.json` — the list AMFI-style categories are matched against
- `public/index.html` — the actual page the client sees and uses
- `node_modules/` — all required libraries, already included so you don't
  need to run any install commands

## If your host DOES support Node.js apps (cPanel path)

1. In cPanel, find **"Setup Node.js App"** and click **Create Application**
2. Set:
   - Node.js version: 18 or higher
   - Application root: a new folder, e.g. `portfolio-xray`
   - Application URL: `srwealth.co.in/portfolio-checkup` (or a subdomain)
   - Application startup file: `server.js`
3. Upload the entire contents of this folder into that application root
   folder, using File Manager or FTP (same FTP login you already use)
4. Also confirm with your host that `qpdf` and `pdftotext` (part of a
   package called `poppler-utils`) are available on the server — most
   cPanel Node hosting includes these, but ask if unsure
5. Click **Restart** on the Node.js app in cPanel
6. Visit the Application URL — you should see the upload page

## Once it's live

Link to it from the main site menu and from the homepage, the same way
`/calculator` is linked today. It can sit as its own page or be embedded
in a WordPress page using an iframe pointing to the app's URL.

## What to tell me next

Reply with what your hosting provider says about Node.js support, and
I'll give you the exact next step for your specific situation — whether
that's finishing the cPanel setup or setting up the small VPS fallback.
