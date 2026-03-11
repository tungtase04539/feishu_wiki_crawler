# Feishu Wiki Crawler

A full-stack web application to crawl and export all pages from Feishu (飞书) and Lark wiki spaces.

## Features

- **Crawl entire wiki spaces** — fetches all pages recursively via Feishu Open Platform API
- **Crawl subtree** — crawl only children of a specific node in the URL
- **Persistent queue** — zero node loss: queue is stored in DB, resume if token expires mid-crawl
- **Real-time progress** — SSE streaming shows live node count and pending queue
- **Resume support** — if token expires, get a new token and click Resume to continue
- **Tree view** — hierarchical view of wiki structure (virtualized for large wikis)
- **Table view** — sortable, searchable table with virtual scroll (handles 11,000+ nodes)
- **CSV export** — export all nodes with title, URL, type, depth, timestamps
- **Markdown ZIP export** — export all docx pages as Markdown files in a ZIP archive
- **Feishu & Lark support** — auto-detects platform from URL (feishu.cn or larksuite.com)

## Authentication

Two authentication modes are supported:

| Mode | Description |
|------|-------------|
| **App Credentials** | App ID + App Secret (recommended, no expiry) |
| **User Access Token** | Personal token from API Explorer (expires in 2 hours) |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript, TailwindCSS v4, shadcn/ui |
| Backend | Express.js, tRPC, tsx |
| Database | MySQL / TiDB (via Drizzle ORM) |
| Build | Vite 7, pnpm |

## Getting Started

### Prerequisites

- Node.js 22+
- pnpm
- MySQL or TiDB database (optional — crawl works without DB, but no persistence)

### Installation

```bash
git clone https://github.com/tungtase04539/feishu_wiki_crawler
cd feishu_wiki_crawler
pnpm install
```

### Configuration

Create a `.env` file:

```env
NODE_ENV=development
PORT=3000
JWT_SECRET=your_secret_key

# Optional: MySQL/TiDB for persistent crawl queue
DATABASE_URL=mysql://user:password@host:port/database
```

### Running

```bash
pnpm dev
```

Open http://localhost:3000 in your browser.

### Running Tests

```bash
pnpm test
```

## Usage

1. Enter a Feishu Wiki URL (e.g., `https://company.feishu.cn/wiki/TOKEN`)
2. Enter your App credentials or User Access Token
3. Choose crawl scope: **Entire Space** or **This Node Only**
4. Click **Crawl**
5. Monitor real-time progress
6. Export results as **CSV** or **Markdown ZIP**

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/wiki/crawl-stream` | GET | Start crawl via SSE (legacy) |
| `/api/wiki/crawl/start` | POST | Start background crawl |
| `/api/wiki/crawl/status` | GET | Poll crawl progress |
| `/api/wiki/crawl/nodes` | GET | Get all nodes for a session |
| `/api/wiki/crawl-resume` | GET | Resume paused session via SSE |
| `/api/wiki/export/start` | POST | Start Markdown ZIP export |
| `/api/wiki/export/status` | GET | Poll export progress |
| `/api/wiki/export/download` | GET | Download ZIP file |
| `/api/trpc/wiki.crawl` | POST | tRPC crawl (simple mode, no DB) |
| `/api/trpc/wiki.testAuth` | POST | Test App credentials |

## License

MIT
