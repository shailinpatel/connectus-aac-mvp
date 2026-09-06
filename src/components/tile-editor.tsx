"use client";
import { useEffect, useState, type FormEvent } from "react";
import { ImagePlus, Star, Trash2 } from "lucide-react";
import { Dialog } from "./dialog";
import { api, jsonRequest } from "@/lib/client-api";
import { symbols, tileImage, type Board, type Tile } from "@/lib/types";

export function TileEditor({
  board,
  tile,
  categoryId,
  onClose,
  onSaved,
}: {
  board: Board;
  tile: Tile | null;
  categoryId: string;
  onClose: () => void;
  onSaved: (board: Board, message: string) => void;
}) {
  const [text, setText] = useState(tile?.text || "");
  const [category, setCategory] = useState(tile?.categoryId || categoryId);
  const [symbol, setSymbol] = useState(tile?.symbol || "want");
  const [favorite, setFavorite] = useState(tile?.isFavorite || false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [removePhoto, setRemovePhoto] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const picture =
    preview ||
    tileImage({ symbol, photoId: !removePhoto ? tile?.photoId || null : null });
  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const form = new FormData();
      form.set(
        "data",
        JSON.stringify({
          id: tile?.id,
          text,
          categoryId: category,
          symbol,
          isFavorite: favorite,
          removePhoto,
        }),
      );
      if (file) form.set("photo", file);
      onSaved(
        await api<Board>("/api/tiles", {
          method: tile ? "PATCH" : "POST",
          body: form,
        }),
        tile ? "Tile updated." : "New tile added.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save this tile.");
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    setError("");
    try {
      onSaved(
        await api<Board>("/api/tiles", jsonRequest("DELETE", { id: tile!.id })),
        "Tile removed.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't remove this tile.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={tile ? "Edit tile" : "Add a tile"}
      description="Familiar words and pictures make this board their own."
      onClose={() => !busy && onClose()}
      wide
    >
      <form onSubmit={save}>
        <fieldset disabled={busy} className="editor-fields">
          <div className="editor-preview">
            <div className="preview-tile">
              <img src={picture} alt="Tile preview" />
              <strong>{text || "Your words here"}</strong>
            </div>
            <div className="photo-controls">
              <label className="button secondary upload-button">
                <ImagePlus size={19} /> Upload a photo
                <input
                  aria-label="Upload a custom photo"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => {
                    const chosen = e.target.files?.[0];
                    setError("");
                    if (chosen && chosen.size > 5 * 1024 * 1024) {
                      setError("Choose a photo smaller than 5 MB.");
                      e.target.value = "";
                      return;
                    }
                    if (chosen) {
                      setFile(chosen);
                      setRemovePhoto(false);
                      e.target.value = "";
                    }
                  }}
                />
              </label>
              <p>
                JPG, PNG, or WebP · up to 5 MB
                <br />
                Photos are resized and location data is removed.
              </p>
              {(file || (tile?.photoId && !removePhoto)) && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setFile(null);
                    setRemovePhoto(true);
                  }}
                >
                  Use a symbol instead
                </button>
              )}
            </div>
          </div>
          <label>
            Word or phrase
            <input
              autoFocus
              required
              maxLength={120}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="For example, I want my teddy"
            />
          </label>
          <div className="form-columns">
            <label>
              Category
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                {board.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Picture symbol
              <select
                value={symbol}
                onChange={(e) => {
                  setSymbol(e.target.value);
                  setRemovePhoto(true);
                  setFile(null);
                }}
              >
                {[...symbols, "again", "look", "wash", "it"].map((s) => (
                  <option key={s} value={s}>
                    {s.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="check-label">
            <input
              type="checkbox"
              checked={favorite}
              onChange={(e) => setFavorite(e.target.checked)}
            />
            <Star size={19} /> Include in favorites
          </label>
        </fieldset>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {deleting ? (
          <div className="delete-confirm">
            <p>
              Remove “{tile?.text}” from the board? This also removes its custom
              photo.
            </p>
            <div className="button-row">
              <button
                type="button"
                className="button danger"
                disabled={busy}
                onClick={remove}
              >
                Remove tile
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => setDeleting(false)}
              >
                Keep tile
              </button>
            </div>
          </div>
        ) : (
          <div className="dialog-actions">
            {tile && (
              <button
                type="button"
                className="icon-button danger-text"
                disabled={busy}
                aria-label="Delete tile"
                onClick={() => setDeleting(true)}
              >
                <Trash2 size={20} />
              </button>
            )}
            <span className="spacer" />
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </button>
            <button className="button primary" disabled={busy}>
              {busy ? "Saving…" : "Save tile"}
            </button>
          </div>
        )}
      </form>
    </Dialog>
  );
}
