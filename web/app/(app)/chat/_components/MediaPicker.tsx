"use client";

import { useEffect, useState, useRef } from "react";
import { ImagePlus, Loader2, UploadCloud } from "lucide-react";

type Asset = {
  id: string;
  cloudinary_url: string;
  resource_type: string;
};

export function MediaPicker({
  variantId,
  jobId,
}: {
  variantId: string;
  jobId?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [available, setAvailable] = useState<Asset[]>([]);
  const [selected, setSelected] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Debounce save timer
  const saveTimer = useRef<NodeJS.Timeout | null>(null);

  // Clear pending debounce on unmount so a stale fetch never fires.
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  // Load selection first
  useEffect(() => {
    fetch(`/api/posts/${variantId}/media`)
      .then((r) => r.json())
      .then((data) => {
        if (data.assets) setSelected(data.assets);
      })
      .catch(console.error);
  }, [variantId]);

  // Load available only when opened, or immediately? 
  // Let's load when opened to save network.
  useEffect(() => {
    if (!isOpen || !jobId) return;
    // Showing a spinner before fetch is the intended UX; the React Compiler
    // rule treats this as a cascading-render risk but in practice it's one
    // extra render when the picker opens, which is negligible.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional loading flag before fetch
    setLoading(true);
    setError("");
    fetch(`/api/media?job_id=${jobId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.assets) {
          // Exclude already selected from "available" if we wanted, 
          // but we can just show all and highlight selected.
          setAvailable(data.assets);
        }
      })
      .catch(() => setError("Failed to load available media"))
      .finally(() => setLoading(false));
  }, [isOpen, jobId]);

  function saveSelection(newSelection: Asset[]) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      fetch(`/api/posts/${variantId}/media`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          media_asset_ids: newSelection.map((a) => a.id),
        }),
      }).catch(console.error);
    }, 500);
  }

  function toggleSelect(asset: Asset) {
    const isSelected = selected.find((a) => a.id === asset.id);
    let next: Asset[];
    if (isSelected) {
      next = selected.filter((a) => a.id !== asset.id);
    } else {
      if (selected.length >= 4) return;
      next = [...selected, asset];
    }
    setSelected(next);
    saveSelection(next);
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      setError("File exceeds 10MB limit.");
      return;
    }

    setUploading(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/media/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to upload");
        return;
      }
      
      const newAsset = data.asset;
      setAvailable((prev) => [newAsset, ...prev]);
      
      if (selected.length < 4) {
        const next = [...selected, newAsset];
        setSelected(next);
        saveSelection(next);
      }
    } catch {
      setError("Network error during upload.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const selectedCount = selected.length;

  return (
    <div className="border-t border-border bg-white/[0.03]">
      <div className="flex items-center justify-between px-5 py-2.5">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground transition hover:text-accent"
        >
          <ImagePlus className="h-4 w-4" />
          {selectedCount > 0
            ? `${selectedCount}/4 images selected`
            : "Attach Media"}
        </button>
      </div>

      {isOpen && (
        <div className="border-t border-border p-5">
          {error && <p className="mb-3 text-xs text-destructive">{error}</p>}

          <div className="flex flex-wrap gap-3">
            {/* Upload Button */}
            <label className="flex h-24 w-24 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface transition hover:border-accent/50 hover:bg-surface-2">
              {uploading ? (
                <Loader2 className="h-5 w-5 animate-spin text-faint-foreground" />
              ) : (
                <>
                  <UploadCloud className="mb-1 h-5 w-5 text-faint-foreground" />
                  <span className="text-[10px] font-medium text-muted-foreground">
                    Upload
                  </span>
                </>
              )}
              <input
                type="file"
                className="hidden"
                accept="image/jpeg, image/png, image/webp, image/gif"
                onChange={handleFileUpload}
                ref={fileInputRef}
                disabled={uploading}
              />
            </label>

            {loading && available.length === 0 && (
              <div className="flex h-24 w-24 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-faint-foreground" />
              </div>
            )}

            {/* Combine selected + available for display, ensuring no duplicates */}
            {Array.from(new Set([...selected, ...available].map(a => a.id))).map((id) => {
              const asset = [...selected, ...available].find(a => a.id === id)!;
              const isSelected = selected.some((s) => s.id === asset.id);
              const disabled = !isSelected && selectedCount >= 4;

              return (
                <button
                  key={asset.id}
                  onClick={() => toggleSelect(asset)}
                  disabled={disabled}
                  className={`relative h-24 w-24 overflow-hidden rounded-xl border-2 transition ${
                    isSelected
                      ? "border-accent opacity-100"
                      : "border-transparent opacity-80 hover:opacity-100"
                  } ${disabled ? "cursor-not-allowed opacity-40 hover:opacity-40" : ""}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- Cloudinary thumbnails in a modal; not LCP-critical, dynamic sizes */}
                  <img
                    src={asset.cloudinary_url}
                    alt="Thumbnail"
                    className="h-full w-full object-cover"
                  />
                  {isSelected && (
                    <div className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-accent-foreground shadow-sm">
                      <span className="text-[10px] font-bold">✓</span>
                    </div>
                  )}
                </button>
              );
            })}

            {!loading && available.length === 0 && selected.length === 0 && (
              <div className="flex h-24 items-center justify-center px-4">
                <span className="text-xs text-faint-foreground">No media available</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
