"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  CloudCheck,
  Download,
  Heart,
  LockKeyhole,
  MessageCircle,
  Pencil,
  Plus,
  Settings2,
  ShieldCheck,
  Star,
  Undo2,
  Volume2,
  WifiOff,
  X,
} from "lucide-react";
import { api } from "@/lib/client-api";
import { loadSavedBoard, prepareOffline } from "@/lib/offline";
import { tileImage, type Board, type Tile } from "@/lib/types";
import {
  BoardSettings,
  CaregiverUnlock,
  defaultPreferences,
  type Preferences,
} from "./caregiver";
import { TileEditor } from "./tile-editor";
import { CategoryIcon } from "./category-icon";
import { BoardSpeaker } from "@/lib/speech";

export function CommunicationBoard() {
  const [board, setBoard] = useState<Board | null>(null);
  const [active, setActive] = useState("1");
  const [queue, setQueue] = useState<Tile[]>([]);
  const [unlocked, setUnlocked] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [offline, setOffline] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  const [savingOffline, setSavingOffline] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState<"unlock" | "settings" | "tile" | null>(
    null,
  );
  const [editing, setEditing] = useState<Tile | null>(null);
  const [preferences, setPreferences] = useState(defaultPreferences);
  const [spoken, setSpoken] = useState<string | null>(null);
  const speaker = useRef<BoardSpeaker | null>(null);
  useEffect(() => () => speaker.current?.stop(), []);
  const boardRef = useRef<Board | null>(null);
  const persistChain = useRef<Promise<void>>(Promise.resolve());
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(""), 6000);
  }, []);
  const acceptBoard = useCallback(
    (next: Board) => {
      boardRef.current = next;
      setBoard(next);
      setError("");
      setActive((current) =>
        current === "favorites" || next.categories.some((c) => c.id === current)
          ? current
          : next.categories[0]?.id || "favorites",
      );
      setOfflineReady(false);
      setSavingOffline(true);
      // Serialize snapshots so a slow earlier download cannot overwrite a newer edit.
      persistChain.current = persistChain.current
        .catch(() => {})
        .then(async () => {
          try {
            const ready = await prepareOffline(next);
            if (boardRef.current === next) setOfflineReady(ready);
          } catch {
            if (boardRef.current === next)
              notify(
                "Board saved on the server. Offline download is incomplete; reconnect and retry.",
              );
          } finally {
            if (boardRef.current === next) setSavingOffline(false);
          }
        });
    },
    [notify],
  );
  const refresh = useCallback(async () => {
    try {
      const next = await api<Board>("/api/board");
      setOffline(false);
      acceptBoard(next);
      const status = await api<{ configured: boolean; unlocked: boolean }>(
        "/api/caregiver",
      );
      setConfigured(status.configured);
      setUnlocked(status.unlocked);
    } catch {
      setUnlocked(false);
      if (boardRef.current) {
        setOffline(true);
        setError("");
      } else
        setError(
          "Your board couldn't be loaded. Start the local server or reconnect, then try again.",
        );
    }
  }, [acceptBoard]);
  useEffect(() => {
    let cancelled = false;
    async function start() {
      try {
        const saved = await loadSavedBoard();
        if (saved && !cancelled && !boardRef.current) {
          boardRef.current = saved;
          setBoard(saved);
          setActive(
            saved.categories.some((c) => c.id === "1")
              ? "1"
              : saved.categories[0]?.id || "favorites",
          );
        }
        const stored = localStorage.getItem("connectus-preferences");
        if (stored) {
          const p = JSON.parse(stored);
          setPreferences({
            speakOnTap: typeof p.speakOnTap === "boolean" ? p.speakOnTap : true,
            largeTiles: p.largeTiles === true,
            rate:
              typeof p.rate === "number" && p.rate >= 0.5 && p.rate <= 1.25
                ? p.rate
                : defaultPreferences.rate,
            voiceURI: typeof p.voiceURI === "string" ? p.voiceURI : "",
          });
        }
      } catch {
        /* The live board still works if browser storage is unavailable. */
      }
      if (!cancelled) await refresh();
    }
    start();
    const disconnected = () => {
      setOffline(true);
      setUnlocked(false);
      setDialog(null);
    };
    const connected = () => {
      refresh();
    };
    window.addEventListener("offline", disconnected);
    window.addEventListener("online", connected);
    return () => {
      cancelled = true;
      window.removeEventListener("offline", disconnected);
      window.removeEventListener("online", connected);
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    };
  }, [refresh]);
  useEffect(() => {
    if (!offline) return;
    // A local server can return without the OS ever emitting an online event.
    const timer = setInterval(() => {
      if (navigator.onLine) refresh();
    }, 4000);
    return () => clearInterval(timer);
  }, [offline, refresh]);
  // Match the server's one-hour session lifetime without leaving stale editing controls visible.
  useEffect(() => {
    if (!unlocked) return;
    const timer = setInterval(async () => {
      try {
        const state = await api<{ unlocked: boolean }>("/api/caregiver");
        if (!state.unlocked) {
          setUnlocked(false);
          setDialog(null);
          notify("Caregiver session ended. Unlock again to edit.");
        }
      } catch {
        /* Mutations also enforce authorization on the server. */
      }
    }, 60000);
    return () => clearInterval(timer);
  }, [unlocked, notify]);
  function speak(phrases: string[], tileId?: string) {
    speaker.current ??= new BoardSpeaker();
    setSpoken(tileId || "sentence");
    void speaker.current.say(phrases, {
      rate: preferences.rate,
      voiceURI: preferences.voiceURI,
      onDone: () => setSpoken(null),
      onNotice: notify,
    });
  }
  function tap(tile: Tile) {
    if (queue.length >= 30) {
      notify("Your sentence is full. Speak it or clear it to start again.");
      return;
    }
    setQueue((current) => [...current, tile]);
    if (preferences.speakOnTap) speak([tile.text], tile.id);
  }
  async function lock() {
    try {
      await api("/api/caregiver", { method: "DELETE" });
      setUnlocked(false);
      setDialog(null);
      notify("Caregiver mode locked. Ready to communicate.");
    } catch {
      notify("Couldn't lock the session. Check the connection and try again.");
    }
  }
  function updatePreferences(next: Preferences) {
    setPreferences(next);
    try {
      localStorage.setItem("connectus-preferences", JSON.stringify(next));
    } catch {
      notify("Preferences work now, but couldn't be saved in this browser.");
    }
  }
  async function downloadOffline() {
    if (!board) return;
    setSavingOffline(true);
    try {
      const ready = await prepareOffline(board);
      setOfflineReady(ready);
      notify(
        ready
          ? "Board and pictures are saved for offline use on this device."
          : "Board saved. Full offline support is available when running the production build.",
      );
    } catch {
      notify(
        "Some pictures couldn't be downloaded. Check your connection and try again.",
      );
    } finally {
      setSavingOffline(false);
    }
  }
  const category = board?.categories.find((c) => c.id === active);
  const tiles =
    board?.tiles.filter((t) =>
      active === "favorites" ? t.isFavorite : t.categoryId === active,
    ) || [];
  return (
    <div className="app-shell">
      <a href="#board" className="skip-link">
        Skip to communication board
      </a>
      <header className="app-header">
        <a href="/" className="brand" aria-label="Connectus home">
          <img src="/icon.svg" alt="" width="43" height="43" />
          <span>
            connectus<span className="brand-dot">.</span>
          </span>
        </a>
        <span className="brand-tagline">Your words, your way.</span>
        <div className="header-actions">
          <span className={`connection ${offline ? "is-offline" : ""}`}>
            {offline ? <WifiOff size={15} /> : <span className="status-dot" />}
            <span>{offline ? "Using saved board" : "Local board"}</span>
          </span>
          <button
            className={`button caregiver-button ${unlocked ? "is-unlocked" : ""}`}
            disabled={!board || offline || configured === null}
            onClick={() => (unlocked ? lock() : setDialog("unlock"))}
          >
            {unlocked ? <ShieldCheck size={18} /> : <LockKeyhole size={18} />}
            <span>{unlocked ? "Finish editing" : "Caregiver mode"}</span>
          </button>
        </div>
      </header>
      {unlocked && (
        <div className="caregiver-banner">
          <span>
            <ShieldCheck size={18} />
            <strong>Caregiver mode</strong>
            <span className="banner-hint">Make this space feel familiar.</span>
          </span>
          <button className="text-button" onClick={() => setDialog("settings")}>
            <Settings2 size={17} /> Board settings <ChevronRight size={16} />
          </button>
        </div>
      )}
      <main className="main-layout">
        <section className="sentence-section" aria-label="Sentence builder">
          <div className="section-eyebrow">
            <MessageCircle size={16} /> MY WORDS
          </div>
          <div className="sentence-panel">
            <div
              className={`sentence-words ${queue.length ? "has-words" : ""}`}
              aria-live="polite"
              aria-label="Your sentence"
            >
              {queue.length ? (
                queue.map((tile, i) => (
                  <button
                    className="sentence-word"
                    key={`${tile.id}-${i}`}
                    aria-label={`Remove ${tile.text} at position ${i + 1}`}
                    onClick={() =>
                      setQueue((q) => q.filter((_, index) => index !== i))
                    }
                  >
                    <img src={tileImage(tile)} alt="" />
                    <span>{tile.text}</span>
                    <X size={12} />
                  </button>
                ))
              ) : (
                <div className="sentence-placeholder">
                  <span className="placeholder-bubble">
                    <MessageCircle size={25} strokeWidth={1.5} />
                  </span>
                  <div>
                    <strong>What would you like to say?</strong>
                    <span>Tap pictures below to build your sentence.</span>
                  </div>
                </div>
              )}
            </div>
            <button
              className={`button speak-button ${spoken === "sentence" ? "speaking" : ""}`}
              disabled={!queue.length}
              onClick={() => speak(queue.map((t) => t.text))}
            >
              <Volume2 size={24} /> Speak
              <span className="speak-detail">my words</span>
            </button>
          </div>
          <div className="sentence-tools">
            <span>
              <span className="little-dot" />
              {preferences.speakOnTap
                ? "Each picture speaks when you tap it"
                : "Build your sentence, then press Speak"}
            </span>
            <div>
              <button
                className="text-button"
                disabled={!queue.length}
                onClick={() => setQueue((q) => q.slice(0, -1))}
              >
                <Undo2 size={16} /> Undo
              </button>
              <span className="tool-divider" />
              <button
                className="text-button"
                disabled={!queue.length}
                onClick={() => {
                  setQueue([]);
                  speaker.current?.stop();
                  setSpoken(null);
                }}
              >
                <X size={16} /> Clear
              </button>
            </div>
          </div>
        </section>
        <div className="board-layout">
          <aside className="category-sidebar">
            <div className="section-eyebrow">EXPLORE WORDS</div>
            <nav aria-label="Word categories">
              <button
                className={`category-button favorites ${active === "favorites" ? "selected" : ""}`}
                aria-pressed={active === "favorites"}
                onClick={() => setActive("favorites")}
              >
                <Star size={19} />
                <span>Favorites</span>
                <ChevronRight size={16} />
              </button>
              <div className="nav-divider" />
              {board?.categories.map((c) => (
                <button
                  className={`category-button ${active === c.id ? "selected" : ""}`}
                  key={c.id}
                  aria-pressed={active === c.id}
                  onClick={() => setActive(c.id)}
                >
                  <span className={`category-mark tone-${c.color}`}>
                    <CategoryIcon categoryId={c.id} />
                  </span>
                  <span>{c.name}</span>
                  {active === c.id && <ChevronRight size={16} />}
                </button>
              ))}
            </nav>
            <div className="sidebar-note">
              <Heart size={21} strokeWidth={1.6} />
              <p>
                Every way of communicating
                <br />
                is worth listening to.
              </p>
            </div>
          </aside>
          <section className="board-content" id="board" tabIndex={-1}>
            <div className="board-heading">
              <div>
                <div className="section-eyebrow">LET’S TALK</div>
                <h1>
                  {active === "favorites"
                    ? "Favorite words"
                    : category?.name || "Your communication board"}
                </h1>
                <p>
                  {unlocked
                    ? "Use the pencil to edit a tile, or add something new."
                    : active === "1"
                      ? "Little words. So much to say."
                      : active === "favorites"
                        ? "Familiar words, close at hand."
                        : "Find the words that feel right."}
                </p>
              </div>
              {unlocked ? (
                <button
                  className="button primary"
                  onClick={() => {
                    setEditing(null);
                    setDialog("tile");
                  }}
                >
                  <Plus size={19} /> Add tile
                </button>
              ) : (
                <span className="tile-count">{tiles.length} pictures</span>
              )}
            </div>
            {offline && (
              <div className="offline-banner">
                <WifiOff size={19} />
                <span>
                  You’re using the last saved board. Reconnect to edit or get
                  updates.
                </span>
                <button className="text-button" onClick={refresh}>
                  Retry connection
                </button>
              </div>
            )}
            {error ? (
              <div className="empty-state">
                <p role="alert">{error}</p>
                <button className="button primary" onClick={refresh}>
                  Try again
                </button>
              </div>
            ) : !board ? (
              <div
                className="tile-grid"
                aria-label="Loading board"
                aria-busy="true"
              >
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="tile-skeleton" />
                ))}
              </div>
            ) : tiles.length ? (
              <div
                className={`tile-grid ${preferences.largeTiles ? "large-tiles" : ""}`}
              >
                {tiles.map((tile) => (
                  <div
                    key={tile.id}
                    className={`tile-wrap tone-${board.categories.find((c) => c.id === tile.categoryId)?.color || "blue"} ${spoken === tile.id ? "tile-speaking" : ""}`}
                  >
                    <button
                      className="word-tile"
                      onClick={() => tap(tile)}
                      aria-label={`Say ${tile.text}`}
                    >
                      <span className="tile-picture">
                        <img src={tileImage(tile)} alt="" draggable={false} />
                      </span>
                      <span className="tile-label">{tile.text}</span>
                      {tile.isFavorite && (
                        <Star
                          className="favorite-star"
                          size={13}
                          fill="currentColor"
                          aria-label="Favorite"
                        />
                      )}
                    </button>
                    {unlocked && (
                      <button
                        className="tile-edit"
                        aria-label={`Edit ${tile.text}`}
                        onClick={() => {
                          setEditing(tile);
                          setDialog("tile");
                        }}
                      >
                        <Pencil size={16} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <Star size={32} />
                <h2>
                  {active === "favorites"
                    ? "Keep their favorite words close"
                    : "A little room for new words"}
                </h2>
                <p>
                  {active === "favorites"
                    ? "In caregiver mode, edit a tile and include it in favorites."
                    : "Add a tile in caregiver mode to begin this category."}
                </p>
              </div>
            )}
            <div className="board-footnote">
              <span>
                <Check size={15} /> No right or wrong way to start.
              </span>
              <button
                className="text-button"
                onClick={() =>
                  document.querySelector(".sentence-section")?.scrollIntoView({
                    behavior: window.matchMedia(
                      "(prefers-reduced-motion: reduce)",
                    ).matches
                      ? "instant"
                      : "smooth",
                  })
                }
              >
                <ArrowLeft size={15} className="up-arrow" /> Back to my words
              </button>
            </div>
          </section>
        </div>
      </main>
      <footer className="app-footer">
        <div>
          <span className="footer-brand">connectus.</span>
          <span>A little connection goes a long way.</span>
        </div>
        <button
          className="text-button offline-status"
          disabled={!board || savingOffline || offline}
          onClick={downloadOffline}
        >
          {offlineReady ? <CloudCheck size={16} /> : <Download size={16} />}
          {savingOffline
            ? "Saving for offline…"
            : offlineReady
              ? "Saved for offline"
              : offline
                ? "Saved board available"
                : "Save for offline"}
        </button>
        <p>
          Symbols by{" "}
          <a href="https://arasaac.org" target="_blank" rel="noreferrer">
            ARASAAC
          </a>{" "}
          · Sergio Palao / Government of Aragón ·{" "}
          <a
            href="https://creativecommons.org/licenses/by-nc-sa/4.0/"
            target="_blank"
            rel="noreferrer"
          >
            CC BY-NC-SA 4.0
          </a>
          . Custom photos belong to their owners.
        </p>
      </footer>
      <div className={`toast ${notice ? "visible" : ""}`} role="status">
        {notice}
      </div>
      {dialog === "unlock" && configured !== null && (
        <CaregiverUnlock
          configured={configured}
          onClose={() => setDialog(null)}
          onUnlocked={() => {
            setConfigured(true);
            setUnlocked(true);
            setDialog(null);
            notify(
              "Caregiver mode unlocked. Your changes will be saved automatically after you submit them.",
            );
          }}
        />
      )}
      {dialog === "tile" && board && unlocked && (
        <TileEditor
          board={board}
          tile={editing}
          categoryId={category?.id || board.categories[0].id}
          onClose={() => setDialog(null)}
          onSaved={(next, message) => {
            acceptBoard(next);
            setDialog(null);
            notify(message);
          }}
        />
      )}
      {dialog === "settings" && board && unlocked && (
        <BoardSettings
          board={board}
          preferences={preferences}
          onPreferences={updatePreferences}
          onBoard={acceptBoard}
          notify={notify}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
