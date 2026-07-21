<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>OSSM HereSphere</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <main class="shell">
    <header class="topbar">
      <div class="brand">
        <h1 data-i18n="app.heading">OSSM HereSphere</h1>
        <span class="version">V0.1.8 RC4</span>
      </div>
      <div class="header-actions">
        <label class="language-control">
          <span data-i18n="language.label">Langue</span>
          <select id="languageSelect" aria-label="Language">
            <option value="fr">Français</option>
            <option value="en">English</option>
            <option value="es">Español</option>
            <option value="pt-BR">Português (Brasil)</option>
          </select>
        </label>
        <div id="globalState" class="pill neutral" data-i18n="app.waiting">AUTOMATIQUE EN ATTENTE</div>
      </div>
    </header>

    <section class="status-grid" aria-label="Status">
      <article class="status-card">
        <div class="status-heading">
          <span class="status-label" data-i18n="hs.title">HereSphere</span>
          <span id="hsBadge" class="badge neutral" data-i18n="hs.searching">Recherche automatique…</span>
        </div>
        <strong id="videoPath" class="main-value">—</strong>
        <div class="inline-metrics">
          <span><span data-i18n="metric.state">État</span> <b id="playerState">—</b></span>
          <span><span data-i18n="metric.time">Temps</span> <b id="videoTime">00:00.000</b></span>
          <span><span data-i18n="metric.speed">Vitesse</span> <b id="playbackSpeed">1.000×</b></span>
        </div>
      </article>

      <article class="status-card">
        <div class="status-heading">
          <span class="status-label" data-i18n="script.title">Funscript</span>
          <span id="scriptBadge" class="badge neutral" data-i18n="script.none">Aucun script</span>
        </div>
        <strong id="scriptName" class="main-value">—</strong>
        <p id="scriptFolder" class="secondary-value" data-i18n="script.noFolder">Aucun dossier sélectionné</p>
      </article>

      <article class="status-card ossm-status">
        <div class="status-heading">
          <span class="status-label" data-i18n="ossm.title">OSSM</span>
          <span id="ossmBadge" class="badge neutral" data-i18n="ossm.disconnected">Déconnecté</span>
        </div>
        <div class="button-row primary-actions">
          <button id="ossmConnect" data-i18n="ossm.connect">Connecter l’OSSM</button>
          <button id="ossmDisconnect" class="secondary" data-i18n="ossm.disconnect">Déconnecter</button>
        </div>
      </article>
    </section>

    <section class="control-bar">
      <button id="disarmButton" class="danger stop-button" data-i18n="authority.stop">ARRÊT</button>
      <button id="resumeAutoButton" class="secondary" data-i18n="authority.resume">Réactiver l’automatisme</button>
      <div class="sleep-state">
        <span data-i18n="metric.sleepBlocker">Veille ordinateur</span>
        <strong id="sleepBlocker">—</strong>
      </div>
    </section>

    <details class="panel configuration-panel">
      <summary data-i18n="ui.configuration">Configuration</summary>
      <div class="panel-content">
        <section class="settings-section">
          <div class="section-heading">
            <h2 data-i18n="script.folder">Dossier de scripts</h2>
            <div class="button-row compact-row">
              <button id="chooseScriptFolder" data-i18n="script.chooseFolder">Choisir le dossier</button>
              <button id="refreshScriptFolder" class="secondary" data-i18n="script.refresh">Actualiser</button>
            </div>
          </div>
          <p id="autoMatchStatus" class="helper" data-i18n="script.folderPrompt">Sélectionner une fois le dossier contenant les fichiers .funscript.</p>
          <label class="file-picker compact-picker">
            <input id="scriptFile" type="file" accept=".funscript,.json,.csv">
            <span data-i18n="script.manual">Choisir manuellement un funscript</span>
          </label>
          <div class="checks">
            <label><input id="simpleMode" type="checkbox"> <span data-i18n="script.simpleMode">Simplified R+D</span></label>
            <label><input id="reverseMode" type="checkbox" checked> <span data-i18n="script.reverseMode">Inverser le sens</span></label>
          </div>
        </section>

        <section class="settings-section">
          <h2 data-i18n="ossm.advanced">Limites mécaniques</h2>
          <div class="sliders">
            <label><span data-i18n="ossm.maxSpeed">Vitesse maximale</span> <output id="speedValue">0</output><input id="speed" type="range" min="0" max="100" value="0"></label>
            <label><span data-i18n="ossm.maxStroke">Course maximale</span> <output id="strokeValue">0</output><input id="stroke" type="range" min="0" max="100" value="0"></label>
            <label><span data-i18n="ossm.maxDepth">Profondeur maximale</span> <output id="depthValue">0</output><input id="depth" type="range" min="0" max="100" value="0"></label>
            <label><span data-i18n="ossm.maxAcceleration">Accélération maximale</span> <output id="sensationValue">0</output><input id="sensation" type="range" min="0" max="100" value="0"></label>
            <label><span data-i18n="ossm.deviceBuffer">Buffer périphérique</span> <output id="bufferValue">0 ms</output><input id="buffer" type="range" min="0" max="200" value="0"></label>
            <label><span data-i18n="ossm.timeOffset">Décalage temporel</span> <output id="offsetValue">5 ms</output><input id="offset" type="range" min="-100" max="100" value="5"></label>
          </div>
        </section>

        <details class="subpanel">
          <summary data-i18n="ui.network">Connexion HereSphere</summary>
          <div class="form-row">
            <label><span data-i18n="hs.address">Adresse détectée</span>
              <input id="hsHost" type="text" value="Recherche automatique…" readonly spellcheck="false">
            </label>
            <label><span data-i18n="hs.fixedPort">Port</span>
              <input id="hsPort" type="number" value="23554" readonly>
            </label>
          </div>
          <div class="button-row">
            <button id="hsConnect" data-i18n="hs.searchNow">Rechercher maintenant</button>
            <button id="hsDisconnect" class="secondary" data-i18n="hs.pauseReconnect">Suspendre la reconnexion</button>
          </div>
        </details>
      </div>
    </details>

    <details class="panel diagnostics-panel">
      <summary data-i18n="ui.diagnostics">Diagnostic</summary>
      <div class="panel-content">
        <dl class="metrics diagnostics">
          <div><dt data-i18n="metric.file">Fichier</dt><dd id="matchMode">—</dd></div>
          <div><dt data-i18n="metric.indexedScripts">Scripts indexés</dt><dd id="libraryCount">0</dd></div>
          <div><dt data-i18n="metric.rawActions">Actions brutes</dt><dd id="rawActionCount">0</dd></div>
          <div><dt data-i18n="metric.simpleActions">Actions simplifiées</dt><dd id="simpleActionCount">0</dd></div>
          <div><dt data-i18n="metric.scriptDuration">Durée script</dt><dd id="scriptDuration">00:00.000</dd></div>
          <div><dt data-i18n="metric.sentPosition">Position envoyée</dt><dd id="sentPosition">—</dd></div>
          <div><dt data-i18n="metric.commandsSent">Commandes envoyées</dt><dd id="commandsSent">0</dd></div>
          <div><dt data-i18n="metric.index">Index</dt><dd id="actionIndex">0</dd></div>
          <div><dt data-i18n="metric.timestampAge">Âge timestamp</dt><dd id="timestampAge">—</dd></div>
          <div><dt data-i18n="metric.bleSuccess">Écritures BLE réussies</dt><dd id="bleSuccess">0</dd></div>
          <div><dt data-i18n="metric.bleErrors">Erreurs BLE</dt><dd id="bleErrors">0</dd></div>
          <div><dt data-i18n="metric.dropped">Commandes abandonnées</dt><dd id="droppedCommands">0</dd></div>
          <div><dt data-i18n="metric.resyncs">Resynchronisations</dt><dd id="resyncCount">0</dd></div>
          <div><dt data-i18n="metric.queueDepth">File BLE</dt><dd id="bleQueueDepth">0</dd></div>
          <div><dt data-i18n="metric.clockCorrection">Correction horloge</dt><dd id="clockCorrection">0 ms</dd></div>
        </dl>

        <div class="log-heading">
          <h2 data-i18n="log.title">Journaux</h2>
          <div class="button-row compact-row">
            <button id="openLogFolder" class="secondary small" data-i18n="log.openFolder">Ouvrir le dossier</button>
            <button id="purgeLogs" class="secondary small" data-i18n="log.purge">Purger les logs</button>
            <button id="clearLog" class="secondary small" data-i18n="log.clear">Effacer l’affichage</button>
          </div>
        </div>
        <div class="log-settings">
          <label class="log-toggle"><input id="logsEnabled" type="checkbox"> <span data-i18n="log.enable">Enregistrer les logs de diagnostic</span></label>
          <span id="logsStatus" class="badge neutral" data-i18n="log.disabled">Désactivés</span>
        </div>
        <p class="helper" data-i18n="log.warning">Les journaux de diagnostic peuvent occuper de l’espace. Activez-les seulement pour analyser un problème et pensez à les purger après transmission.</p>
        <p class="helper"><span data-i18n="log.storage">Espace utilisé</span> : <strong id="logTotalSize">0 Mo</strong> / 100 Mo <span data-i18n="log.limit">limite automatique</span></p>
        <p class="helper"><span data-i18n="log.file">Fichier actif :</span> <span id="flightLogPath" class="path-line">—</span></p>
        <pre id="log"></pre>
      </div>
    </details>

    <footer class="app-footer">
      <span data-i18n="about.footer">Community app by IOmat</span>
      <button id="aboutButton" class="text-button" data-i18n="about.open">About</button>
    </footer>
  </main>

  <dialog id="bluetoothDialog">
    <form method="dialog">
      <h2 data-i18n="bluetooth.title">Choisir l’OSSM</h2>
      <div id="bluetoothDevices" class="device-list"></div>
      <button id="bluetoothCancel" value="cancel" class="secondary" data-i18n="common.cancel">Annuler</button>
    </form>
  </dialog>

  <dialog id="languageDialog" class="language-dialog">
    <form method="dialog">
      <h2 data-i18n="language.title">Choisir la langue</h2>
      <p data-i18n="language.help">Ce choix sera mémorisé.</p>
      <div class="language-grid">
        <button value="fr" data-language-choice="fr">Français</button>
        <button value="en" data-language-choice="en">English</button>
        <button value="es" data-language-choice="es">Español</button>
        <button value="pt-BR" data-language-choice="pt-BR">Português (Brasil)</button>
      </div>
    </form>
  </dialog>



  <dialog id="aboutDialog" class="about-dialog">
    <form method="dialog">
      <div class="about-heading">
        <div>
          <h2 data-i18n="about.title">OSSM HereSphere Controller</h2>
          <p class="about-version"><span data-i18n="about.version">Version</span> <strong id="aboutVersion">0.1.8</strong></p>
        </div>
        <button id="aboutClose" value="close" class="secondary small" data-i18n="common.close">Close</button>
      </div>
      <p data-i18n="about.created">Community app by IOmat.</p>
      <p data-i18n="about.credit">Uses native OSSM Streaming and a funscript scheduling approach based on work published by Research &amp; Desire.</p>
      <p data-i18n="about.independent">Independent community project. Not officially affiliated with Research &amp; Desire.</p>
      <p class="about-note" data-i18n="about.free">Shared free of charge for the OSSM community.</p>
    </form>
  </dialog>

  <script type="module" src="app.js"></script>
</body>
</html>
