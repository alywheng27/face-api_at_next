# Face Recognition System — Next.js + face-api.js + MSSQL

A complete face identification app. Point a camera at someone, and it matches
them against your MSSQL database and displays their info in real time.

---

## How it works (the full picture)

```
┌─────────────────────────────────────────────────────────────────┐
│  BROWSER (client-side)                                          │
│                                                                 │
│  1. Page loads → fetch /api/descriptors                         │
│     Gets [{id, name, descriptor: [128 floats]}, ...] from MSSQL │
│                                                                 │
│  2. Build FaceMatcher from those descriptors                    │
│     (face-api.js holds all known faces in memory)               │
│                                                                 │
│  3. Every 2 seconds:                                            │
│     a. Grab a frame from the webcam                             │
│     b. Run tinyFaceDetector → finds face bounding box           │
│     c. Run faceLandmark68Net → finds 68 key points on face      │
│     d. Run faceRecognitionNet → converts to 128 floats          │
│     e. FaceMatcher.findBestMatch() → Euclidean distance check   │
│     f. If distance < 0.5 → match found (label = person DB id)  │
│                                                                 │
│  4. On match → fetch /api/person/:id                            │
│     Gets name, email, department, etc. from MSSQL               │
│                                                                 │
│  5. Display result card                                         │
└─────────────────────────────────────────────────────────────────┘
         │ API calls (JSON over HTTP)
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  SERVER (Next.js API routes)                                    │
│                                                                 │
│  GET  /api/descriptors  → SELECT id, name, face_descriptor      │
│  GET  /api/person/:id   → SELECT * FROM people WHERE id = @id  │
│  GET  /api/people       → SELECT all (for enrollment dropdown)  │
│  POST /api/enroll       → UPDATE people SET face_descriptor     │
└─────────────────────────────────────────────────────────────────┘
         │ mssql connection pool
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  MSSQL Database                                                 │
│                                                                 │
│  Table: people                                                  │
│    id              INT (your existing PK)                       │
│    name            NVARCHAR                                     │
│    email           NVARCHAR  (your existing column)             │
│    department      NVARCHAR  (your existing column)             │
│    face_descriptor NVARCHAR(MAX)  ← NEW: stores 128 floats      │
└─────────────────────────────────────────────────────────────────┘
```

---

## File structure

```
face-recognition-app/
├── app/
│   ├── layout.tsx            # Root layout (navbar + font)
│   ├── page.tsx              # Home / landing page
│   ├── globals.css           # All styles
│   ├── scan/
│   │   └── page.tsx          # /scan — scanner page (server component)
│   ├── enroll/
│   │   └── page.tsx          # /enroll — enrollment page (server component)
│   └── api/
│       ├── descriptors/
│       │   └── route.ts      # GET  — returns all face descriptors
│       ├── enroll/
│       │   └── route.ts      # POST — saves descriptor to MSSQL
│       ├── people/
│       │   └── route.ts      # GET  — lists all people (for dropdown)
│       └── person/
│           └── [id]/
│               └── route.ts  # GET  — fetches one person's full info
├── components/
│   ├── FaceScanner.tsx       # "use client" — camera + face matching UI
│   └── EnrollPerson.tsx      # "use client" — enrollment UI
├── lib/
│   ├── db.ts                 # MSSQL connection pool singleton
│   └── faceapi.ts            # face-api.js model loader singleton
├── types/
│   └── index.ts              # Shared TypeScript interfaces
├── public/
│   └── models/               # ← Put face-api.js model files here
├── migration.sql             # Run once to add face_descriptor column
├── .env.example              # Copy to .env.local and fill in values
├── next.config.js            # Webpack fix for face-api.js on server
└── package.json
```

---

## Step-by-step setup

### Step 1 — Install dependencies

```bash
npm install
# or
yarn install
```

### Step 2 — Download face-api.js model files

You need these files in `/public/models/`. Download from:
https://github.com/justadudewhohacks/face-api.js/tree/master/weights

Files you need (download each .json and its -shard1 file):
```
tiny_face_detector_model-weights_manifest.json
tiny_face_detector_model-shard1
face_landmark_68_model-weights_manifest.json
face_landmark_68_model-shard1
face_recognition_model-weights_manifest.json
face_recognition_model-shard1
```

Or use this quick script:
```bash
mkdir -p public/models && cd public/models
BASE="https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights"
for f in \
  tiny_face_detector_model-weights_manifest.json tiny_face_detector_model-shard1 \
  face_landmark_68_model-weights_manifest.json face_landmark_68_model-shard1 \
  face_recognition_model-weights_manifest.json face_recognition_model-shard1
do
  curl -O "$BASE/$f"
done
```

### Step 3 — Configure environment variables

```bash
cp .env.example .env.local
```

Edit `.env.local`:
```
DB_SERVER=localhost          # or your-server.database.windows.net
DB_NAME=your_database
DB_USER=your_user
DB_PASSWORD=your_password
DB_PORT=1433
```

### Step 4 — Run the database migration

This adds the `face_descriptor` column to your existing `people` table:

```bash
sqlcmd -S localhost -d your_database -U your_user -P your_password -i migration.sql
```

Or paste `migration.sql` into SSMS and run it. It's safe to run multiple times.

### Step 5 — Adjust the SQL queries to match your table

Your `people` table probably has different column names. Update these files:

**`app/api/person/[id]/route.ts`** — change the SELECT to your column names:
```ts
.query(`SELECT id, name, email, department, position, phone FROM people WHERE id = @id`)
```

**`app/api/people/route.ts`** — same, adjust columns in the SELECT.

**`types/index.ts`** — update the `Person` interface to match your columns.

### Step 6 — Start the dev server

```bash
npm run dev
```

Open http://localhost:3000

### Step 7 — Enroll people

1. Go to http://localhost:3000/enroll
2. Select a person from the dropdown
3. Click "Start Camera" — allow camera access
4. Look at the camera, click "Capture Face"
5. Repeat for each person you want to be recognizable

### Step 8 — Use the scanner

1. Go to http://localhost:3000/scan
2. Wait for models to load (~5-10 seconds first time)
3. Look at the camera — it scans every 2 seconds

---

## Tuning accuracy

**Distance threshold** (in `components/FaceScanner.tsx`):
```ts
const MATCH_THRESHOLD = 0.5; // lower = stricter
```
- `0.4` — very strict, avoids false positives
- `0.5` — balanced (recommended)
- `0.6` — more lenient, catches more faces in different lighting

**Scan interval** (in `components/FaceScanner.tsx`):
```ts
const SCAN_INTERVAL_MS = 2000; // every 2 seconds
```
Lower = more responsive but higher CPU usage.

**Improving accuracy tips:**
- Enroll in good lighting (match your scanning environment)
- Enroll multiple times (re-enroll) to average different angles
- `inputSize: 320` in TinyFaceDetectorOptions — raise to 416 or 608 for better detection at the cost of speed

---

## Production checklist

- [ ] Protect `/enroll` with authentication (next-auth, Clerk, or custom middleware)
- [ ] Set `trustServerCertificate: false` in `lib/db.ts` with a real SSL cert
- [ ] Add rate limiting to `/api/descriptors` (it returns sensitive biometric data)
- [ ] Run over HTTPS (camera requires a secure context)
- [ ] Consider GDPR/biometric data regulations for your region