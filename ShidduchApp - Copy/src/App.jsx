import React, { useState, useRef, useEffect } from "react";
import Prospects from "./Prospects";
import MyInfo from "./MyInfo";
import AddDropdown from "./AddDropdown";
import SettingsFab from "./SettingsFab";
import SyncPanel from "./SyncPanel";
import { fetchRoom, subscribeToRoom } from "./lib/sync";
import { dbProfile, dbProspects } from "./lib/db";

export default function App() {
  const [tab, setTab] = useState("prospects");
  const [profile, setProfile] = useState(null);
  const [prospects, setProspects] = useState([]);
  const [activeKidId, setActiveKidId] = useState(null);
  const [syncOpen, setSyncOpen] = useState(false);
  const [sync, setSync] = useState(null);

  const importRef = useRef(null);

  // Save profile
  const saveProfile = async (newProfile) => {
    setProfile(newProfile);
    await dbProfile.setItem("me", newProfile);
  };

  // Save prospects
  const saveProspects = async (list) => {
    setProspects(list);
    await dbProspects.setItem("all", list);
  };

  // Load from DB on mount
  useEffect(() => {
    (async () => {
      const me = await dbProfile.getItem("me");
      const list = (await dbProspects.getItem("all")) || [];
      setProfile(me);
      setProspects(list);
    })();
  }, []);

  // Sync: load cloud data on start
  useEffect(() => {
    (async () => {
      if (!sync?.room) return;
      const cloud = await fetchRoom(sync.room);
      if (!cloud) return;
      if (cloud.profile) setProfile(cloud.profile);
      if (Array.isArray(cloud.prospects)) setProspects(cloud.prospects);
    })();
  }, [sync?.room]);

  // Sync: realtime updates
  useEffect(() => {
    if (!sync?.room) return;
    const unsub = subscribeToRoom(sync.room, (cloud) => {
      if (cloud.profile) setProfile(cloud.profile);
      if (Array.isArray(cloud.prospects)) setProspects(cloud.prospects);
    });
    return () => unsub && unsub();
  }, [sync?.room]);

  // Export
  const exportAll = async () => {
    const prof = await dbProfile.getItem("me");
    const list = (await dbProspects.getItem("all")) || [];
    const data = JSON.stringify({ profile: prof, prospects: list }, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "backup.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  // Import
  const importAll = async (file) => {
    const text = await file.text();
    const data = JSON.parse(text);
    if (data.profile) await saveProfile(data.profile);
    if (data.prospects) await saveProspects(data.prospects);
  };

  // Save sync settings
  const saveSync = async (s) => {
    setSync(s);
    await dbProfile.setItem("sync", s);
  };

  // Clear sync
  const clearSync = async () => {
    setSync(null);
    await dbProfile.removeItem("sync");
  };

  return (
    <div className="p-4 max-w-4xl mx-auto text-sm">
      <h1 className="text-xl font-semibold mb-3">
        Shidduch Organizer • v1.5 (Lite)
      </h1>

      <div className="flex gap-2 mb-4 items-center">
        <button
          className={`px-3 py-1 rounded border ${
            tab === "prospects" ? "bg-black text-white" : "bg-white"
          }`}
          onClick={() => setTab("prospects")}
        >
          Resumes
        </button>
        <AddDropdown />
        <div className="ml-auto flex gap-2 items-center">
          <button
            className={`px-3 py-1 rounded border ${
              tab === "profile" ? "bg-black text-white" : "bg-white"
            }`}
            onClick={() => setTab("profile")}
          >
            My Info
          </button>
          <input
            ref={importRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importAll(f);
            }}
          />
        </div>
      </div>

      <SettingsFab
        onExport={exportAll}
        onImport={() => importRef.current?.click()}
        onOpenSync={() => setSyncOpen(true)}
      />

      <SyncPanel
        open={syncOpen}
        initial={sync}
        onSave={saveSync}
        onClear={clearSync}
        onClose={() => setSyncOpen(false)}
      />

      {tab === "prospects" ? (
        <Prospects
          profile={profile}
          saveProfile={saveProfile}
          prospects={prospects}
          setProspects={saveProspects}
          activeKidId={activeKidId}
          setActiveKidId={setActiveKidId}
        />
      ) : (
        <MyInfo profile={profile} saveProfile={saveProfile} />
      )}
    </div>
  );
}
