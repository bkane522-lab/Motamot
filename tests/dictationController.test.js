const test = require('node:test');
const assert = require('node:assert/strict');
const createDictationController = require('../dictation.js');

// Fausse SpeechRecognition : pas de vrai micro/navigateur, juste un objet
// contrôlable manuellement depuis les tests (start/stop comptés, callbacks
// déclenchables à la demande).
function makeFakeRecognitionClass(instances) {
  return class FakeRecognition {
    constructor() {
      this.startCalls = 0;
      this.stopCalls = 0;
      this.onresult = null;
      this.onerror = null;
      this.onend = null;
      instances.push(this);
    }
    start() {
      this.startCalls++;
    }
    stop() {
      this.stopCalls++;
      // Un vrai navigateur déclenche onend après stop() — on simule ça.
      if (this.onend) this.onend();
    }
  };
}

function setup(t, opts = {}) {
  const instances = [];
  const FakeRecognition = makeFakeRecognitionClass(instances);
  const transcripts = [];
  const statuses = [];
  const recordingStates = [];

  t.mock.timers.enable({ apis: ['setTimeout'] });

  const dictation = createDictationController({
    SpeechRecognitionCtor: FakeRecognition,
    getLang: () => 'fr-FR',
    onTranscript: (t) => transcripts.push(t),
    onStatus: (msg, type) => statuses.push({ msg, type }),
    setRecordingUI: (recording) => recordingStates.push(recording),
    restartDelayMs: 300,
    ...opts,
  });

  return { dictation, instances, transcripts, statuses, recordingStates };
}

function finalResultEvent(text) {
  return {
    resultIndex: 0,
    results: [{ isFinal: true, 0: { transcript: text }, length: 1 }],
  };
}

test('relance après fin automatique (browser cut-off, utilisateur n\'a pas arrêté)', (t) => {
  const { dictation, instances } = setup(t);
  dictation.start();
  assert.equal(instances.length, 1);
  assert.equal(instances[0].startCalls, 1);

  instances[0].onend(); // coupure automatique du navigateur, pas un stop() utilisateur

  t.mock.timers.tick(300);
  assert.equal(instances.length, 2, 'une nouvelle session doit être créée après le délai de relance');
  assert.equal(instances[1].startCalls, 1);
});

test('aucune relance après arrêt volontaire de l\'utilisateur', (t) => {
  const { dictation, instances } = setup(t);
  dictation.start();
  dictation.stop(); // déclenche stop() -> onend() en interne (simulé)

  t.mock.timers.tick(1000);
  assert.equal(instances.length, 1, 'aucune nouvelle session ne doit être créée après un arrêt utilisateur');
});

test('aucune relance après une erreur "not-allowed"', (t) => {
  const { dictation, instances, statuses } = setup(t);
  dictation.start();
  instances[0].onerror({ error: 'not-allowed' });
  instances[0].onend();

  t.mock.timers.tick(1000);
  assert.equal(instances.length, 1, 'aucune relance après un refus explicite du micro');
  assert.equal(dictation.isUserStopped(), true);
  assert.ok(statuses.some((s) => s.type === 'error'));
});

test('aucune relance après "service-not-allowed"', (t) => {
  const { dictation, instances } = setup(t);
  dictation.start();
  instances[0].onerror({ error: 'service-not-allowed' });
  instances[0].onend();
  t.mock.timers.tick(1000);
  assert.equal(instances.length, 1, 'pas de relance après service-not-allowed');
});

test('aucune relance après "audio-capture"', (t) => {
  const { dictation, instances } = setup(t);
  dictation.start();
  instances[0].onerror({ error: 'audio-capture' });
  instances[0].onend();
  t.mock.timers.tick(1000);
  assert.equal(instances.length, 1, 'pas de relance après audio-capture');
});

test('relance autorisée après "no-speech" (erreur non fatale)', (t) => {
  const { dictation, instances } = setup(t);
  dictation.start();
  instances[0].onerror({ error: 'no-speech' });
  instances[0].onend(); // le navigateur termine quand même la session après no-speech

  t.mock.timers.tick(300);
  assert.equal(instances.length, 2, 'no-speech ne doit pas empêcher la relance automatique');
});

test('absence de double relance (deux fins rapprochées ne créent pas deux sessions concurrentes)', (t) => {
  const { dictation, instances } = setup(t);
  dictation.start();
  instances[0].onend(); // programme une relance à +300ms

  t.mock.timers.tick(100); // avant que le timer ne se déclenche
  instances[0].onend(); // nouvelle fin : doit réinitialiser le timer, pas en cumuler un second

  t.mock.timers.tick(300);
  assert.equal(instances.length, 2, 'une seule nouvelle session doit être créée, pas deux');
});

test('absence de duplication du texte transcrit pour un même résultat final', (t) => {
  const { dictation, instances, transcripts } = setup(t);
  dictation.start();
  instances[0].onresult(finalResultEvent('bonjour le monde'));
  assert.deepEqual(transcripts, ['bonjour le monde']);
});

test('arrêt propre lorsque la page devient cachée (visibilitychange)', (t) => {
  const { dictation, instances } = setup(t);
  dictation.start();
  dictation.handleVisibilityChange('hidden');

  assert.equal(instances[0].stopCalls, 1);
  assert.equal(dictation.isUserStopped(), true);

  t.mock.timers.tick(1000);
  assert.equal(instances.length, 1, 'pas de relance après une mise en arrière-plan');
});

test('visibilitychange vers "visible" ne déclenche aucun arrêt', (t) => {
  const { dictation, instances } = setup(t);
  dictation.start();
  dictation.handleVisibilityChange('visible');
  assert.equal(instances[0].stopCalls, 0);
});

test('conservation du texte à travers une relance automatique (rien n\'est perdu au redémarrage)', (t) => {
  const { dictation, instances, transcripts } = setup(t);
  dictation.start();
  instances[0].onresult(finalResultEvent('première partie'));

  instances[0].onend(); // coupure auto
  t.mock.timers.tick(300);

  instances[1].onresult(finalResultEvent('deuxième partie'));

  assert.deepEqual(transcripts, ['première partie', 'deuxième partie']);
});

test('toggle() démarre puis arrête sur deux appels successifs', (t) => {
  const { dictation, instances } = setup(t);
  assert.equal(dictation.isUserStopped(), true);
  dictation.toggle(); // démarre
  assert.equal(instances.length, 1);
  assert.equal(dictation.isUserStopped(), false);

  dictation.toggle(); // arrête
  assert.equal(dictation.isUserStopped(), true);
  assert.equal(instances[0].stopCalls, 1);
});

test('statut affiché : écoute en cours au démarrage, dictée terminée à l\'arrêt', (t) => {
  const { dictation, statuses } = setup(t);
  dictation.start();
  assert.ok(statuses.some((s) => /Écoute en cours/.test(s.msg)));
  dictation.stop();
  assert.ok(statuses.some((s) => /Dictée terminée/.test(s.msg)));
});

test('indicateur visuel recording activé au démarrage, désactivé à l\'arrêt final', (t) => {
  const { dictation, recordingStates } = setup(t);
  dictation.start();
  assert.equal(recordingStates[recordingStates.length - 1], true);
  dictation.stop();
  assert.equal(recordingStates[recordingStates.length - 1], false);
});
