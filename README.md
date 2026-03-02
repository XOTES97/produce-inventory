# Produce Inventory (Kardex) (Supabase + Mobile PWA)

This is an MVP inventory tracking system for a produce business where **all inventory is tracked in kilograms (kg)** and every movement can include **proof photos** (for example WhatsApp screenshots).

The system is based on a **movement ledger** (kardex): you never "edit stock". You record movements and on-hand inventory is computed as the sum of those movements.

## What It Supports
- `Entrada` (inventory in, +kg)
- `Venta` (sale, -kg) with pricing:
  - `per_kg` (price per kg)
  - `per_box` (fixed price per box, variable kg; store both boxes + kg)
- `Merma` (waste/decomposition, -kg)
- `Traspaso SKU` (move kg from one SKU to another; net 0kg)
- `Traspaso de Calidad` (quality transfer, -kg from one quality, +kg to another quality)
- `Ajuste` (manual correction, +/-kg)
- Delete/cancel movements (for mistakes/testing)
- `Cortes fisicos` (physical inventory cutoffs by SKU with timed weigh-ins, optional proof photos, discrepancy report, print view, and Excel-compatible kardex export between cutoffs)

## Architecture
- Database: Supabase Postgres (tables + RLS policies)
- Proof photos (optional): Supabase Storage bucket (`movement-proofs`)
- UI: Mobile-first PWA (static HTML/JS) in `web/`

## Setup (Supabase)
1. Create a new Supabase project.
2. In Supabase SQL Editor, run:
   - `supabase/schema.sql`
   - If your app is already live and you are updating from an older version, run `supabase/cutoffs_patch.sql` once.
3. Create your user (email + password) in Supabase Auth.
4. (Recommended) Disable public sign-ups in Supabase Auth settings so you remain the only user.
5. Get:
   - Project URL
   - `anon` public API key

## Setup (Web UI)
1. Edit `web/config.js` and set:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
2. Serve `web/` locally (example):
   ```bash
   cd web
   python3 -m http.server 5173
   ```
3. Open `http://localhost:5173` on your phone/computer (same network).

For a real installable PWA on mobile, deploy the `web/` folder to any static host that serves over HTTPS.

## First Run
1. Sign in.
2. Go to `Ajustes` and click `Cargar SKUs base` to create starter:
   - Products
   - Qualities
   - SKUs (codes + mapping)
3. (Optional) Add `Empleados` to tag who reported a movement.
4. Start capturing movements in `Capturar`. Proof photos are optional.
