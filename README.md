# pulso-reddit-bot

Publishing helper for [r/pulsocientifico](https://www.reddit.com/r/pulsocientifico/), the community of
[Pulso Científico](https://pulsocientifico.com.br) — a Brazilian site that explains newly published
scientific research in plain Portuguese, always linking to the original paper.

It runs outside Reddit, on our own machine, and is operated by the subreddit's sole moderator
(u/pulsocientifico). It posts **only** to r/pulsocientifico.

## What it does

When an article is live on our site and has not been shared yet, the script submits a link post to our
own subreddit and adds one comment with the article's standfirst and the link to the original study
(DOI, PubMed or the official announcement).

Two files:

| File | Purpose |
|---|---|
| `reddit-autorizar.mjs` | One-time OAuth authorization. Opens Reddit in the browser, exchanges the code for a refresh token and writes it to a local `.env`. No password is handled by the script. |
| `divulgar-reddit.mjs` | Reads our published articles, picks the next one to share, submits it and comments the summary. |

## Limits built into the code

These are enforced in `divulgar-reddit.mjs`, not by convention:

- at most **one post per run**;
- a minimum of **90 minutes between posts** (`ESPERA_MIN`);
- **never the same article twice** — every submission is recorded in a local `divulgadas.json`;
- **nothing older than 48 hours** (`IDADE_MAX_H`);
- only articles whose status is `publicada` and whose publication time has already passed — scheduled
  and draft articles are skipped;
- **one subreddit only**, read from `REDDIT_SUB` and defaulting to `pulsocientifico`.

## Reddit endpoints used

| Endpoint | Method | Why |
|---|---|---|
| `/api/v1/access_token` | POST | OAuth (authorization code, then refresh token) |
| `/r/{sub}/api/link_flair_v2` | GET | read our own subreddit's flair templates, to tag the post by subject area |
| `/api/submit` | POST | submit the link post |
| `/api/comment` | POST | add the summary and the link to the original study |

Scopes requested: `submit`, `identity`, `flair`, `read`.

User-Agent: `web:pulsocientifico:v1.0 (by /u/pulsocientifico)`.

## What it does not do

- does not read, vote, comment or post in any other subreddit;
- does not read or store user data, does not build profiles, does not train models;
- does not scrape listings, search or comments;
- does not send direct messages;
- does not resell or redistribute any Reddit data.

## Configuration

No credentials are stored in this repository. Everything is read at runtime from a local `.env`
file that is never committed:

```
REDDIT_ID=            # app id from reddit.com/prefs/apps
REDDIT_SECRET=        # app secret
REDDIT_REFRESH=       # written by reddit-autorizar.mjs
REDDIT_SUB=pulsocientifico
PULSO_SITE=https://pulsocientifico.com.br
PULSO_SUPABASE_URL=   # our own database (read-only use here)
PULSO_CHAVE_PUBLICA=  # public key, the same one our website serves to visitors
```

## Running it

```bash
node reddit-autorizar.mjs          # once, to authorize the account
node divulgar-reddit.mjs --simular # shows exactly what would be posted, posts nothing
node divulgar-reddit.mjs           # posts
```

`--simular` prints the title, the link, the flair and the comment text without contacting Reddit's
write endpoints. It is what we use to review a post before it goes out.

## Editorial policy

Our articles state what a study measured, with what sample, and what it does not allow anyone to
conclude. We do not publish promises of cure, and articles produced with AI assistance are disclosed
as such: <https://pulsocientifico.com.br/politica-editorial>.

Contact: blog.pulsocientifico@gmail.com
