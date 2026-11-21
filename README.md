# Atelier Delphi · MecaParts Maroc

Une plateforme pour faire vivre la méthode Delphi à la classe. L'écran du projecteur pilote la séance, et les étudiants répondent depuis leur téléphone après avoir scanné un QR code.

## Déroulé de la séance

| Étape | Écran projecteur | Téléphones |
|---|---|---|
| Scénario | Présentation de MecaParts Maroc et frise des 12 semaines | En attente |
| Inscription | QR code, code de session, compteur en direct par département | Prénom et département |
| Tour 1 : identification | 4 questions ouvertes de 3 min chacune, à passer avec « Question suivante » | Réponse libre, un élément par ligne |
| Analyse | Compte à rebours de 10 s, réponses regroupées par thème, réponses répétées, constats automatiques | En attente |
| Consolidation | Liste des risques sans doublons, jusqu'à 8 risques à garder, ajout possible | En attente |
| Tour 2 : notation | Un risque à la fois, temps réglable | Probabilité et impact de 1 à 5 |
| Analyse | Matrice des risques, classement, accord, répartition des notes | En attente |
| Tour 3 : ajustement | Même liste, avec la médiane du tour 2 | Nouvelle note, justification obligatoire si l'écart à la médiane est de 2 points ou plus, mesure de maîtrise |
| Consensus | Convergence des avis entre le tour 2 et le tour 3 | En attente |
| Tour supplémentaire | Proposé seulement sur les risques sans consensus | Comme au tour 3 |
| Résultat | Liste hiérarchisée avec niveaux et mesures, export CSV, impression | Fin |

Règle de consensus : au moins 70 % des avis à ±1 de la médiane, en probabilité et en impact.

Raccourcis clavier au projecteur : `→` pour passer à la suite, `Espace` pour mettre en pause, `F` pour le plein écran.

## Répéter seul, sans serveur

1. Dans ce dossier, lancez `python3 -m http.server 8000`
2. Ouvrez `http://localhost:8000/?local`
3. Créez la session, puis cliquez sur « Ajouter 20 participants fictifs » au moment du QR code
4. Pour voir l'écran d'un étudiant, ouvrez le lien affiché sous le QR code dans un autre onglet du même navigateur

Les participants fictifs répondent tout seuls pendant les questions. Ils servent uniquement à s'entraîner.

## État actuel

Le projet Supabase `gvgxwnjbxsrarxdzdbsn` est déjà prêt : les tables sont créées, le temps réel est activé et les clés sont dans `js/config.js`. Il reste seulement à mettre le site en ligne (étape 5 ci-dessous).

Pour répéter sans Supabase, ajoutez `?local` à l'adresse : `http://localhost:8000/?local`.

## Préparer la vraie séance avec Supabase (environ 10 minutes)

Les téléphones et le projecteur sont des appareils différents. Ils doivent donc passer par un serveur commun. Supabase s'en charge gratuitement, avec le temps réel inclus.

1. Créez un projet sur [supabase.com](https://supabase.com)
2. Ouvrez **SQL Editor**, collez le contenu de `schema.sql`, puis cliquez sur **Run**
3. Dans **Project Settings > API**, copiez la **Project URL** et la clé **anon public**
4. Collez ces deux valeurs dans `js/config.js`
5. Mettez le site en ligne, par exemple sur GitHub Pages ou Vercel. C'est un site statique, sans compilation.
6. Ouvrez le site en ligne. L'accueil doit afficher « Connecté à Supabase ».

Avant la séance, faites un essai avec 2 téléphones.

Après la séance, videz les données dans le SQL Editor avec `delete from public.sessions;`.

À noter : la clé publique donne un accès ouvert aux trois tables de l'atelier. C'est suffisant pour une séance en classe, mais n'y stockez rien d'autre.

## Modifier le contenu

Tout le texte est dans `js/content.js` :

- `SCENARIO` : le scénario et la frise
- `DEPARTMENTS` : les 5 départements et leurs couleurs
- `ROUND1_QUESTIONS` : les questions du tour 1
- `THEMES` : le catalogue qui regroupe les réponses libres par mots-clés. Si une réponse fréquente tombe dans « hors catalogue », ajoutez un mot-clé ici.
- `RULES` : seuil de consensus, écart qui exige une justification, nombre maximal de risques

## Structure

```
index.html         page unique
styles.css         styles
js/main.js         routage : #/join/CODE pour les téléphones, le reste pour l'animateur
js/host.js         écran projecteur
js/player.js       écran téléphone
js/analysis.js     regroupement par thème, médianes, consensus, constats
js/store.js        Supabase ou mode répétition local
js/content.js      contenu de l'atelier
js/config.js       clés Supabase
vendor/qrcode.mjs  générateur de QR code (MIT, Kazuhiko Arase)
vendor/supabase.mjs  client Supabase (MIT), inclus pour ne dépendre d'aucun CDN
schema.sql         tables Supabase
```
