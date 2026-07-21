{
  "name": "ossm-heresphere-rd",
  "version": "0.1.8",
  "description": "Standalone HereSphere to native OSSM Streaming controller — Release Candidate 4.",
  "main": "src/main/main.js",
  "private": true,
  "license": "UNLICENSED",
  "scripts": {
    "start": "electron .",
    "check": "node scripts/check-project.js",
    "build:win": "electron-builder --win nsis --x64",
    "build:portable": "electron-builder --win portable --x64"
  },
  "devDependencies": {
    "electron": "33.2.1",
    "electron-builder": "25.1.8"
  },
  "build": {
    "appId": "local.ossm.heresphere.rdv1",
    "productName": "OSSM HereSphere",
    "directories": {
      "output": "dist"
    },
    "files": [
      "src/**/*",
      "package.json",
      "README.md",
      "NOTICE.md",
      "NO_LICENSE.md"
    ],
    "win": {
      "target": [
        {
          "target": "nsis",
          "arch": [
            "x64"
          ]
        }
      ],
      "artifactName": "OSSM-HereSphere-Setup-${version}-${arch}.${ext}",
      "signAndEditExecutable": false
    },
    "nsis": {
      "oneClick": true,
      "perMachine": false,
      "displayLanguageSelector": true,
      "installerLanguages": [
        "fr_FR",
        "en_US",
        "es_ES",
        "pt_BR"
      ],
      "createDesktopShortcut": true,
      "createStartMenuShortcut": true,
      "shortcutName": "OSSM HereSphere",
      "runAfterFinish": true,
      "deleteAppDataOnUninstall": false
    }
  },
  "author": "IOmat"
}
