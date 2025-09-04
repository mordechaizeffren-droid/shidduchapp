// src/lib/sync.js
import supabase from "./supa";

const TABLE = "sync_rooms";

// each device/browser session gets a unique id
const clientId = Math.random().toString(36).slice(2) + Date.now().toString(36);

/**
 * Save the current payload for a room.
 * Works even if "room" is not UNIQUE by doing update-then-insert.
 */
export async function saveRoom(room, payload) {
  if (!room) return;
  const updated_at = new Date().toISOString();

  // Tag the payload with clientId + updated_at
  const tagged = { ...payload, clientId, updated_at };

  // Try update first
  const { data, error } = await supabase
    .from(TABLE)
    .update({ payload: tagged, updated_at })
    .eq("room", room)
    .select("room");

  if (error) {
    console.error("saveRoom update error:", error);
    throw error;
  }

  // If no row updated, insert a new one
  if (!data || data.length === 0) {
    const { error: e2 } = await supabase
      .from(TABLE)
      .insert([{ room, payload: tagged, updated_at }]);

    if (e2) {
      console.error("saveRoom insert error:", e2);
      throw e2;
    }
  }
}

/**
 * Fetch the current payload for a room (or null if none).
 */
export async function fetchRoom(room) {
  if (!room) return null;
  const { data, error } = await supabase
    .from(TABLE)
    .select("payload")
    .eq("room", room)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    console.error("fetchRoom error:", error);
    throw error;
  }

  return data?.payload ?? null;
}

/**
 * Subscribe to realtime changes for a room. Returns an unsubscribe fn.
 * cb gets called with the latest payload on every change.
 */
export function subscribeRoom(room, cb) {
  if (!room) return () => {};

  const channel = supabase.channel(`room:${room}`);

  channel.on(
    "postgres_changes",
    { event: "*", schema: "public", table: TABLE, filter: `room=eq.${room}` },
    (msg) => {
      try {
        const latest = msg.new?.payload;
        // Ignore our own updates
        if (latest?.clientId === clientId) return;
        if (latest !== undefined) cb(latest);
      } catch (e) {
        console.error("subscribeRoom handler error:", e);
      }
    }
  );

  channel.subscribe();

  return () => {
    try {
      supabase.removeChannel(channel);
    } catch {}
  };
}


