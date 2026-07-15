const DB_NAME = "glance-bg-images";
/** Pre-rename database name — migrated in on first access, see `ensureMigrated`. */
const OLD_DB_NAME = "terax-bg-images";
const STORE = "images";
const VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openNamedDb(name: string): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(name, VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("IndexedDB blocked by another tab"));
  });
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  const p = openNamedDb(DB_NAME).then((db) => {
    db.onclose = () => {
      if (dbPromise === p) dbPromise = null;
    };
    return db;
  });
  dbPromise = p.catch((e) => {
    if (dbPromise === p) dbPromise = null;
    throw e;
  });
  return dbPromise;
}

function listEntries(db: IDBDatabase): Promise<Array<[string, Blob]>> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const entries: Array<[string, Blob]> = [];
    const req = tx.objectStore(STORE).openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        entries.push([String(cursor.key), cursor.value as Blob]);
        cursor.continue();
      } else {
        resolve(entries);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

function clearStore(db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function writeEntries(
  db: IDBDatabase,
  entries: ReadonlyArray<[string, Blob]>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const objStore = tx.objectStore(STORE);
    for (const [key, blob] of entries) objStore.put(blob, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * One-time, best-effort copy of every background image from the pre-rename
 * `terax-bg-images` database into `glance-bg-images`, only when the new
 * database is still empty. `indexedDB.databases()` (where supported) avoids
 * ever opening — and thereby creating — the legacy database on a fresh
 * install; where it's unsupported we fall back to opening it directly (an
 * empty database left behind on a truly-fresh install is harmless).
 * The pure "should we copy, and what" decision reuses
 * `planLazyStoreMigration` — a whole-object-store swap is the same shape as
 * a whole-Tauri-store-file swap: copy every old entry only when the new
 * side is still empty.
 */
let migrationPromise: Promise<void> | null = null;

async function ensureMigrated(): Promise<void> {
  if (!migrationPromise) migrationPromise = runMigration();
  return migrationPromise;
}

async function runMigration(): Promise<void> {
  try {
    if (typeof indexedDB.databases === "function") {
      const dbs = await indexedDB.databases();
      if (!dbs.some((d) => d.name === OLD_DB_NAME)) return;
    }
    const db = await openDb();
    const newEntries = await listEntries(db);
    if (newEntries.length > 0) return; // new store already has data
    const oldDb = await openNamedDb(OLD_DB_NAME);
    try {
      const oldEntries = await listEntries(oldDb);
      const { planLazyStoreMigration } = await import(
        "@/modules/migrations/lazyStoreMigration"
      );
      const plan = planLazyStoreMigration(newEntries, oldEntries);
      if (!plan.shouldMigrate) return;
      await writeEntries(db, plan.entriesToWrite);
      try {
        await clearStore(oldDb);
      } catch {
        /* not fatal — new store already has the data */
      }
    } finally {
      oldDb.close();
    }
  } catch {
    /* migration is best-effort; never block a background-image read/write */
  }
}

export async function putBgImage(id: string, blob: Blob): Promise<void> {
  await ensureMigrated();
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(blob, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "QuotaExceededError") {
      throw new Error(
        "Not enough storage to save this image. Remove unused themes or backgrounds and try again.",
      );
    }
    throw e;
  }
}

export async function getBgImage(id: string): Promise<Blob | null> {
  await ensureMigrated();
  const db = await openDb();
  return new Promise<Blob | null>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteBgImage(id: string): Promise<void> {
  await ensureMigrated();
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

const MAX_DIM = 2560;
const JPEG_QUALITY = 0.88;
const MAX_STATIC_BYTES = 30 * 1024 * 1024;
const MAX_ANIMATED_BYTES = 10 * 1024 * 1024;
const WEBP_SNIFF_BYTES = 64;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

async function isAnimated(file: File): Promise<boolean> {
  const t = file.type.toLowerCase();
  if (t === "image/gif" || t === "image/apng") return true;
  if (t !== "image/webp") return false;
  const head = new Uint8Array(
    await file.slice(0, WEBP_SNIFF_BYTES).arrayBuffer(),
  );
  if (
    head.length < 30 ||
    head[0] !== 0x52 || head[1] !== 0x49 || head[2] !== 0x46 || head[3] !== 0x46 ||
    head[8] !== 0x57 || head[9] !== 0x45 || head[10] !== 0x42 || head[11] !== 0x50
  ) return false;
  if (
    head[12] === 0x56 && head[13] === 0x50 && head[14] === 0x38 && head[15] === 0x58
  ) {
    return (head[20] & 0x02) !== 0;
  }
  return false;
}

export async function importBgImageFromFile(file: File): Promise<{ id: string; blob: Blob }> {
  if (!file.type.startsWith("image/")) {
    throw new Error("This file isn't an image.");
  }
  const id = crypto.randomUUID();
  const animated = await isAnimated(file);
  const limit = animated ? MAX_ANIMATED_BYTES : MAX_STATIC_BYTES;
  if (file.size > limit) {
    const limitMb = Math.round(limit / 1024 / 1024);
    throw new Error(
      animated
        ? `Animated images are limited to ${limitMb} MB to keep things smooth. This one is ${formatBytes(file.size)}.`
        : `Images are limited to ${limitMb} MB. This one is ${formatBytes(file.size)}.`,
    );
  }
  if (animated) {
    const blob = file.slice(0, file.size, file.type);
    await putBgImage(id, blob);
    return { id, blob };
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("This image couldn't be decoded. Try a different file.");
  }
  const { width, height } = bitmap;
  const scale = Math.min(1, MAX_DIM / Math.max(width, height));
  const targetW = Math.max(1, Math.round(width * scale));
  const targetH = Math.max(1, Math.round(height * scale));
  try {
    const blob = await encodeJpeg(bitmap, targetW, targetH);
    await putBgImage(id, blob);
    return { id, blob };
  } finally {
    bitmap.close();
  }
}

async function encodeJpeg(
  bitmap: ImageBitmap,
  w: number,
  h: number,
): Promise<Blob> {
  if (typeof OffscreenCanvas !== "undefined") {
    const off = new OffscreenCanvas(w, h);
    const ctx = off.getContext("2d");
    if (!ctx) throw new Error("offscreen 2D context unavailable");
    ctx.drawImage(bitmap, 0, 0, w, h);
    return off.convertToBlob({ type: "image/jpeg", quality: JPEG_QUALITY });
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2D context unavailable");
  ctx.drawImage(bitmap, 0, 0, w, h);
  try {
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("failed to encode image"))),
        "image/jpeg",
        JPEG_QUALITY,
      );
    });
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
