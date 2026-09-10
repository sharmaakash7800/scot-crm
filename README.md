# SCOT - Sales & Client Order Tracking System with MongoDB

An enterprise-grade, modern Web Application replacing static Excel-based SCOT sheets (`Monthly_Scot_Automated_FY26-27.xlsx`). All Client records, Transaction logs, Enquiry tracking, and Leaking Bucket calculations are securely stored in **MongoDB** with real-time analytics and dynamic UI/UX.

---

## 🚀 Key Features

1. **MongoDB Database Architecture**:
   - **Client Master**: Full CRM profiles, unique IDs, contact details, usual order frequency, first order dates.
   - **Transaction Log**: Real-time sales transactions, invoice tracking, auto-linked to client records.
   - **Enquiry Capture & Leaking Bucket**: Monthly breakdown of enquiries vs un-followed orders and lost revenue values.
   - **Zero-Setup Database Engine**: Automatically connects to local MongoDB or MongoDB Atlas, with an embedded in-memory fallback for instant dev testing.

2. **Modern Executive Dashboard**:
   - Live KPI cards: Active Clients, Cumulative Sales, Inactive Clients (6+ months), Irregular Orders, and Lost Sales figures.
   - Chart.js visual analytics: Sales trend vs Lost sales bars & Client health distribution doughnut.
   - Month-by-month historical selector (Apr'26 to Mar'27).

3. **Dynamic Calculations (Matching Excel Formulas)**:
   - Automated Days Since Last Order calculation.
   - Dynamic classification: `Active (0-30 days)`, `Slow (31-90 days)`, `At Risk (91-181 days)`, `Inactive (6+ months)`.
   - Benchmark order size comparison.
   - Full FY 26-27 Leaking Bucket and Monthly Loss Matrix.

4. **Excel Import & Export**:
   - 1-click drag & drop import of existing Excel files.
   - Export any month's computed SCOT report to clean `.xlsx`.

---

## 🛠️ Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure MongoDB (Optional)
By default, the application connects to `mongodb://127.0.0.1:27017/scot_sales_db`.
If you want to connect to **MongoDB Atlas**, copy `.env.example` to `.env` and paste your URI:
```bash
cp .env.example .env
```
Inside `.env`:
```env
PORT=5000
MONGODB_URI=mongodb+srv://<username>:<password>@cluster0.mongodb.net/scot_sales_db?retryWrites=true&w=majority
```

### 3. Start Application
```bash
npm start
```
Open your browser at: **`http://localhost:5000`**

---

## 🌐 Git & GitHub Upload Guide

To upload this repository to GitHub:

```bash
# 1. Initialize Git repository
git init

# 2. Stage all files (node_modules and .env are automatically ignored)
git add .

# 3. Create initial commit
git commit -m "Initial commit: SCOT Sales Tracking Web App with MongoDB & Modern UI"

# 4. Set main branch
git branch -M main

# 5. Connect to your GitHub repository
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git

# 6. Push code to GitHub
git push -u origin main
```
