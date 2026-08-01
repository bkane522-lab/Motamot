// Contrôleur de dictée vocale — écoute continue contrôlée par l'utilisateur.
//
// Fichier chargé tel quel par index.html (<script src="dictation.js">, sans
// build) ET importé tel quel par les tests Node (module.exports) — c'est le
// MÊME code qui tourne dans le navigateur et sous test, pas une copie.
//
// SpeechRecognition coupe automatiquement après un silence (souvent ~10s
// selon les navigateurs), même avec continuous=true. On compense en
// relançant une nouvelle session tant que l'utilisateur n'a pas explicitement
// demandé l'arrêt — jamais après un refus/erreur fatale, jamais en arrière-plan.
// Aucun enregistrement audio n'est conservé : seul le texte transcrit
// (onTranscript) sort de ce module.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.createDictationController = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const FATAL_RECOGNITION_ERRORS = ['not-allowed', 'service-not-allowed', 'audio-capture'];

  function createDictationController({
    SpeechRecognitionCtor,
    getLang,
    onTranscript,
    onStatus,
    setRecordingUI,
    restartDelayMs = 300,
    setTimeoutFn = typeof setTimeout !== 'undefined' ? setTimeout : null,
    clearTimeoutFn = typeof clearTimeout !== 'undefined' ? clearTimeout : null,
  }) {
    let recognizer = null;
    let isListening = false;
    let userStoppedListening = true;
    let restartTimer = null;

    function createRecognizer() {
      const r = new SpeechRecognitionCtor();
      r.lang = getLang();
      r.interimResults = false;
      r.continuous = true;
      r.maxAlternatives = 1;

      r.onresult = (e) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (!e.results[i].isFinal) continue;
          const transcript = e.results[i][0].transcript.trim();
          if (transcript) onTranscript(transcript);
        }
      };

      r.onerror = (e) => {
        if (FATAL_RECOGNITION_ERRORS.indexOf(e.error) !== -1) {
          userStoppedListening = true;
          if (restartTimer) clearTimeoutFn(restartTimer);
          setRecordingUI(false);
          onStatus(e.error === 'audio-capture' ? 'Aucun micro détecté.' : 'Accès au micro refusé.', 'error');
        }
        // 'no-speech' et erreurs transitoires : onend gère la relance.
      };

      r.onend = () => {
        isListening = false;
        if (userStoppedListening) {
          setRecordingUI(false);
          onStatus('Dictée terminée.', 'ok');
        } else {
          scheduleRestart();
        }
      };

      return r;
    }

    function scheduleRestart() {
      if (restartTimer) clearTimeoutFn(restartTimer);
      restartTimer = setTimeoutFn(() => {
        if (userStoppedListening) return;
        startSession();
      }, restartDelayMs);
    }

    function startSession() {
      recognizer = createRecognizer();
      try {
        recognizer.start();
        isListening = true;
        setRecordingUI(true);
      } catch {
        // start() peut lever si une session est déjà active : on ignore,
        // le cycle onend/onerror de la session en cours reprendra la main.
      }
    }

    function start() {
      userStoppedListening = false;
      onStatus('Écoute en cours… Appuie de nouveau pour arrêter.');
      startSession();
    }

    function stop() {
      userStoppedListening = true;
      if (restartTimer) clearTimeoutFn(restartTimer);
      if (recognizer) {
        try { recognizer.stop(); } catch {}
      }
    }

    function toggle() {
      if (isListening || !userStoppedListening) stop();
      else start();
    }

    function handleVisibilityChange(visibilityState) {
      if (visibilityState === 'hidden' && !userStoppedListening) stop();
    }

    return {
      start,
      stop,
      toggle,
      handleVisibilityChange,
      isListening: () => isListening,
      isUserStopped: () => userStoppedListening,
    };
  }

  return createDictationController;
});
