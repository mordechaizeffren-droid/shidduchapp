// src/lib/files.js
import { supabase } from "../supabaseClient";

// Use your existing bucket name
const BUCKET = "files";

// Generate a stable key per file
const keyFor = (id, name = "file") =>
  `${id}/${encodeURIComponent(name.replace(/\s+/g, "_"))}`;

// Upload a File to Supabase Storage
export async function uploadFile(file, id) {
  const fileId = id || (Math.random().toString(36).slice(2) + Date.now().toString(36));
  const key = keyFor(fileId, file.name || "file");

  const { error } = await supabase
    .storage
    .from(BUCKET)
    .upload(key, file, { upsert: true, contentType: file.type || "application/octet-stream" });

  if (error) throw error;

  return {
    id: fileId,
    name: file.name || "file",
    type: file.type || "application/octet-stream",
    size: file.size || 0,
    bucket: BUCKET,
    key,
    addedAt: Date.now()
  };
}

// Download as Blob
export async function downloadRef(ref) {
  if (!ref?.key) return null;
  const { data, error } = await supabase.storage.from(ref.bucket || BUCKET).download(ref.key);
  if (error) throw error;
  return data; // Blob
}

// Delete from storage
export async function deleteRef(ref) {
  if (!ref?.key) return;
  await supabase.storage.from(ref.bucket || BUCKET).remove([ref.key]).catch(() => {});
}

// Get a URL you can <img src> or <iframe src>
// If bucket is public, returns public URL; otherwise a signed URL.
export async function viewUrl(ref, ttlSec = 3600) {
  if (!ref?.key) return "";
  const bucket = ref.bucket || BUCKET;

  // Try public URL first
  const pub = supabase.storage.from(bucket).getPublicUrl(ref.key);
  if (pub?.data?.publicUrl) return pub.data.publicUrl;

  // Fallback to signed URL if bucket is private
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(ref.key, ttlSec);
  if (error) return "";
  return data.signedUrl;
}

