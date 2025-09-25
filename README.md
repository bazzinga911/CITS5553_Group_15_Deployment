# ESRI Comparison Tool

A full-stack tool for comparing original vs deep-learning imputed assay data.
Frontend is built with **React + Vite**, and backend is built with **FastAPI**.

---

## 🚀 Frontend (React + Vite)

### 1. Prerequisites

* Node.js 20+
* npm 9+

### 2. Setup

```bash
cd frontend-esri
npm install
npm run dev
```

* App runs at [http://localhost:5173](http://localhost:5173)
* Code changes hot-reload automatically

### 3. Production build

```bash
npm run build
npm run preview
```

### 4. Structure

```
frontend-esri/
 ├─ src/               # React components & app logic
 ├─ public/            # Static assets
 ├─ package.json       # Scripts & deps
 ├─ vite.config.ts     # Vite config
 ├─ tsconfig.json      # TypeScript config
 ├─ tailwind.config.js # Tailwind config
 ├─ postcss.config.js  # PostCSS config
```

### 5. Common issues

* **“vite is not recognized” (Windows)**
  Run `npm install`, then `npx vite` or `npm run dev`.
  If it still fails, delete `node_modules` and `package-lock.json`, then reinstall.

* **Port already in use (5173)**
  `npm run dev -- --port 5174` (or kill the process using 5173).

---

## ⚙️ Backend (FastAPI)

The backend handles data upload, cleaning, statistics, and plots.

### 1. Prerequisites

* Python 3.10+
* pip
* `venv` for virtual environments

### 2. Setup

```bash
cd backend-esri

# create and activate venv
python -m venv venv
source venv/bin/activate   # Mac/Linux
venv\Scripts\activate      # Windows

# install dependencies
pip install -r requirements.txt
```

### 3. Run the server

```bash
uvicorn app.main:app --reload
```

* Server: [http://127.0.0.1:8000](http://127.0.0.1:8000)

### 4. Structure

```
backend-esri/
 app/
 ├─ main.py           # FastAPI app & router registration
 ├─ routers/
 │   ├─ data.py       # /api/data endpoints (column extraction)
 │   └─ analysis.py   # /api/analysis (stats, plots, comparison)
 ├─ services/
 │   ├─ io_service.py # CSV/ZIP parsing, encoding detection, DataFrame utils
 │   └─ comparisons.py# grid stat methods (mean, median, max)
 └─ schemas.py        # Pydantic models (if used)
```

### 5. Key API endpoints

* `POST /api/data/columns` — extract column names from CSV/ZIP
* `POST /api/analysis/summary` — get stats (count, mean, median, max, std)
* `POST /api/analysis/plots` — histograms + QQ plot as base64 PNGs
* `POST /api/analysis/comparison` — grid meta + arrays
* `GET /api/health` — backend health check

### 6. Common issues

* **Module not found**: Always run `uvicorn` from inside `backend/`.
* **Port already in use**: Run `uvicorn app.main:app --reload --port 8000`.
---

## 🔗 Frontend + Backend integration

* CORS is already enabled in the backend for `http://localhost:5173`.
* When you run both services:

  * Start backend first: `uvicorn app.main:app --reload`
  * Then start frontend: `npm run dev`
* The frontend automatically calls the backend at `http://127.0.0.1:8000/api/...`.

---
