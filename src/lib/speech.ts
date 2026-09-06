import { recordingFor } from "./recordings";

type Options = {
  rate: number;
  voiceURI: string;
  onDone: () => void;
  onNotice: (message: string) => void;
};

/** A single reusable player keeps taps and sentence playback from overlapping. */
export class BoardSpeaker {
  private audio: HTMLAudioElement | null = null;
  private generation = 0;
  private finishClip: ((played: boolean) => void) | null = null;

  stop() {
    this.generation++;
    this.finishClip?.(false);
    if (this.audio) {
      this.audio.pause();
      this.audio.removeAttribute("src");
      this.audio.load();
    }
    window.speechSynthesis?.cancel();
  }

  async say(phrases: string[], options: Options) {
    this.stop();
    const generation = this.generation;
    const fullText = phrases.join(" ");
    const wholePhrase = recordingFor(fullText);
    const recordings = wholePhrase ? [wholePhrase] : phrases.map(recordingFor);
    if (recordings.some((clip) => !clip)) {
      this.deviceSpeech(
        fullText,
        generation,
        options,
        "This phrase uses your device voice until a recording is added.",
      );
      return;
    }
    // Reuse the element initialized in the user's tap for subsequent sentence clips.
    this.audio ??= new Audio();
    for (const [index, clip] of recordings.entries()) {
      if (this.generation !== generation) return;
      const played = await this.playClip(clip!.src, options.rate);
      if (this.generation !== generation) return;
      if (!played) {
        // Do not repeat already spoken words if a later recording fails.
        const remaining = recordings
          .slice(index)
          .map((item) => item!.text)
          .join(" ");
        this.deviceSpeech(
          remaining,
          generation,
          options,
          "Recording unavailable. Using your device voice for the remaining words.",
        );
        return;
      }
    }
    if (this.generation === generation) options.onDone();
  }

  private playClip(src: string, rate: number): Promise<boolean> {
    const audio = this.audio!;
    return new Promise((resolve) => {
      const finish = (played: boolean) => {
        if (this.finishClip !== finish) return;
        this.finishClip = null;
        audio.onended = null;
        audio.onerror = null;
        resolve(played);
      };
      this.finishClip = finish;
      audio.src = src;
      audio.playbackRate = rate;
      audio.preservesPitch = true;
      audio.onended = () => finish(true);
      audio.onerror = () => finish(false);
      audio.play().catch(() => finish(false));
    });
  }

  private deviceSpeech(
    text: string,
    generation: number,
    options: Options,
    notice: string,
  ) {
    if (!("speechSynthesis" in window)) {
      options.onNotice(
        "Audio isn't available right now. You can still build and show your sentence.",
      );
      options.onDone();
      return;
    }
    options.onNotice(notice);
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = options.rate * 0.9;
    const voice = window.speechSynthesis
      .getVoices()
      .find((v) => v.voiceURI === options.voiceURI);
    utterance.lang = voice?.lang || "en-US";
    if (voice) utterance.voice = voice;
    utterance.onend = () => {
      if (this.generation === generation) options.onDone();
    };
    utterance.onerror = (event) => {
      if (this.generation !== generation) return;
      options.onDone();
      if (!["interrupted", "canceled"].includes(event.error))
        options.onNotice(
          "Couldn't play the device voice. Choose an on-device fallback voice in caregiver settings.",
        );
    };
    window.speechSynthesis.speak(utterance);
  }
}
