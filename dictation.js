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
//
// `onDebugEvent(event, detail)` est un hook optionnel, silencieux par défaut,
// qui expose chaque étape interne (démarrage, erreur exacte remontée par le
// navigateur, fin, relance programmée/déclenchée...) — utilisé par index.html
// pour un panneau de diagnostic visible à l'écran le temps de comprendre un
// comportement instable en usage réel, sans changer la logique elle-même.

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
    onDebugEvent = () => {},
    restartDelayMs = 300,
    setTimeoutFn = typeof setTimeout !== 'undefined' ? setTimeout : null,
    clearTimeoutFn = typeof clearTimeout !== 'undefined' ? clearTimeout : null,
  }) {
    let recognizer = null;
    let isListening = false;
    let userStoppedListening = true;
    let restartTimer = null;
    let sessionCount = 0;

    function createRecognizer() {
      const r = new SpeechRecognitionCtor();
      r.lang = getLang();
      r.interimResults = false;
      r.continuous = true;
      r.maxAlternatives = 1;

      r.onresult = (e) => {
        let finalCount = 0;
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (!e.results[i].isFinal) continue;
          finalCount++;
          const transcript = e.results[i][0].transcript.trim();
          if (transcript) onTranscript(transcript);
        }
        onDebugEvent('result', { resultIndex: e.resultIndex, totalResults: e.results.length, finalCount });
      };

      r.onerror = (e) => {
        const fatal = FATAL_RECOGNITION_ERRORS.indexOf(e.error) !== -1;
        onDebugEvent('error', { code: e.error, message: e.message || '', fatal });
        if (fatal) {
          userStoppedListening = true;
          if (restartTimer) clearTimeoutFn(restartTimer);
          setRecordingUI(false);
          onStatus(e.error === 'audio-capture' ? 'Aucun micro détecté.' : 'Accès au micro refusé.', 'error');
        }
        // 'no-speech' et erreurs transitoires : onend gère la relance.
      };

      r.onend = () => {
        isListening = false;
        onDebugEvent('end', { userStopped: userStoppedListening });
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
      onDebugEvent('restart-scheduled', { delayMs: restartDelayMs });
      restartTimer = setTimeoutFn(() => {
        if (userStoppedListening) return;
        onDebugEvent('restart-fired', {});
        startSession();
      }, restartDelayMs);
    }

    function startSession() {
      sessionCount++;
      recognizer = createRecognizer();
      try {
        recognizer.start();
        isListening = true;
        setRecordingUI(true);
        onDebugEvent('session-start', { sessionCount });
      } catch (e) {
        onDebugEvent('session-start-error', { message: e?.message || String(e) });
        // start() peut lever si une session est déjà active : on ignore,
        // le cycle onend/onerror de la session en cours reprendra la main.
      }
    }

    function start() {
      userStoppedListening = false;
      onDebugEvent('start', {});
      onStatus('Écoute en cours… Appuie de nouveau pour arrêter.');
      startSession();
    }

    function stop() {
      userStoppedListening = true;
      onDebugEvent('stop', {});
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
      if (visibilityState === 'hidden' && !userStoppedListening) {
        onDebugEvent('visibility-stop', {});
        stop();
      }
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
