# Signal — Personal Instagram DM Dashboard

Read your Instagram DMs (including shared posts/reels) on your own website,
without opening Instagram and without triggering "seen" — and reply from
the dashboard when you want to.

This works by using **Meta's official Instagram Messaging API**. When
someone DMs your Instagram account, Meta sends your server a "webhook"
(a notification with the message content). Because nothing ever opens the
conversation inside the Instagram app/website, the message is never marked
as seen on Instagram's side. Replies you send from the dashboard go out
through the same official API.

---

## How it all fits together

```
Instagram DM ──► Meta servers ──► your webhook (server.js) ──► ig_dashboard.json
                                                │
                                                ▼
                                     Your dashboard (browser)
```

- **server.js** — receives webhook events, stores them, serves the dashboard,
  and sends replies via the Graph API
- **ig_dashboard.json** — a simple file that stores all your conversations and
  messages (created automatically, no database server needed)
- **public/** — the dashboard web page (HTML/CSS/JS), updates live via WebSocket

---

## Part 1 — Instagram & Meta setup (one-time)

This is the part that takes the most patience the first time, but you only
do it once.

### 1.1 Convert Instagram to a Professional account

1. Open the Instagram app → your profile → **Edit profile**
2. Find **Switch to professional account** (or **Account type and tools**)
3. Choose **Creator** or **Business** — either works for messaging
4. You do **not** need to connect a Facebook Page during this step if it
   doesn't ask — we'll handle that in the next step via the developer portal

This is free, reversible, and doesn't change your handle, followers, or posts.

### 1.2 Create a Meta Developer App

1. Go to [developers.facebook.com](https://developers.facebook.com) and log in
   with the Facebook account linked to your Instagram (or create one)
2. **My Apps → Create App**
3. Choose app type **"Other"** → **"Business"**
4. Give it any name (e.g. "My IG Inbox")

### 1.3 Add the Instagram product

1. In your new app's dashboard, find **Instagram** in the left sidebar →
   **Add** (sometimes listed as "Instagram Graph API" or "Messaging")
2. Follow the prompts to connect your Instagram Professional account.
   This step links a Facebook Page to your Instagram account automatically
   if one isn't already linked.

### 1.4 Get your App Secret

1. **App settings → Basic**
2. Copy the **App Secret** (click "Show") → save it, you'll need it as
   `APP_SECRET`

### 1.5 Generate a Page Access Token

1. Go to **Tools → Graph API Explorer** (or under your app's Instagram setup,
   there's often a "Generate Token" button)
2. Select your app, select your Page, and request these permissions:
   `instagram_basic`, `instagram_manage_messages`, `pages_messaging`
3. Generate the token. This short-lived token needs to be exchanged for a
   **long-lived token** (lasts ~60 days, renewable):

   ```
   GET https://graph.facebook.com/v19.0/oauth/access_token
       ?grant_type=fb_exchange_token
       &client_id=YOUR_APP_ID
       &client_secret=YOUR_APP_SECRET
       &fb_exchange_token=SHORT_LIVED_TOKEN
   ```

   You can run this in a browser address bar or with `curl`. The response
   gives you a long-lived token — save it as `PAGE_ACCESS_TOKEN`.

> 💡 Tip: every ~60 days you'll need to refresh this token. There are
> guides on Meta's docs for automating refresh, but for personal use it's
> fine to do it manually every couple of months.

---

## Part 2 — Deploy the server

You need the server reachable on the public internet with **HTTPS**, because
Meta will only send webhooks to HTTPS URLs. The easiest free option for
beginners is **Render**.

### 2.1 Put the code on GitHub

1. Create a new repository on [github.com](https://github.com)
2. Upload this whole project folder to it (or use `git push` if you're
   comfortable with git)
3. Make sure `.env` is **not** uploaded (it's in `.gitignore` already —
   only `.env.example` should be in the repo)

### 2.2 Deploy on Render

1. Go to [render.com](https://render.com) → sign up (free) → **New → Web Service**
2. Connect your GitHub repo
3. Settings:
   - **Build command**: `npm install`
   - **Start command**: `npm start`
4. Add environment variables (Render → your service → **Environment**):

   | Key | Value |
   |---|---|
   | `VERIFY_TOKEN` | any random string you make up |
   | `APP_SECRET` | from step 1.4 |
   | `PAGE_ACCESS_TOKEN` | from step 1.5 |
   | `DASHBOARD_USER` | a username for your dashboard login |
   | `DASHBOARD_PASS` | a strong password for your dashboard login |

5. Deploy. Render gives you a URL like `https://your-app.onrender.com`

> ⚠️ Free Render services "sleep" after inactivity and take ~30 seconds to
> wake up on the next request. For a personal project this is usually fine —
> Meta retries webhooks, and your dashboard will just take a moment to load
> after idle periods. If that's annoying, Render's cheapest paid tier
> (~$7/month) keeps it always-on.

---

## Part 3 — Connect the webhook

1. Back in your Meta App dashboard → **Instagram → Configuration** (or
   **Webhooks** depending on the UI version)
2. **Callback URL**: `https://your-app.onrender.com/webhook`
3. **Verify token**: the same `VERIFY_TOKEN` value you set in Render
4. Click **Verify and Save** — your server will respond automatically
   (that's what the `GET /webhook` route in `server.js` does)
5. Subscribe to the **`messages`** field

---

## Part 4 — Use it

1. Open `https://your-app.onrender.com/` in your browser
2. Log in with the `DASHBOARD_USER` / `DASHBOARD_PASS` you set
3. Send yourself a test DM on Instagram from another account — it should
   appear on the dashboard within a few seconds, in real time
4. Click a conversation, type a reply, hit **Send** — it goes out through
   Instagram as a normal DM from your account

---

## Things to know

- **24-hour messaging window**: Instagram only lets you send regular replies
  within 24 hours of the user's last message. Outside that window, the
  Graph API will reject the send (this is a platform-wide policy, not
  something this code can bypass).
- **"Seen" status**: receiving and reading messages on the dashboard never
  marks them as seen on Instagram. *Replying* is visible to the other
  person as a normal message, same as replying in the app.
- **Data storage**: everything is stored in `ig_dashboard.json` on the
  server. On Render's free tier, the filesystem is **not persistent** across
  deploys/restarts — if you want message history to survive restarts long-term,
  let me know and I can swap this for a small hosted database (e.g. a free
  Postgres instance), which is a quick change.
- **Security**: the dashboard is protected with a username/password
  (HTTP Basic Auth) and the webhook verifies Meta's signature on every
  request. Keep your `.env` values secret — never commit them to GitHub.
- **Local testing before deploying**: you can run `npm install && npm start`
  locally and use a tool like [ngrok](https://ngrok.com) to get a temporary
  public HTTPS URL for testing the webhook before deploying to Render.

---

## Running locally

```bash
npm install
cp .env.example .env
# edit .env with your real values
npm start
```

Then visit `http://localhost:3000`.
