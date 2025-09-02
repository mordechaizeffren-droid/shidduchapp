// src/lib/sync.ts
import { supa } from "./supa";

// Table name in Supabase
const TABLE = "rooms";

// The shape of what we store in the "payload" column
type RoomPayload = {
  profile?: any;
  prospects?: any[];
};

// ----------------------
// Fetch the current room data
// ----------------------
export async function fetchRoom(room: string): Promise<RoomPayload | null> {
  if (!room) return null;

  const { data, error } = await supa
    .from(TABLE)
    .select("payload")
    .eq("id", room)
    .single();

  if (error) {
    console.error("fetchRoom error:", error.message);
    return null;
  }
  return data?.payload || null;
}

// ----------------------
// Save / upsert data
// ----------------------
export async function saveRoom(room: string, payload: RoomPayload) {
  if (!room) return;

  const { error } = await supa.from(TABLE).upsert(
    {
      id: room,
      payload,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );

  if (error) {
    console.error("saveRoom error:", error.message);
  }
}

// ----------------------
// Subscribe to realtime updates
// ----------------------
export function subscribeRoom(room: string, onUpdate: (payload: RoomPayload) => void) {
  if (!room) return null;

  const channel = supa
    .channel("room-sync")
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: TABLE,
        filter: `id=eq.${room}`,
      },
      (payload) => {
        const newPayload = (payload.new as any)?.payload;
        if (newPayload) {
          onUpdate(newPayload);
        }
      }
    )
    .subscribe();

  return channel;
}


