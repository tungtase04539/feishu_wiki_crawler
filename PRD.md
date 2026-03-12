# Product Requirements Document (PRD)
## Feishu Wiki Crawler

**Phiên bản:** 2.0  
**Ngày cập nhật:** 11/03/2026  
**Tác giả:** Manus AI  
**Trạng thái:** Đang phát triển

---

## 1. Tổng quan sản phẩm

### 1.1 Mô tả

Feishu Wiki Crawler là một ứng dụng web cho phép người dùng **crawl (thu thập) toàn bộ cấu trúc cây trang** của một không gian wiki Feishu (飞书) hoặc Lark, sau đó **xuất nội dung dưới dạng Markdown** để lưu trữ, tìm kiếm hoặc xử lý offline. Ứng dụng hỗ trợ cả hai nền tảng Feishu (`feishu.cn`) và Lark (`larksuite.com`), xử lý được wiki có quy mô lớn (10.000+ trang) với cơ chế crawl bền vững, không bỏ sót node.

### 1.2 Vấn đề cần giải quyết

Feishu Wiki không cung cấp tính năng xuất toàn bộ không gian wiki ra file offline theo cách đơn giản. Người dùng muốn:

- Lưu trữ toàn bộ nội dung wiki để đọc offline hoặc backup
- Tìm kiếm toàn văn bản trên tất cả trang wiki (Feishu search bị giới hạn)
- Chuyển đổi nội dung sang hệ thống khác (Notion, Obsidian, GitHub Wiki, v.v.)
- Phân tích cấu trúc và metadata của toàn bộ không gian wiki

### 1.3 Đối tượng người dùng

| Nhóm người dùng | Nhu cầu chính |
|---|---|
| Quản trị viên kiến thức (Knowledge Manager) | Backup định kỳ, kiểm tra cấu trúc wiki |
| Kỹ sư phần mềm | Tích hợp nội dung wiki vào pipeline xử lý văn bản, RAG |
| Nhà nghiên cứu / Phân tích dữ liệu | Phân tích tần suất chỉnh sửa, tác giả, cấu trúc tổ chức |
| Người dùng cá nhân | Lưu trữ wiki cá nhân, chuyển đổi sang công cụ khác |

---

## 2. Phạm vi tính năng (Scope)

### 2.1 Trong phạm vi (In Scope)

- Crawl cấu trúc cây wiki qua Feishu/Lark Open API
- Hỗ trợ xác thực bằng App Credentials (App ID + App Secret) hoặc User Access Token
- Hiển thị cây wiki dạng bảng có thể tìm kiếm, sắp xếp
- Xuất danh sách node dạng CSV
- Xuất nội dung trang `docx` dạng Markdown (ZIP)
- Hỗ trợ crawl toàn space hoặc chỉ subtree của một node
- Hỗ trợ resume khi crawl bị gián đoạn (token hết hạn, rate limit)

### 2.2 Ngoài phạm vi (Out of Scope)

- Xuất file Docx hoặc PDF (yêu cầu scope `drive:export` đặc biệt từ Feishu)
- Chỉnh sửa hoặc ghi ngược nội dung lên Feishu Wiki
- Crawl Feishu Sheets, Bitable, hoặc các loại tài liệu khác ngoài `docx`
- Đồng bộ tự động theo lịch (scheduled sync)
- Tìm kiếm toàn văn trên nội dung đã crawl

---

## 3. Kiến trúc kỹ thuật

### 3.1 Stack công nghệ

| Tầng | Công nghệ |
|---|---|
| Frontend | React 19, TypeScript, Tailwind CSS 4, shadcn/ui |
| Backend | Node.js, Express 4, tRPC 11 |
| Database | MySQL / TiDB (Drizzle ORM) |
| API Protocol | tRPC (type-safe RPC) + REST (file download endpoints) |
| Crawl Engine | Concurrent BFS với p-limit, SSE streaming |
| Auth | Manus OAuth (đăng nhập app) + Feishu API credentials |

### 3.2 Mô hình dữ liệu

Hệ thống sử dụng 3 bảng chính để quản lý trạng thái crawl:

**Bảng `crawl_sessions`** — Mỗi lần crawl là một session độc lập.

| Cột | Kiểu | Mô tả |
|---|---|---|
| `id` | INT PK | ID session |
| `spaceId` | VARCHAR(64) | Feishu space_id |
| `domain` | VARCHAR(256) | Domain wiki (vd: `https://waytoagi.feishu.cn`) |
| `apiBase` | VARCHAR(256) | API base URL (`open.feishu.cn` hoặc `open.larksuite.com`) |
| `status` | ENUM | `running` / `paused` / `done` / `failed` |
| `totalNodes` | INT | Tổng số node đã crawl |
| `pendingQueue` | INT | Số task đang chờ trong queue |
| `skippedNodes` | INT | Số node bị bỏ qua (không có quyền) |
| `errorMsg` | TEXT | Thông báo lỗi nếu có |

**Bảng `crawl_queue`** — Hàng đợi BFS bền vững, lưu vào DB để không mất khi restart.

| Cột | Kiểu | Mô tả |
|---|---|---|
| `id` | INT PK | ID task |
| `sessionId` | INT FK | Thuộc session nào |
| `parentToken` | VARCHAR(64) | Token của node cha (null = root) |
| `fetchSpaceId` | VARCHAR(64) | Space ID cần fetch (hỗ trợ cross-space shortcuts) |
| `depth` | INT | Độ sâu trong cây |
| `status` | ENUM | `pending` / `done` / `failed` |
| `retryCount` | INT | Số lần đã retry |

**Bảng `crawl_nodes`** — Tất cả node đã phát hiện.

| Cột | Kiểu | Mô tả |
|---|---|---|
| `id` | INT PK | ID node |
| `sessionId` | INT FK | Thuộc session nào |
| `nodeToken` | VARCHAR(64) | Token định danh node trong wiki |
| `objToken` | VARCHAR(64) | Token của tài liệu thực (docx, sheet, v.v.) |
| `objType` | VARCHAR(32) | Loại tài liệu: `docx`, `doc`, `sheet`, `bitable`, `file`, `wiki` |
| `nodeType` | VARCHAR(32) | `origin` hoặc `shortcut` |
| `title` | TEXT | Tiêu đề trang |
| `url` | TEXT | URL đầy đủ của trang |
| `depth` | INT | Độ sâu trong cây (0 = root) |
| `hasChild` | INT | 0/1 — có trang con không |
| `parentNodeToken` | VARCHAR(64) | Token node cha |
| `objCreateTime` | BIGINT | Thời điểm tạo tài liệu (Unix ms) |
| `objEditTime` | BIGINT | Thời điểm chỉnh sửa cuối (Unix ms) |

### 3.3 Luồng crawl (Persistent BFS)

```
[User nhập URL + credentials]
        ↓
[Backend: parse URL → extract space_id]
        ↓
[Tạo crawl_session + seed crawl_queue với root node]
        ↓
[SSE stream: gửi progress real-time về frontend]
        ↓
[BFS loop: lấy batch pending tasks từ DB]
        ↓
[Fetch children từ Feishu API (concurrency=5, retry với backoff)]
        ↓
[Lưu nodes vào crawl_nodes, đánh dấu task done]
        ↓
[Nếu rate limit → đưa task về pending, đợi backoff]
        ↓
[Nếu token hết hạn → pause session, thông báo user]
        ↓
[Khi queue rỗng → session done]
```

---

## 4. Tính năng chi tiết

### 4.1 Xác thực (Authentication)

Ứng dụng hỗ trợ hai chế độ xác thực với Feishu API:

**Chế độ App Credentials** phù hợp để crawl cấu trúc wiki (danh sách node, metadata). Người dùng cung cấp App ID và App Secret từ Feishu Developer Console. Backend tự động lấy `tenant_access_token` và làm mới khi hết hạn.

**Chế độ User Access Token** bắt buộc khi cần đọc nội dung tài liệu (export Markdown). Token có thời hạn 2 giờ. Khi token hết hạn giữa chừng, hệ thống tạm dừng session và cho phép người dùng cung cấp token mới để tiếp tục (Resume).

> **Lưu ý quan trọng:** Feishu API `/docs/v1/content` (đọc nội dung Markdown) chỉ hoạt động với **User Access Token**. App Token (`tenant_access_token`) không có scope `docs:document.content:read` cần thiết.

### 4.2 Crawl Wiki

**Phát hiện platform tự động:** Hệ thống tự nhận diện URL thuộc Feishu (`feishu.cn`) hay Lark (`larksuite.com`) và chọn API base URL phù hợp (`open.feishu.cn` hoặc `open.larksuite.com`).

**Phân giải URL:** URL wiki có thể chứa `node_token` (vd: `https://waytoagi.feishu.cn/wiki/QPe5w5g7...`). Backend gọi API `wiki/v2/spaces/get_node` để phân giải `node_token` → `space_id` trước khi bắt đầu crawl.

**Phạm vi crawl:** Người dùng có thể chọn:
- **Entire Space** — crawl toàn bộ không gian wiki từ root
- **This Node Only** — chỉ crawl subtree của node trong URL

**Xử lý shortcut nodes:** Feishu Wiki cho phép tạo shortcut (liên kết) đến trang thuộc space khác. Hệ thống xử lý `node_type=shortcut` bằng cách dùng `origin_node_token` và `origin_space_id` để fetch children từ space gốc.

**Xử lý lỗi và retry:**

| Loại lỗi | Xử lý |
|---|---|
| Token hết hạn (code 99991668) | Dừng crawl ngay, thông báo user, cho phép Resume |
| Rate limit (code 99991400) | Backoff 2s → 4s → 8s → 16s → 32s, retry tối đa 5 lần |
| Node không có quyền (code 230002-230004) | Bỏ qua node, tăng `skippedNodes`, tiếp tục crawl |
| Lỗi HTTP 5xx | Retry với exponential backoff (500ms → 1s → 2s → 4s → 8s) |

**Resume session:** Khi session bị tạm dừng (status=`paused`), người dùng có thể cung cấp token mới và nhấn "Resume" để tiếp tục từ điểm dừng. Hệ thống xử lý lại tất cả task có status=`pending` trong queue.

### 4.3 Hiển thị kết quả

**Chế độ bảng (Table View)** là chế độ mặc định, hiển thị tất cả node dưới dạng bảng phẳng với các cột:

| Cột | Mô tả |
|---|---|
| Title | Tiêu đề trang, có thể click để mở Feishu |
| Type | Loại tài liệu (`docx`, `sheet`, `bitable`, v.v.) |
| Depth | Độ sâu trong cây (0 = root) |
| Created | Thời điểm tạo |
| Edited | Thời điểm chỉnh sửa cuối |
| Actions | Nút download file `.md` cho từng trang |

Bảng hỗ trợ **tìm kiếm theo tiêu đề** (highlight kết quả), **sắp xếp** theo tất cả cột, và **virtual scroll** để xử lý mượt mà với 10.000+ dòng mà không ảnh hưởng hiệu năng.

**Chế độ cây (Tree View)** hiển thị cấu trúc phân cấp của wiki, hỗ trợ expand/collapse từng nhánh và lazy loading cho cây lớn.

### 4.4 Export CSV

Người dùng có thể xuất toàn bộ danh sách node ra file CSV với các cột: `title`, `url`, `type`, `depth`, `nodeToken`, `objToken`, `parentNodeToken`, `hasChild`, `createdAt`, `editedAt`. Tính năng này không yêu cầu Feishu API — dữ liệu đã có sẵn trong database sau khi crawl.

### 4.5 Export Markdown (ZIP)

Tính năng xuất nội dung tất cả trang `docx` sang file Markdown, đóng gói thành một file ZIP.

**Luồng hoạt động:**

```
[POST /api/wiki/export/start]
  → Tạo export job (in-memory), trả về jobId
  → Background: fetch markdown từng trang (concurrency=3, delay=800ms)
  → Mỗi file .md có YAML frontmatter: title, url, depth

[GET /api/wiki/export/status?jobId=X]
  → Poll tiến trình: done/total, rate, elapsed

[GET /api/wiki/export/download?jobId=X]
  → Stream ZIP file về client
```

**API Feishu sử dụng:** `GET /open-apis/docs/v1/content?doc_token={token}&doc_type=docx&content_type=markdown`

**Rate limit:** 5 requests/giây. Hệ thống dùng concurrency=3 với delay 800ms giữa các batch, đạt ~3.75 req/giây để đảm bảo không vượt giới hạn.

**Cấu trúc file Markdown đầu ra:**

```markdown
---
title: "Tên trang"
url: "https://waytoagi.feishu.cn/docx/AbCdEf..."
depth: 2
---

# Nội dung trang...
```

**Export từng trang đơn lẻ:** Ngoài export hàng loạt, người dùng có thể download từng trang riêng lẻ trực tiếp từ bảng kết quả qua endpoint `GET /api/wiki/export/single?objToken=...`.

### 4.6 Giao diện người dùng

**Trang chính (Home)** được thiết kế theo phong cách dashboard nội bộ, sử dụng layout một cột tập trung với:

- **Form nhập liệu:** URL wiki, chọn chế độ xác thực (App Credentials / User Access Token), chọn phạm vi crawl (Entire Space / This Node Only)
- **Progress bar real-time:** Hiển thị số node đã crawl, tốc độ (nodes/giây), thời gian ước tính còn lại qua SSE streaming
- **Khu vực kết quả:** Tab chuyển đổi giữa Table View và Tree View, thanh tìm kiếm, các nút export (CSV, MD ZIP)
- **Badge platform:** Hiển thị "Feishu" (màu xanh dương) hoặc "Lark" (màu xanh sky) khi phát hiện platform từ URL

**Trạng thái lỗi:** Mỗi loại lỗi có thông báo riêng biệt, rõ ràng:
- Token hết hạn → hướng dẫn lấy token mới + nút Resume
- App Token dùng cho export → cảnh báo và hướng dẫn chuyển sang User Token
- Node không có quyền → hiển thị số node bị bỏ qua, không dừng crawl

---

## 5. API Endpoints

### 5.1 tRPC Procedures

| Procedure | Loại | Mô tả |
|---|---|---|
| `wiki.crawl` | Mutation | Bắt đầu crawl session mới |
| `wiki.getSession` | Query | Lấy thông tin session theo ID |
| `wiki.listSessions` | Query | Danh sách tất cả sessions |
| `wiki.getNodes` | Query | Lấy nodes của một session |
| `wiki.resumeSession` | Mutation | Resume session đang paused |
| `wiki.deleteSession` | Mutation | Xóa session và dữ liệu liên quan |

### 5.2 REST Endpoints (File Operations)

| Endpoint | Method | Mô tả |
|---|---|---|
| `/api/wiki/crawl/start` | POST | Bắt đầu crawl (persistent BFS) |
| `/api/wiki/crawl/progress` | GET (SSE) | Stream tiến trình crawl real-time |
| `/api/wiki/crawl/resume` | POST | Resume session bị pause |
| `/api/wiki/export/start` | POST | Bắt đầu export Markdown job |
| `/api/wiki/export/status` | GET | Poll trạng thái export job |
| `/api/wiki/export/download` | GET | Download ZIP file |
| `/api/wiki/export/single` | GET | Download một trang .md |

---

## 6. Yêu cầu phi chức năng

### 6.1 Hiệu năng

- Crawl 10.000+ node trong vòng 10–30 phút tùy kích thước wiki và rate limit của Feishu
- Table view render mượt mà với 10.000+ dòng nhờ virtual scroll (chỉ render ~20 dòng hiển thị)
- Tree view lazy load — chỉ expand node khi người dùng click

### 6.2 Độ tin cậy

- Persistent queue đảm bảo không bỏ sót node khi server restart hoặc token hết hạn
- Retry với exponential backoff cho rate limit và lỗi tạm thời
- Export job lưu ZIP in-memory — không mất dữ liệu khi client mất kết nối (có thể re-download)

### 6.3 Bảo mật

- Credentials (App Secret, User Access Token) không được lưu vào database — chỉ dùng trong request và xóa sau khi crawl xong
- Tất cả API calls đến Feishu thực hiện server-side, không expose credentials ra client
- Session cookie được ký bằng JWT_SECRET

### 6.4 Khả năng mở rộng

- Kiến trúc cho phép thêm loại export mới (vd: HTML, JSON) mà không thay đổi crawl engine
- Database schema hỗ trợ nhiều sessions song song cho nhiều người dùng

---

## 7. Hạn chế đã biết

Một số hạn chế hiện tại cần người dùng lưu ý:

**Export Markdown chỉ hỗ trợ node loại `docx`** — các loại khác như `sheet`, `bitable`, `file` không có API đọc nội dung tương đương. Những node này vẫn xuất hiện trong danh sách crawl nhưng không thể export nội dung.

**User Access Token hết hạn sau 2 giờ** — với wiki lớn (10.000+ trang), quá trình export Markdown có thể mất nhiều giờ. Người dùng cần làm mới token định kỳ.

**Export job lưu in-memory** — nếu server restart trong lúc export đang chạy, job sẽ bị mất. Người dùng cần bắt đầu lại. Giải pháp dài hạn là lưu ZIP vào S3.

**Rate limit Feishu** — tốc độ export Markdown bị giới hạn bởi Feishu API (~5 req/giây). Với 1.000 trang, thời gian export ước tính ~5–10 phút.

---

## 8. Roadmap (Tính năng tương lai)

| Ưu tiên | Tính năng | Ghi chú |
|---|---|---|
| Cao | Lưu ZIP export lên S3 | Tránh mất file khi server restart, cho phép share link |
| Cao | Fix lỗi MD export với User Access Token | Debug và xác nhận flow hoạt động end-to-end |
| Trung bình | Scheduled crawl (tự động theo lịch) | Cron job, gửi thông báo khi xong |
| Trung bình | Tìm kiếm toàn văn trên nội dung đã crawl | Index Markdown vào Elasticsearch hoặc SQLite FTS |
| Thấp | Export sang HTML | Dùng markdown-it để convert .md → .html |
| Thấp | So sánh diff giữa 2 lần crawl | Hiển thị trang mới/xóa/sửa |

---

## 9. Lịch sử phiên bản

| Phiên bản | Ngày | Thay đổi chính |
|---|---|---|
| 1.0 | 10/03/2026 | Crawl cơ bản, hiển thị bảng, export CSV |
| 1.1 | 10/03/2026 | Persistent BFS queue, SSE streaming, Resume |
| 1.2 | 10/03/2026 | Export Markdown ZIP, download từng trang |
| 1.3 | 10/03/2026 | Hỗ trợ Larksuite, crawl subtree, virtual scroll |
| 2.0 | 11/03/2026 | Bỏ tính năng export Docx/PDF (yêu cầu scope đặc biệt), tập trung hoàn thiện MD export |
