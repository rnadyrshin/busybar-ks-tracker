# KS Tracker

A Kickstarter campaign's funding, live on the BUSY Bar.

On start the bar shows the project's name in pages that fit the screen, no scrolling: the name itself large, then its tagline (`Flipper One`, then `Open Linux Multi-tool`). The pages slide up into each other, and the last one gives way to the amount counting up from zero while a thin line under it fills towards the goal.

Then the bar shows the amount pledged so far with every digit, so each new pledge is visible: `$16,115,602`, green once the goal is reached. When it changes, the changed digits roll in like an odometer; when the number grows a digit, it counts across instead.

The bottom line shows, on the left, what the last minute brought, `+$1,240 in 1m`: a sliding minute, recounted every second, whatever the update period. In the first minute after start the app has seen less than a minute, so the rise reads low until then. With *Show backers* or *Show percent funded* on, the slot takes turns every four seconds with `29,647 backers` and `326% funded`. On the right, a little dimmer, the time left (`25d`, `47h`, `12m`) or, once the campaign is over, its outcome: `funded`, `failed`, `canceled`. The grey caption after a number goes when it does not fit. Words with tails (g, p, y) are avoided there: the line sits on the screen's last row.

## Controls

| Control | Action |
| --- | --- |
| Start | Skips the intro; later, checks the project right away. |
| Back | Quits the app. |

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| Project | Flipper One | A link to the project, e.g. `https://www.kickstarter.com/projects/flipper-devices/flipper-one`. A query or a sub-page (`/description`, `/posts`) is fine; so is just `creator/slug`. Short `kck.st` links are not. |
| Currency | USD | What the amounts are shown in, for any project. *Project currency* shows them as Kickstarter reports them. |
| Show backers | Off | Take turns with the last minute's rise: `29,647 backers`. |
| Show percent funded | Off | Take turns with the last minute's rise: `326% funded`. |
| Update period, s | `10` | How often to check the project, 5 to 3600. Kickstarter serves these numbers from a cache that refreshes every 5 seconds, so a shorter period would show nothing new. A busy campaign changes a few times a minute. |

## Amounts and currencies

Kickstarter reports every amount in the project's own currency, the one its creator chose (USD, EUR, GBP, CAD, …). To show it in the currency from the settings the app takes the daily rate from [open.er-api.com](https://www.exchangerate-api.com) and reads it again every six hours. Until the rate arrives, or while it can't be read, amounts stay in the project's currency.

The fonts have `$`, `€`, `£`, `¥` and `₽`; other currencies show their code after the number, `60,212 CHF`. `¥` is the yen only: the yuan shows as `CNY`.

Every digit stays on screen while the amount fits in a smaller font: `$16,115,602` in bold, `$999,999,999` in the regular font, then the condensed and the small one, up to `$99,000,000,000,000`. Only past that does it shorten, to `$5e16` at the extreme. Amounts and percentages are truncated, never rounded up, so a goal never looks reached before it is: `$59,999.99` of `$60,000` is `99%`.

## When something goes wrong

| On screen | Meaning |
| --- | --- |
| `Loading...` | Waiting for the first answer. |
| `Check the project link in settings` | The Project setting doesn't look like a project link. |
| `Project not found` | Kickstarter has no project at that address. |
| `No connection, retrying` / `Kickstarter refused, retrying` | No answer, or Kickstarter's bot protection turned the request down. The app keeps trying, quickly at first, then once per period. |
| A red dot in the top-right corner | The last check failed; the numbers are from the one before. |

## Where the numbers come from

Kickstarter has no public API. Two of its pages answer without a browser check:

- `/projects/<creator>/<slug>/stats.json`: the amount pledged, the backers and the state. Small, polled every period; it comes from Cloudflare's cache with a 5-second lifetime.
- `/projects/<creator>/<slug>/widget/card.html`, the embeddable project card: its HTML carries the goal, the currency and the deadline. Read once on start.

The card weighs 40 to 80 KB, and a response that size in one piece restarts the BUSY Bar. So the app reads it as a stream and drops the connection as soon as the fields it needs have arrived, within the first 8 KB. For the same reason it talks to the bar's display through plain `fetch` rather than the busy-lib client, whose code alone would take a good part of the JS heap.

Each animation frame is one request to the bar's display API, and working out a whole frame takes the bar's JS engine around 100 ms. So an animation is planned once when it starts, and its frames send only what moves, a couple of elements put together as ready JSON: 50–70 ms a frame.

## Development

```sh
npm install
npm run typecheck
node dev/check-format.ts   # amount, percent and link formatting checks
npm run build              # dist/io.github.rnadyrshin.kickstarter.tgz
npm run app:install        # install it on the BUSY Bar connected over USB
```

`dev/deploy.sh` installs and launches the built package with `curl` only. `dev/screen.py` prints the bar's front screen as text and saves a PNG. `dev/tools/make_icons.py` draws the two icons, with nothing but Python 3.

## License

MIT
