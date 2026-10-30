// Voice I/O on the browser's Web Speech API:
//   SpeechRecognition  -> retailer's speech to text (Chrome/Edge; needs localhost or HTTPS)
//   speechSynthesis    -> agent's reply to speech
// All browser quirks are handled here so app.js only sees simple callbacks.

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

// Errors after which the mic cannot work this session.
const FATAL_ERRORS = {
  'not-allowed': 'Microphone permission was denied. Allow it in the address bar to talk, or keep typing.',
  'service-not-allowed': 'Speech recognition is blocked in this browser. You can keep typing.',
  'audio-capture': 'No microphone was found. You can keep typing.',
};

/** Make reply text pleasant to hear: no markdown, and "₹121" read as "121 rupees". */
export function toSpeech(text) {
  return String(text)
    .replace(/[*_`#>~]+/g, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/₹\s?([\d,]+(?:\.\d+)?)/g, '$1 rupees')
    .replace(/\s+/g, ' ')
    .trim();
}

// Chrome cuts off long utterances after ~15 s, so speak sentence by sentence.
// Split only on ". " style boundaries so "12.75" stays one number.
const sentences = (text) => text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);

export function createVoice({ lang = 'en-IN', onInterim, onFinal, onEnd, onError }) {
  const synth = window.speechSynthesis;
  const support = {
    recognition: Boolean(Recognition) && window.isSecureContext,
    synthesis: Boolean(synth),
    reason: !Recognition
      ? "This browser doesn't support speech recognition. Use Chrome or Edge for voice, or type below."
      : !window.isSecureContext
        ? 'Voice needs a secure page. Open the app on http://localhost or HTTPS, or type below.'
        : null,
  };

  // ---- text to speech ----

  // Voices load asynchronously in Chrome; pick again whenever the list changes.
  let voice = null;
  const pickVoice = () => {
    const voices = synth?.getVoices() || [];
    const isLang = (v, code) => v.lang.replace('_', '-').startsWith(code);
    voice =
      voices.find((v) => isLang(v, 'en-IN') && /google/i.test(v.name)) ||
      voices.find((v) => isLang(v, 'en-IN')) ||
      voices.find((v) => isLang(v, 'en-GB')) ||
      voices.find((v) => isLang(v, 'en')) ||
      null;
  };
  if (synth) {
    pickVoice();
    synth.addEventListener?.('voiceschanged', pickVoice);
  }

  let current = null; // { resolve, utterances, watchdog } for the reply being spoken

  function finishSpeaking(finished) {
    if (!current) return;
    const { resolve, watchdog } = current;
    current = null;
    clearInterval(watchdog);
    resolve(finished);
  }

  /** Speak text. Resolves true when finished, false if interrupted. */
  function speak(text) {
    stopSpeaking();
    const chunks = sentences(toSpeech(text));
    if (!synth || !chunks.length) return Promise.resolve(true);

    return new Promise((resolve) => {
      // Keep utterance references: Chrome can garbage-collect them and skip "end".
      const utterances = chunks.map((chunk, i) => {
        const u = new SpeechSynthesisUtterance(chunk);
        u.lang = lang;
        if (voice) u.voice = voice;
        if (i === chunks.length - 1) {
          u.onend = () => finishSpeaking(true);
          u.onerror = () => finishSpeaking(true);
        }
        return u;
      });
      // Watchdog: if Chrome never fires "end", notice that the queue went quiet.
      let idleTicks = 0;
      const watchdog = setInterval(() => {
        idleTicks = synth.speaking || synth.pending ? 0 : idleTicks + 1;
        if (idleTicks >= 3) finishSpeaking(true);
      }, 500);
      current = { resolve, utterances, watchdog };
      utterances.forEach((u) => synth.speak(u));
    });
  }

  function stopSpeaking() {
    finishSpeaking(false);
    synth?.cancel();
  }

  // Browsers only allow speech after a user gesture. Call this inside a click
  // handler (e.g. "Start conversation") before the first real reply arrives.
  function unlock() {
    if (!synth) return;
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    synth.speak(u);
  }

  // ---- speech to text ----

  let recognizer = null;

  function listen() {
    if (!support.recognition || recognizer) return;
    // A fresh recognizer per turn is more reliable in Chrome than reusing one.
    const rec = new Recognition();
    rec.lang = lang;
    rec.interimResults = true;
    rec.continuous = false; // ends by itself after a pause in speech
    rec.maxAlternatives = 1;
    let finalText = '';
    let fatal = false;

    rec.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) finalText += result[0].transcript;
        else interim += result[0].transcript;
      }
      onInterim?.(finalText + interim);
    };
    rec.onerror = (event) => {
      if (FATAL_ERRORS[event.error]) {
        fatal = true;
        support.recognition = false;
        onError?.(FATAL_ERRORS[event.error], { fatal: true });
      } else if (event.error === 'network') {
        onError?.('Speech recognition needs an internet connection. You can keep typing.', { fatal: false });
      }
      // "no-speech" and "aborted" are normal; onend reports them as heardNothing.
    };
    rec.onend = () => {
      if (recognizer === rec) recognizer = null;
      onInterim?.('');
      if (rec.discarded) return;
      const text = finalText.trim();
      if (text) onFinal?.(text);
      else onEnd?.({ heardNothing: true, fatal });
    };

    recognizer = rec;
    try {
      rec.start();
    } catch (err) {
      recognizer = null;
      onError?.(`Could not start the microphone: ${err.message}`, { fatal: false });
    }
  }

  /** Stop listening; anything already heard is still delivered via onFinal. */
  function stopListening() {
    recognizer?.stop();
  }

  /** Cancel listening and throw away anything heard (e.g. the user typed instead). */
  function abortListening() {
    if (!recognizer) return;
    recognizer.discarded = true;
    recognizer.abort();
    recognizer = null;
  }

  return {
    support,
    speak,
    stopSpeaking,
    unlock,
    listen,
    stopListening,
    abortListening,
    get isListening() {
      return Boolean(recognizer);
    },
  };
}
