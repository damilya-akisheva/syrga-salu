# domik-invite

Static invitation site (`site/`) with RSVP and wish forms backed by a Google Sheet through an
Apps Script Web App (`apps-script/Code.gs`).

```
site/                       static HTML/CSS (+ a little inline JS for the countdown and forms)
apps-script/Code.gs         Apps Script Web App: the "database" REST endpoint (deployed manually)
scripts/build-site.sh       copies site/ → dist/site/ and injects APPS_SCRIPT_URL
.github/workflows/          deploy-site.yml: build + deploy to GitHub Pages
.env.example                template for local secrets (.env is gitignored)
```

## Configuration

Secrets are kept out of the repo. Copy the template and fill it in:

```sh
cp .env.example .env
```

| Variable          | Used by                     | Where it lives in production                              |
|-------------------|-----------------------------|-----------------------------------------------------------|
| `APPS_SCRIPT_URL` | site (`scripts/build-site.sh`) | GitHub repo secret `APPS_SCRIPT_URL`                      |
| `SPREADSHEET_ID`  | `apps-script/Code.gs`       | Apps Script → Project Settings → Script Properties        |
| `API_KEY` (optional) | `apps-script/Code.gs`    | Script Properties; if set, POSTs must include `"apiKey"`  |

## Site

Build locally (reads `APPS_SCRIPT_URL` from the environment, else from `.env`):

```sh
./scripts/build-site.sh   # → dist/site/
```

Deploy: pushing to `main` with changes in `site/` runs `.github/workflows/deploy-site.yml`, which builds
with the `APPS_SCRIPT_URL` secret and publishes `dist/site/` to GitHub Pages
(Settings → Pages → Source: **GitHub Actions**). It can also be started manually from the Actions tab.

## Apps Script (manual deploy)

1. Open the target spreadsheet → Extensions → Apps Script, paste `apps-script/Code.gs`.
2. Project Settings → Script Properties: add `SPREADSHEET_ID` (and optionally `API_KEY`).
3. First time: Deploy → New deployment → Web app → Execute as: **Me**, Who has access: **Anyone**.
   Put the resulting `/exec` URL into `.env` and the `APPS_SCRIPT_URL` GitHub secret.
4. After changes: Deploy → Manage deployments → Edit → Version: **New version** (keeps the same URL).

### API

| Method | Query                  | Body                                   | Result                       |
|--------|------------------------|----------------------------------------|------------------------------|
| POST   | `?action=participants` | `{"participation_options", "name"}`    | row appended to `participants` |
| POST   | `?action=wishes`       | `{"name", "wish"}`                     | row appended to `wishes`     |
| GET    | `?action=wishes`       | —                                      | up to 10 random wishes       |
| GET    | (none)                 | —                                      | health check                 |

The real HTTP status is always 200; the result is in the JSON body as `success` / `code` / `message`.

curl examples (load `.env` first):

```sh
set -a; . ./.env; set +a

# 1. Participant RSVP
curl -L -H 'Content-Type: text/plain;charset=utf-8' -d '{"participation_options":"Да, приду","name":"Айгерим"}' "$APPS_SCRIPT_URL?action=participants"

# 2. Wish
curl -L -H 'Content-Type: text/plain;charset=utf-8' -d '{"name":"Айгерим","wish":"Желаю счастья, любви и уюта вашему новому дому!"}' "$APPS_SCRIPT_URL?action=wishes"

# 3. 10 random wishes
curl -L "$APPS_SCRIPT_URL?action=wishes"
```
