# ค่าตั้งทั้งหมด (Configuration)

ค่าทั้งหมดอยู่ใน **Apps Script → Project Settings → Script properties**
ค่าที่ไม่ได้ตั้ง จะใช้ค่า default ใน `apps-script/Config.gs`

---

## จำเป็นต้องมี

| Property | ตัวอย่าง | ความหมาย |
| --- | --- | --- |
| `SPREADSHEET_ID` | `1AbC...xyz` | ไฟล์ Google Sheets ที่ใช้เก็บข้อมูล |
| `ALLOWED_GROUP_ID` | `Cxxxxxxxx...` | กลุ่ม LINE เดียวที่ระบบยอมรับ |
| `INTERNAL_SIGNING_SECRET` | สุ่ม 64 ตัวอักษร | ลายเซ็นระหว่าง Worker กับ Apps Script (ต้องตรงกันทั้งสองฝั่ง) |
| `LINE_CHANNEL_SECRET` | จาก LINE console | ใช้ตรวจลายเซ็น webhook (Worker ใช้เป็นหลัก) |
| `LINE_CHANNEL_ACCESS_TOKEN` | จาก LINE console | ใช้ตอบข้อความ ดึงรูป และ push |

## 🔒 ความลับ

`LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`, `INTERNAL_SIGNING_SECRET`, `GEMINI_API_KEY`
ต้องอยู่ใน Script Properties (ฝั่ง Apps Script) และ Wrangler Secrets (ฝั่ง Worker) เท่านั้น
**ห้าม**อยู่ในไฟล์โค้ด ในช่องของชีต หรือใน log — ฟังก์ชัน `configRedact()` ตัดค่าเหล่านี้ออกจากข้อความ log ให้อัตโนมัติ

---

## สวิตช์เปิด/ปิด

| Property | default | ความหมาย |
| --- | --- | --- |
| `AI_ENABLED` | `false` | เรียก Gemini เมื่อกฎตอบไม่ได้ |
| `PUSH_ENABLED` | `false` | ส่งข้อความแบบ Push (นับโควตา LINE) |
| `OCR_ENABLED` | `false` | อ่านรูปสลิป/ใบเสร็จ |
| `ONBOARDING_ENABLED` | `false` | เปิดรับรหัสลงทะเบียนสมาชิก |
| `DAILY_SUMMARY_ENABLED` | `false` | สรุปรายวันอัตโนมัติ (ต้องมี Push) |
| `WEEKLY_SUMMARY_ENABLED` | `false` | สรุปรายสัปดาห์อัตโนมัติ |

---

## AI

| Property | default | ความหมาย |
| --- | --- | --- |
| `GEMINI_API_KEY` | — | API key จาก Google AI Studio |
| `AI_MODEL` | `gemini-2.5-flash-lite` | เปลี่ยนรุ่นได้โดยไม่ต้องแก้โค้ด |
| `AI_TIMEOUT_MS` | `12000` | timeout ต่อการเรียก |
| `AI_MAX_RETRIES` | `1` | จำนวน retry สูงสุด |
| `AI_MAX_OUTPUT_TOKENS` | `400` | จำกัดขนาดคำตอบ |
| `AI_MONTHLY_BUDGET_USD` | `1.00` | **เพดานงบจริงฝั่งเรา** เมื่อถึงเพดาน AI หยุดทำงาน ระบบใช้กฎ/ปุ่มต่อ |
| `AI_RESERVE_USD_PER_CALL` | `0.0005` | จองงบก่อนเรียก แล้วปรับตาม token จริงหลังได้คำตอบ |
| `AI_INPUT_USD_PER_MTOK` | `0.10` | ราคา input ต่อ 1 ล้าน token (ใช้คำนวณประมาณการ) |
| `AI_OUTPUT_USD_PER_MTOK` | `0.40` | ราคา output ต่อ 1 ล้าน token |

> ⚠️ ราคาโมเดลเปลี่ยนได้ ต้องตรวจกับหน้า pricing ของผู้ให้บริการก่อนเปิดใช้ และค่าเหล่านี้เป็น "ประมาณการฝั่งเรา" ไม่ใช่การรับประกันยอดบิลของผู้ให้บริการ

## OCR (Phase 8)

| Property | default | ความหมาย |
| --- | --- | --- |
| `ATTACHMENT_FOLDER_ID` | — | โฟลเดอร์ Drive เก็บรูปหลักฐาน (จำกัดสิทธิ์ 2 คน) |
| `OCR_MODEL` | ว่าง = ใช้ `AI_MODEL` | โมเดลที่อ่านรูป |
| `OCR_MAX_OUTPUT_TOKENS` | `800` | ใบเสร็จมีหลายบรรทัด จึงให้มากกว่าข้อความ |
| `OCR_MONTHLY_BUDGET_USD` | `1.00` | งบแยกจาก AI ข้อความ เพราะรูปแพงกว่า |
| `OCR_RESERVE_USD_PER_CALL` | `0.0030` | จองงบต่อรูป |

---

## การประมวลผลและความทนทาน

| Property | default | ความหมาย |
| --- | --- | --- |
| `PROCESSING_DEADLINE_MS` | `20000` | ทำงานเกินนี้ → ตอบ "รับไว้รอประมวลผล" แล้วให้ recovery ทำต่อ (ต้องต่ำกว่าอายุ reply token) |
| `ENVELOPE_MAX_AGE_SEC` | `300` | request ที่เก่ากว่านี้ถูกปฏิเสธ |
| `LEASE_SECONDS` | `120` | ระยะเวลาที่ execution หนึ่งจองงานไว้ |
| `MAX_ATTEMPTS` | `3` | ลองใหม่กี่ครั้งก่อนตีเป็น failed |
| `LOCK_WAIT_MS` | `10000` | รอ ScriptLock นานสุด |
| `PENDING_TTL_MINUTES` | `30` | อายุคำถามที่รอคำตอบ |

## แจ้งเตือนและงบ

| Property | default | ความหมาย |
| --- | --- | --- |
| `BUDGET_WARNING_PERCENTS` | `80,100` | เตือนที่กี่ % (คั่นด้วยจุลภาค) |
| `PUSH_MONTHLY_QUOTA` | `300` | โควตา Push ต่อเดือนตามแพ็กเกจ LINE |
| `PUSH_RESERVE_FOR_RECOVERY` | `30` | กันไว้แจ้งผลงานที่ประมวลผลช้า |

## เก็บ/ล้างข้อมูล

| Property | default | ความหมาย |
| --- | --- | --- |
| `RETENTION_PENDING_DAYS` | `7` | อายุคำถามที่ค้าง |
| `RETENTION_EVENT_DAYS` | `90` | อายุแถวใน `Inbox` (ไม่แตะรายการบัญชีและ AuditLog) |
| `BACKUP_FOLDER_ID` | — | โฟลเดอร์เก็บสำเนาสำรอง |
| `BACKUP_KEEP_COUNT` | `8` | เก็บสำเนากี่ชุด |
| `TIMEZONE` | `Asia/Bangkok` | ใช้ตัดสินว่า "วันนี้" คือวันไหน |

---

## ฝั่ง Cloudflare Worker

**ไม่ลับ** — อยู่ใน `worker/wrangler.toml`:

| ตัวแปร | ความหมาย |
| --- | --- |
| `APPS_SCRIPT_URL` | Web app URL ที่ลงท้าย `/exec` |
| `ALLOWED_GROUP_ID` | ต้องตรงกับฝั่ง Apps Script |
| `BACKEND_TIMEOUT_MS` | timeout เรียก Apps Script (default 25000) |

**ลับ** — ใส่ด้วย `npx wrangler secret put <NAME>`:
`LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`, `INTERNAL_SIGNING_SECRET`

---

## ตรวจว่าตั้งครบไหม

รัน `configHealthCheck()` ใน Apps Script → log จะบอกว่าตัวไหน `set` / `MISSING` โดยไม่แสดงค่าจริง
