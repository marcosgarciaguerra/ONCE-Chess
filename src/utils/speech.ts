/**
 * Síntesis de voz en español (es-ES) para anuncios tiflotécnicos.
 */

let preferredVoice: SpeechSynthesisVoice | null = null;

function pickSpanishVoice(): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    return null;
  }

  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return preferredVoice;

  const esEs =
    voices.find((v) => v.lang.toLowerCase() === "es-es") ??
    voices.find((v) => v.lang.toLowerCase().startsWith("es")) ??
    null;

  preferredVoice = esEs;
  return preferredVoice;
}

export function ensureVoicesLoaded(): Promise<SpeechSynthesisVoice[]> {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    return Promise.resolve([]);
  }

  const synth = window.speechSynthesis;
  const existing = synth.getVoices();
  if (existing.length > 0) {
    pickSpanishVoice();
    return Promise.resolve(existing);
  }

  return new Promise((resolve) => {
    const onVoices = () => {
      synth.removeEventListener("voiceschanged", onVoices);
      pickSpanishVoice();
      resolve(synth.getVoices());
    };
    synth.addEventListener("voiceschanged", onVoices);
    // Fallback por si el evento no se dispara
    window.setTimeout(() => {
      synth.removeEventListener("voiceschanged", onVoices);
      pickSpanishVoice();
      resolve(synth.getVoices());
    }, 500);
  });
}

export type SpeakOptions = {
  /** Interrumpe enunciados en curso (por defecto true). */
  interrupt?: boolean;
  rate?: number;
  pitch?: number;
  volume?: number;
};

export function speak(text: string, options: SpeakOptions = {}): void {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    return;
  }

  const {
    interrupt = true,
    rate = 1,
    pitch = 1,
    volume = 1,
  } = options;

  const synth = window.speechSynthesis;
  if (interrupt) {
    synth.cancel();
  }

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "es-ES";
  utterance.rate = rate;
  utterance.pitch = pitch;
  utterance.volume = volume;

  const voice = pickSpanishVoice();
  if (voice) {
    utterance.voice = voice;
  }

  synth.speak(utterance);
}

export function stopSpeaking(): void {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    return;
  }
  window.speechSynthesis.cancel();
}
