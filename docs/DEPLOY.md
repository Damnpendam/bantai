# Deploying Bantai

Bantai is one long-running Node process with a SQLite database on disk. Any host that
runs a container and gives it a persistent volume works. This guide uses Railway; notes
for other hosts follow.

## Railway

You need the code in a GitHub repository (private is fine) and a Railway account.

1. **Create the service.** Railway → **New Project** → **Deploy from GitHub repo** → pick
   the repo. Railway reads `railway.json` and builds the `Dockerfile`.

2. **Attach a volume at `/data`.** On the service, add a volume with mount path `/data`.
   Without it, every deploy starts from an empty database — the server log warns you
   (`not a mounted volume`) if this is missing. The image's entrypoint fixes the volume's
   ownership on every start, so nothing else is needed for the app to be able to write to
   it — no `RAILWAY_RUN_UID` or similar required.

3. **Set variables** on the service:

   | Variable | Value |
   |---|---|
   | `APP_SECRET` | Output of `openssl rand -base64 48`. **Keep a copy somewhere safe** — it encrypts every stored API key, and losing or changing it makes them unreadable. |
   | `SUPERADMIN_EMAIL` | Your email address. |

   Optional:

   | Variable | What it does |
   |---|---|
   | `RESEND_API_KEY`, `EMAIL_FROM` | Email invites and password resets. Resend requires verifying your sending domain. Without these, you copy invite links from `/admin` and send them yourself. |
   | `PLATFORM_API_KEY` (+ `PLATFORM_PROVIDER`, `PLATFORM_MODEL`, `PLATFORM_DAILY_RUNS`, …) | Lets testers without their own API key try the app on yours, with a daily cap per workspace. See `.env.example`. |
   | `APP_URL` | Only if you want links to use a different domain than Railway's; otherwise it's derived automatically. |

4. **Give it a domain.** Service → **Settings** → **Networking** → **Generate Domain** (or
   add your own).

5. **Deploy, then open the deploy logs.** Look for:

   ```
   [bootstrap] Super admin setup link for you@example.com:
     https://<your-domain>/signup#token=…
   ```

   Open it and set your password — you're the super admin. (With email configured, the
   link is also emailed.) A fresh link is issued on every start until the account exists.

6. **Invite your testers** from `/admin`.

### Good to know

- **One instance.** Railway volumes can't be shared by replicas, and the app is
  single-process by design (run orchestration and rate limits live in memory). Scale up,
  not out.
- **Redeploys cause a few seconds of downtime** — Railway won't mount one volume on two
  deployments at once. A run caught mid-stage is marked *interrupted* and can be retried
  from the stage it stopped at; nothing already written is lost.
- **Health check.** `/api/health` must return `200` before a deploy goes live. It fails if
  the database can't be opened or `APP_SECRET` is missing, so a misconfigured deploy never
  replaces a working one.
- **Backups.** Turn on Railway's volume backups for the service. The whole application
  state is the one SQLite file on `/data`.

## Other hosts

The same image runs anywhere: build the `Dockerfile`, mount a persistent volume at
`/data`, set `APP_SECRET`, `SUPERADMIN_EMAIL` and `APP_URL`, and run exactly one
instance. The entrypoint claims `/data` for the app's unprivileged user on every start,
whatever host it is and whatever owns the volume beforehand — nothing extra to configure.

- **Docker on a VPS**

  ```bash
  docker build -t bantai .
  docker run -d --name bantai --restart unless-stopped -p 3000:3000 \
    -v bantai-data:/data \
    -e APP_SECRET="$(openssl rand -base64 48)" \
    -e SUPERADMIN_EMAIL=you@example.com \
    -e APP_URL=https://bantai.example.com \
    bantai
  ```

  Put a TLS reverse proxy (Caddy, nginx) in front; for nginx, leave response buffering off
  so run progress streams live (the app already sends `X-Accel-Buffering: no`). Save the
  `APP_SECRET` you generated — it's needed on every restart.

- **Fly.io** — `fly launch` picks up the Dockerfile. Create a volume and mount it at
  `/data` in `fly.toml`, and keep a single machine.

## After the first deploy

- `https://<your-domain>/api/health` returns `{"ok":true}`.
- The logs show no `[bootstrap]` warnings about storage or `APP_SECRET`.
- Sign in, invite a test account, and check from a second browser that neither of you can
  see the other's projects.
