"use client";
import { useEffect, useState, type FormEvent } from "react";
import { LockKeyhole, Plus, Trash2 } from "lucide-react";
import { Dialog } from "./dialog";
import { api, jsonRequest } from "@/lib/client-api";
import { palette, type Board } from "@/lib/types";
export type Preferences = {
  speakOnTap: boolean;
  rate: number;
  voiceURI: string;
  largeTiles: boolean;
};
export const defaultPreferences: Preferences = {
  speakOnTap: true,
  rate: 0.85,
  voiceURI: "",
  largeTiles: false,
};

export function CaregiverUnlock({
  configured,
  onClose,
  onUnlocked,
}: {
  configured: boolean;
  onClose: () => void;
  onUnlocked: () => void;
}) {
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!configured && pin !== confirm) {
      setError("The PINs don't match. Please enter them again.");
      return;
    }
    setBusy(true);
    try {
      await api(
        "/api/caregiver",
        jsonRequest("POST", { action: configured ? "unlock" : "setup", pin }),
      );
      onUnlocked();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Couldn't unlock caregiver mode.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={
        configured
          ? "A little space for caregivers"
          : "Make this board your own"
      }
      description={
        configured
          ? "Enter your PIN to edit tiles, add photos, and adjust the board."
          : "Create a PIN to keep editing controls in caregiver hands. The board is ready to use without one."
      }
      onClose={() => !busy && onClose()}
    >
      <div className="lock-illustration">
        <LockKeyhole size={30} />
      </div>
      <form onSubmit={submit} className="stack">
        <label>
          {configured ? "Caregiver PIN" : "Create a caregiver PIN"}
          <input
            autoFocus
            type="password"
            inputMode="numeric"
            pattern="[0-9]{4,8}"
            minLength={4}
            maxLength={8}
            required
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            autoComplete={configured ? "current-password" : "new-password"}
          />
        </label>
        {!configured && (
          <>
            <label>
              Confirm PIN
              <input
                type="password"
                inputMode="numeric"
                pattern="[0-9]{4,8}"
                required
                minLength={4}
                maxLength={8}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
              />
            </label>
            <p className="helper">
              Use 4–8 digits and keep them somewhere safe. This local version
              has no email recovery or family accounts.
            </p>
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary full-width" disabled={busy}>
          {busy
            ? "One moment…"
            : configured
              ? "Unlock caregiver mode"
              : "Create PIN & start editing"}
        </button>
      </form>
    </Dialog>
  );
}

export function BoardSettings({
  board,
  preferences,
  onPreferences,
  onBoard,
  onClose,
  notify,
}: {
  board: Board;
  preferences: Preferences;
  onPreferences: (p: Preferences) => void;
  onBoard: (b: Board) => void;
  onClose: () => void;
  notify: (s: string) => void;
}) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(palette[0]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pin, setPin] = useState("");
  const [newPin, setNewPin] = useState("");
  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const update = () => setVoices(window.speechSynthesis.getVoices());
    update();
    window.speechSynthesis.addEventListener("voiceschanged", update);
    return () =>
      window.speechSynthesis.removeEventListener("voiceschanged", update);
  }, []);
  async function mutate(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save changes.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title="Board settings"
      description="Small adjustments for a more comfortable conversation."
      onClose={() => !busy && onClose()}
      wide
    >
      <div className="stack settings">
        <section>
          <h3>Speaking & display</h3>
          <label className="check-label">
            <input
              type="checkbox"
              checked={preferences.speakOnTap}
              onChange={(e) =>
                onPreferences({ ...preferences, speakOnTap: e.target.checked })
              }
            />{" "}
            Speak each word when tapped
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={preferences.largeTiles}
              onChange={(e) =>
                onPreferences({ ...preferences, largeTiles: e.target.checked })
              }
            />{" "}
            Use extra-large tiles
          </label>
          <label>
            Voice
            <select
              value={preferences.voiceURI}
              onChange={(e) =>
                onPreferences({ ...preferences, voiceURI: e.target.value })
              }
            >
              <option value="">Device default</option>
              {voices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name} ({v.lang}){v.localService ? " · on device" : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Speaking speed · {preferences.rate.toFixed(2)}×
            <input
              type="range"
              min="0.5"
              max="1.25"
              step="0.05"
              value={preferences.rate}
              onChange={(e) =>
                onPreferences({ ...preferences, rate: Number(e.target.value) })
              }
            />
          </label>
          <p className="helper">
            These preferences stay in this browser. For offline speech, choose
            an on-device voice and test it with this device disconnected.
          </p>
        </section>
        <section>
          <h3>Categories</h3>
          <div className="category-list">
            {board.categories.map((c) => (
              <div key={c.id}>
                <span className={`color-dot tone-${c.color}`} />
                <span>{c.name}</span>
                <small>
                  {board.tiles.filter((t) => t.categoryId === c.id).length}{" "}
                  tiles
                </small>
                {!board.tiles.some((t) => t.categoryId === c.id) &&
                  board.categories.length > 1 && (
                    <button
                      className="icon-button"
                      disabled={busy}
                      aria-label={`Remove empty category ${c.name}`}
                      onClick={() =>
                        mutate(async () => {
                          onBoard(
                            await api<Board>(
                              "/api/categories",
                              jsonRequest("DELETE", { id: c.id }),
                            ),
                          );
                          notify("Empty category removed.");
                        })
                      }
                    >
                      <Trash2 size={17} />
                    </button>
                  )}
              </div>
            ))}
          </div>
          <p className="helper">
            To remove a category, first move or remove its tiles.
          </p>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              mutate(async () => {
                onBoard(
                  await api<Board>(
                    "/api/categories",
                    jsonRequest("POST", { name, color }),
                  ),
                );
                setName("");
                notify("Category added.");
              });
            }}
          >
            <div className="form-columns">
              <label>
                New category
                <input
                  required
                  maxLength={32}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="For example, My favorite things"
                />
              </label>
              <label>
                Color
                <select
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                >
                  {palette.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
            </div>
            <button className="button secondary" disabled={busy}>
              <Plus size={18} /> Add category
            </button>
          </form>
        </section>
        <section>
          <h3>Change caregiver PIN</h3>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              mutate(async () => {
                await api(
                  "/api/caregiver",
                  jsonRequest("POST", { action: "change", pin, newPin }),
                );
                setPin("");
                setNewPin("");
                notify("Caregiver PIN changed.");
              });
            }}
          >
            <div className="form-columns">
              <label>
                Current PIN
                <input
                  type="password"
                  autoComplete="current-password"
                  inputMode="numeric"
                  pattern="[0-9]{4,8}"
                  required
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                />
              </label>
              <label>
                New PIN
                <input
                  type="password"
                  autoComplete="new-password"
                  inputMode="numeric"
                  minLength={4}
                  maxLength={8}
                  pattern="[0-9]{4,8}"
                  required
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value)}
                />
              </label>
            </div>
            <button className="button secondary" disabled={busy}>
              Update PIN
            </button>
          </form>
        </section>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button
          className="button primary full-width"
          onClick={onClose}
          disabled={busy}
        >
          Done
        </button>
      </div>
    </Dialog>
  );
}
