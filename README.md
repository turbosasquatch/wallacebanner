# Claire & George

A lightweight wedding and engagement party site hosted on GitHub Pages.

- `index.html`: event chooser
- `wedding.html`: wedding details
- `engagement.html`: engagement-party details and RSVP email
- `accommodation.html`: recommended places to stay and local transport

## Photo gallery architecture

The public gallery uses `https://media.streamvaults.co.uk`, backed by one Cloudflare Worker. The R2 bucket remains private: the Worker serves originals on demand, creates fixed 480/800/1200-pixel WebP previews through the Images Free binding, and reads an indexed D1 manifest rather than listing R2 for every page.

Cost controls intentionally fail closed:

- 8,000,000,000 bytes maximum committed plus reserved R2 storage
- 1,500 image originals, keeping three variants below 5,000 unique transformations
- 100 source uploads and 200 R2 writes per UTC day
- 20 uploads per IP per hour
- 20 MiB per image, 25 MiB per video and 1 MiB per video poster
- fixed media paths with query strings rejected

Cloudflare Stream, Media Transformations, hosted Images storage and public R2 domains are not used. Keep Workers, Images, D1 and SQLite Durable Objects on their Free plans.

Worker validation and deployment:

```sh
cd photo-upload-worker
npm test
npm run check
npx wrangler d1 migrations apply DB --remote
npx wrangler deploy
```
