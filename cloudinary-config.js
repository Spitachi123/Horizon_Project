/* ============================================================
   CLOUDINARY CONFIG — REPLACE WITH YOUR OWN CLOUDINARY VALUES
   ============================================================
   Cloudinary's free tier is used here instead of Firebase Storage
   for hosting uploaded PDF reading materials. Free Cloudinary
   accounts don't require a billing plan (unlike Firebase Storage,
   which now needs the Blaze pay-as-you-go plan), and uploads happen
   straight from the browser with an "unsigned upload preset" — no
   backend or secret key required.

   Where to find / create these:
   1. Sign up free at https://cloudinary.com
   2. Dashboard → your "Cloud name" is shown at the top. Paste it
      below as CLOUDINARY_CLOUD_NAME.
   3. Settings (gear icon) → Upload → scroll to "Upload presets" →
      Add upload preset → set "Signing Mode" to **Unsigned** → Save.
      Paste that preset's name below as CLOUDINARY_UPLOAD_PRESET.

   This file is safe to publish publicly (GitHub, GitHub Pages,
   etc). An unsigned upload preset only allows *uploads* (optionally
   restricted by folder/size/type in the preset's settings) — it is
   not a secret credential and does not grant delete/admin access.
   ============================================================ */

const cloudinaryConfig = {
  cloudName: 'hljcdeud',
  uploadPreset: 'divedu_materials'
};
