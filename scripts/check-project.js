'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { HereSphereFrameParser } = require('../src/main/heresphere-client');
const { DEFAULT_HERESPHERE_PORT, isPrivateIpv4 } = require('../src/main/heresphere-discovery');
const { resolveFunscript, videoNamesFromSource } = require('../src/main/script-library');
const { SettingsStore } = require('../src/main/settings-store');
const { DiagnosticLogManager } = require('../src/main/flight-recorder');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function testFrameParser() {
  const parser = new HereSphereFrameParser();
  const payload1 = Buffer.from(JSON.stringify({ currentTime: 1.25, playerState: 0, playbackSpeed: 1 }));
  const frame1 = Buffer.alloc(4 + payload1.length);
  frame1.writeUInt32LE(payload1.length, 0);
  payload1.copy(frame1, 4);
  assert(parser.push(frame1.subarray(0, 7)).length === 0, 'Le parseur ne doit pas émettre une trame partielle.');
  const decoded1 = parser.push(frame1.subarray(7));
  assert(decoded1.length === 1 && decoded1[0].currentTime === 1.25, 'Décodage little-endian fragmenté incorrect.');

  const payload2 = Buffer.from(JSON.stringify({ currentTime: 2.5, playerState: 1, playbackSpeed: 1 }));
  const frame2 = Buffer.concat([Buffer.from([0, 0, 0, 0]), payload2]);
  const decoded2 = parser.push(frame2);
  assert(decoded2.length === 1 && decoded2[0].playerState === 1, 'Décodage de repli ABHS incorrect.');
}

function testScriptMatching() {
  const names = videoNamesFromSource('file:///C:/Videos/Mon%20Film.mp4?token=abc');
  assert(names.fileName === 'Mon Film.mp4' && names.stem === 'Mon Film', 'Extraction du nom vidéo incorrecte.');

  const entries = [
    { relativePath: 'Mon Film.funscript', name: 'Mon Film.funscript', stemLower: 'mon film' },
    { relativePath: 'Mon Film.mp4.funscript', name: 'Mon Film.mp4.funscript', stemLower: 'mon film.mp4' }
  ];
  const exact = resolveFunscript(entries, 'C:\\Videos\\Mon Film.mp4');
  assert(exact.status === 'match' && exact.match.relativePath === 'Mon Film.mp4.funscript' && exact.priority === 'video-filename', 'Priorité au nom complet incorrecte.');

  const fallback = resolveFunscript(entries.slice(0, 1), 'C:\\Videos\\Mon Film.mp4');
  assert(fallback.status === 'match' && fallback.match.relativePath === 'Mon Film.funscript' && fallback.priority === 'video-stem', 'Correspondance sans extension incorrecte.');

  const ambiguous = resolveFunscript([
    { relativePath: 'A/Mon Film.funscript', name: 'Mon Film.funscript', stemLower: 'mon film' },
    { relativePath: 'B/Mon Film.funscript', name: 'Mon Film.funscript', stemLower: 'mon film' }
  ], 'Mon Film.mp4');
  assert(ambiguous.status === 'ambiguous' && ambiguous.matches.length === 2, 'Détection des ambiguïtés incorrecte.');
}

async function testPersistentSettings() {
  const temporaryDirectory = await fsp.mkdtemp(path.join(os.tmpdir(), 'ossm-hs-settings-'));
  try {
    const settingsPath = path.join(temporaryDirectory, 'settings.json');
    const store = new SettingsStore(settingsPath);
    await store.set('scriptLibraryRoot', 'C:\\Funscripts');
    await store.set('language', 'fr');
    const secondStore = new SettingsStore(settingsPath);
    assert(await secondStore.get('scriptLibraryRoot') === 'C:\\Funscripts', 'Persistance du dossier de scripts incorrecte.');
    assert(await secondStore.get('language') === 'fr', 'Persistance de la langue incorrecte.');
  } finally {
    await fsp.rm(temporaryDirectory, { recursive: true, force: true });
  }
}


async function testFlightRecorder() {
  const temporaryDirectory = await fsp.mkdtemp(path.join(os.tmpdir(), 'ossm-hs-flight-'));
  try {
    const recorder = new DiagnosticLogManager(temporaryDirectory, {
      enabled: false,
      appVersion: '0.1.7-test',
      partLimitBytes: 1200,
      totalLimitBytes: 5000,
      criticalLimitBytes: 1000
    });
    await recorder.readyPromise;
    await recorder.appendBatch([{ type: 'runtime_sample', value: 42 }]);
    let status = await recorder.status();
    assert(status.enabled === false && status.filePath === '', 'Les logs détaillés doivent être désactivés par défaut.');

    await recorder.appendBatch([{ type: 'ui_log', level: 'ERR', message: 'test critical' }]);
    assert((await fsp.readFile(status.criticalFilePath, 'utf8')).includes('test critical'), 'Le journal critique minimal est absent.');

    status = await recorder.setEnabled(true);
    assert(status.enabled && status.filePath, 'L’activation des logs détaillés a échoué.');
    await recorder.appendBatch(Array.from({ length: 40 }, (_, index) => ({ type: 'test_event', index, payload: 'x'.repeat(80) })));
    await recorder.flush();
    status = await recorder.status();
    assert(status.part >= 2, 'La rotation des fichiers détaillés n’a pas été déclenchée.');
    assert(status.totalBytes <= 6500, 'Le plafond global des journaux n’est pas respecté avec la marge du fichier actif.');

    status = await recorder.setEnabled(false);
    assert(!status.enabled && status.filePath === '', 'La désactivation des logs détaillés a échoué.');
    status = await recorder.purge();
    assert(status.totalBytes === 0, 'La purge des journaux a échoué.');
    await recorder.close();
  } finally {
    await fsp.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function testCore(root) {
  const core = await import(pathToFileURL(path.join(root, 'src/renderer/core.mjs')).href);
  const { StabilizedHereSphereClock, BleOperationArbiter, computeLatestDueCommand } = core;

  const clock = new StabilizedHereSphereClock();
  let result = clock.update({ currentTime: 10, playerState: 0, playbackSpeed: 1 }, 'video.mp4', 1000);
  assert(result.hardAnchor && Math.abs(clock.nowAt(1100) - 10.1) < 0.0001, 'Ancrage initial de l’horloge incorrect.');
  result = clock.update({ currentTime: 10.08, playerState: 0, playbackSpeed: 1 }, 'video.mp4', 1100);
  assert(!result.seekDetected && result.correctionMs === 0, 'Le jitter faible ne doit pas déclencher de correction.');
  result = clock.update({ currentTime: 10.5, playerState: 0, playbackSpeed: 1 }, 'video.mp4', 1200);
  assert(!result.seekDetected && result.correctionMs === 20, 'La correction progressive doit être plafonnée à 20 ms.');
  result = clock.update({ currentTime: 15, playerState: 0, playbackSpeed: 1 }, 'video.mp4', 1300);
  assert(result.seekDetected && Math.abs(clock.nowAt(1300) - 15) < 0.0001, 'Un seek massif doit être détecté immédiatement.');

  const confirmClock = new StabilizedHereSphereClock();
  confirmClock.update({ currentTime: 0, playerState: 0, playbackSpeed: 1 }, 'video.mp4', 0);
  const firstCandidate = confirmClock.update({ currentTime: 1, playerState: 0, playbackSpeed: 1 }, 'video.mp4', 100);
  const secondCandidate = confirmClock.update({ currentTime: 1.1, playerState: 0, playbackSpeed: 1 }, 'video.mp4', 200);
  assert(!firstCandidate.seekDetected && secondCandidate.seekDetected, 'Un seek intermédiaire doit être confirmé par deux timestamps.');

  const actions = [
    { at: 0, pos: 0 },
    { at: 100, pos: 20 },
    { at: 200, pos: 80 },
    { at: 300, pos: 100 }
  ];
  const due = computeLatestDueCommand(actions, 0, 250, true);
  assert(due.nextIndex === 3 && due.skipped === 2, 'Le calcul des actions dépassées est incorrect.');
  assert(due.command.target === 0 && due.command.duration === 100, 'La cible Reverse ou la durée est incorrecte.');

  let active = 0;
  let maxActive = 0;
  const executed = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const arbiter = new BleOperationArbiter();
  const first = arbiter.submitStream('first', async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    executed.push('first');
    await firstGate;
    active -= 1;
  });
  await new Promise((resolve) => setImmediate(resolve));
  const second = arbiter.submitStream('second', async () => { executed.push('second'); });
  const third = arbiter.submitStream('third', async () => { executed.push('third'); });
  releaseFirst();
  const [firstResult, secondResult, thirdResult] = await Promise.all([first, second, third]);
  assert(firstResult.status === 'ok' && secondResult.status === 'dropped' && thirdResult.status === 'ok', 'Remplacement des commandes Streaming incorrect.');
  assert(executed.join(',') === 'first,third' && maxActive === 1, 'Les opérations BLE doivent rester strictement sérialisées.');
}

function testStaticProject(root) {
  const required = [
    'package.json',
    'src/main/main.js',
    'src/main/preload.js',
    'src/main/heresphere-client.js',
    'src/main/heresphere-discovery.js',
    'src/main/script-library.js',
    'src/main/settings-store.js',
    'src/main/flight-recorder.js',
    'src/renderer/index.html',
    'src/renderer/styles.css',
    'src/renderer/app.js',
    'src/renderer/core.mjs',
    'src/renderer/i18n.js',
    'README.md',
    'NOTICE.md',
    'NO_LICENSE.md'
  ];
  for (const relative of required) assert(fs.existsSync(path.join(root, relative)), `Fichier manquant : ${relative}`);

  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert(packageJson.version === '0.1.8', 'La version package doit être 0.1.8.');
  assert(packageJson.author === 'IOmat', 'L’auteur package doit être IOmat.');
  assert(packageJson.build?.win?.target?.[0]?.target === 'nsis', 'La cible principale doit être un installateur NSIS.');
  assert(packageJson.build?.nsis?.displayLanguageSelector === true, 'Le sélecteur de langue de l’installateur est absent.');
  assert(DEFAULT_HERESPHERE_PORT === 23554, 'Le port HereSphere doit rester 23554.');
  assert(isPrivateIpv4('192.168.1.12') && isPrivateIpv4('10.0.0.2') && !isPrivateIpv4('8.8.8.8'), 'Détection IPv4 privée incorrecte.');

  const html = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'src/renderer/app.js'), 'utf8');
  const core = fs.readFileSync(path.join(root, 'src/renderer/core.mjs'), 'utf8');
  const mainSource = fs.readFileSync(path.join(root, 'src/main/main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'src/main/preload.js'), 'utf8');
  const i18n = fs.readFileSync(path.join(root, 'src/renderer/i18n.js'), 'utf8');

  for (const requiredId of [
    'hsHost', 'hsPort', 'resumeAutoButton', 'disarmButton', 'ossmConnect', 'bleSuccess', 'bleErrors',
    'droppedCommands', 'resyncCount', 'bleQueueDepth', 'clockCorrection', 'sleepBlocker', 'languageSelect', 'languageDialog',
    'openLogFolder', 'purgeLogs', 'logsEnabled', 'logTotalSize', 'flightLogPath',
    'aboutButton', 'aboutDialog', 'aboutVersion'
  ]) {
    assert(html.includes(`id="${requiredId}"`), `Élément HTML manquant : ${requiredId}`);
  }

  assert(!renderer.includes('go:strokeEngine'), 'La V1.4 ne doit jamais basculer vers le StrokeEngine.');
  assert(!renderer.includes('readStateOnce'), 'La V1.4 ne doit pas effectuer de lectures d’état concurrentes pour le parking.');
  assert(renderer.includes('STREAM_PARK_DURATION_MS') && renderer.includes("kind: 'park'"), 'Le parking Streaming est absent.');
  assert(renderer.includes('computeLatestDueCommand') && core.includes('class BleOperationArbiter'), 'L’arbitre BLE ou le scheduler fiable est absent.');
  assert(mainSource.includes("powerSaveBlocker.start('prevent-display-sleep')"), 'L’inhibition de veille prevent-display-sleep est absente.');
  assert(mainSource.includes('backgroundThrottling: false'), 'La désactivation du throttling du renderer en arrière-plan est absente.');
  assert(mainSource.includes("ipcMain.handle('power-save-status'") && preload.includes('powerSave'), 'Le contrôle visible de l’inhibition de veille est absent.');
  assert(mainSource.includes("ipcMain.handle('settings-get'") && preload.includes('settings:'), 'Le stockage Electron générique est absent.');
  assert(mainSource.includes("ipcMain.handle('flight-record-batch'") && preload.includes('flight:'), 'Le pont de journalisation persistante est absent.');
  assert(mainSource.includes("ipcMain.handle('flight-set-enabled'") && mainSource.includes("ipcMain.handle('flight-purge'"), 'La gestion optionnelle des journaux est absente.');
  assert(html.includes('id="simpleMode" type="checkbox">'), 'Le mode classique doit être la valeur par défaut.');
  assert(renderer.includes("flight.record('scheduler_due'") && renderer.includes("flight.record('clock_update'") && renderer.includes("flight.record('runtime_sample'"), 'L’instrumentation détaillée du renderer est absente.');
  assert(core.includes('onEvent') && core.includes('operation_success'), 'L’instrumentation de l’arbitre BLE est absente.');
  assert(i18n.includes('fr:') && i18n.includes('en:') && i18n.includes('es:') && i18n.includes("'pt-BR':") && html.includes('data-language-choice="pt-BR"'), 'L’infrastructure de localisation FR/EN/ES/PT-BR est absente.');
  assert(html.includes('class="status-grid"') && html.includes('data-i18n="ui.diagnostics"'), 'L’interface épurée ou son panneau diagnostic est absent.');
  assert(html.includes('Community app by IOmat') && i18n.includes('about.independent'), 'L’identité publique ou la fenêtre À propos est absente.');
  assert(mainSource.includes("ipcMain.handle('app-info'") && preload.includes('app:'), 'Les informations de version de la fenêtre À propos sont absentes.');
  assert(!html.includes('Autorité motrice automatique'), 'Le texte technique d’autorité motrice ne doit plus être visible dans l’interface.');
}

async function main() {
  const root = path.resolve(__dirname, '..');
  testStaticProject(root);
  await testFrameParser();
  testScriptMatching();
  await testPersistentSettings();
  await testFlightRecorder();
  await testCore(root);
  console.log('Vérification du projet V0.1.8 RC4 : OK');
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
