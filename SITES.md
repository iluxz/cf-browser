# what works in cf-browser

tested against the live proxy (2026-11-10). the rule that predicts all of it:

> a site works if the html it sends already contains the content.
> it dies if it is a javascript app, behind cloudflare/akamai bot protection,
> behind a login, or uses a captcha (captchas check the page's domain against
> the key's registered domain, and a proxy's domain is always wrong).

## works properly

| site | notes |
|---|---|
| en.wikipedia.org | full articles |
| github.com | repos, code, profiles |
| developer.mozilla.org | full docs |
| docs.python.org | full docs |
| theguardian.com | full articles |
| npr.org | full articles |
| arstechnica.com | full articles |
| hackaday.com | full articles |
| lobste.rs | fully renders |
| itch.io | store pages |
| gutenberg.org | full books |
| craigslist.org | listings |
| search.marginalia.nu | works |
| bing.com search | results render |
| duckduckgo.com | works |
| neal.fun | works |
| spacejam.com/1996 | the whole 1996 site |
| cloudflare.com | everything |

## dead on arrival (bot wall, not fixable)

| site | what you get |
|---|---|
| reddit.com | "you've been blocked by network security" |
| old.reddit.com | same block |
| stackoverflow.com | cloudflare "just a moment..." challenge |
| apnews.com | "just a moment..." |
| bbc.com/news | "access denied" |
| amazon.com | blank, needs js |
| ebay.com | "SORRY something went wrong" |
| news.ycombinator.com | literally returns "Sorry" |
| mcmansionhell.com | "checking your browser..." |
| scratch.mit.edu | js-only |

## half dead (shell loads, content does not)

| site | what you get |
|---|---|
| twitter.com / x.com | login wall only |
| roblox.com | footer + nav only |
| youtube.com | blank (crashes on its own history api) |
| reuters.com | blank |

## why each one fails

1. **javascript app** - the html is an empty div, content is built client-side (roblox, youtube, amazon)
2. **bot protection** - worker IPs are datacenter IPs, challenged or denied instantly (reddit, stackoverflow, bbc, HN)
3. **login required** - (twitter, reddit comments, most social)
4. **captcha** - domain check, impossible through a proxy

cf-browser is a reading machine, not a logging-in machine. when a page dies the
bottom bar explains which of the four it was and offers "open without proxy".

## possible next steps

- [ ] "known good sites" shelf on the new tab page
- [ ] per-site "always open direct" memo in settings
