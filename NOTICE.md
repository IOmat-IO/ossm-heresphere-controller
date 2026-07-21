# Guide de publication GitHub et Discord

Ce fichier sert de pense-bête après la compilation de la RC4.

## Fichiers à placer dans le dépôt GitHub

À la racine du dépôt public :

- `README.md`
- `NOTICE.md`
- `NO_LICENSE.md`

Tu peux également ajouter :

- `RELEASE_NOTES_v0.1.8-rc4.md`
- une capture d'écran de l'application dans un dossier `images`

Ne dépose pas l'installateur comme fichier ordinaire du dépôt.

## Fichiers à joindre à la Release

Après compilation, dans la section **Releases** de GitHub, joins :

- `OSSM-HereSphere-Setup-0.1.8-x64.exe`
- `OSSM-HereSphere-Setup-0.1.8-x64.exe.sha256.txt`

Le script `BUILD_INSTALLER.bat` génère les deux fichiers dans `dist`.

## Paramètres conseillés pour la Release

Tag :

```text
v0.1.8-rc4
```

Titre :

```text
OSSM HereSphere Controller v0.1.8 RC4
```

Coche **Set as a pre-release**.

Copie le contenu de `RELEASE_NOTES_v0.1.8-rc4.md` dans la description de la Release.

## Partage dans Discord

Une fois la Release publiée, ouvre sa page et copie l'adresse de la page complète, pas seulement l'adresse directe du fichier `.exe`.

Utilise ensuite le texte de `DISCORD_ANNOUNCEMENT_TEMPLATE.md` et remplace le texte entre crochets par le lien de la Release.
