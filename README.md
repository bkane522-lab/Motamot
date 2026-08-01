# Motamot — PWA de traduction

## Structure
```
index.html                 interface (une seule page, vanilla HTML/CSS/JS)
manifest.json, sw.js        PWA installable + cache offline de l'interface
icons/                       favicon, icônes 192/512
package.json                 dépendance npm (pdf-parse), Vercel l'installe au build

api/translate.js             fonction serverless — wrapper fin
api/verify-license.js        fonction serverless — wrapper fin
api/extract-pdf.js           fonction serverless — wrapper fin
api/revise.js                fonction serverless — wrapper fin (Révision intelligente premium)

lib/translateHandler.js      logique de traduction (découpage, chunking, erreurs)
lib/verifyLicenseHandler.js  logique de vérification Gumroad + émission de jeton (scope "premium")
lib/extractPdfHandler.js     logique d'extraction PDF (jeton "premium" requis)
lib/reviseHandler.js         logique de la Révision intelligente (jeton "premium" requis, JSON structuré)
lib/parseRevisionResponse.js parsing + validation stricte du JSON renvoyé par le modèle (pur, testé isolément)
lib/chunkText.js             découpage de texte long, pur, testé isolément
lib/licenseToken.js          jetons premium signés HMAC-SHA256
lib/rateLimit.js             limitation de requêtes par IP (Upstash Redis)
lib/cors.js                  CORS restreint (fini le Access-Control-Allow-Origin: *)
lib/getClientIp.js           extraction d'IP pour le rate limiting

tests/                        80 tests (node:test), tous exécutés et verts
```

## Déploiement (GitHub → Vercel)
1. Repo GitHub avec **tous** ces fichiers, y compris `package.json` et le
   dossier `lib/` à la racine (pas seulement `api/` et `index.html`).
2. Vercel connecté au repo → au déploiement, Vercel exécute `npm install`
   automatiquement (grâce à `package.json`) pour installer `pdf-parse`.
3. Variables d'environnement (Project Settings → Environment Variables) :

| Variable | Obligatoire | Rôle |
|---|---|---|
| `GROQ_API_KEY` | Oui | clé Groq pour la traduction et la révision |
| `LICENSE_SECRET` | Oui (pour le premium) | secret de signature des jetons — génère une chaîne aléatoire longue, ex. `openssl rand -hex 32` |
| `GUMROAD_PRODUCT_ID` | Recommandé | force le produit Gumroad côté serveur |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Recommandé | active la limitation de requêtes réelle |
| `ALLOWED_ORIGINS` | Optionnel | origines autorisées séparées par des virgules |
| `REVISE_RATE_LIMIT` | Optionnel | nombre de révisions/10min par IP (défaut : 10) |

4. Redéployer après toute modification de variable.
5. Remplacer `GUMROAD_PRODUCT_ID` et `GUMROAD_PRODUCT_URL` dans
   `index.html` par les vraies valeurs de ton produit Gumroad.
6. **Après ce déploiement précis** : le service worker est passé en cache
   `motamot-v2` (il était resté en `v1` alors que le JS avait changé) — les
   appareils qui avaient déjà installé l'app récupéreront automatiquement
   la nouvelle version au prochain chargement.

## Révision intelligente premium — ce qui a changé dans cette passe corrective

La précédente version ("Relire (IA)") appelait Groq une seconde fois mais :
remplaçait directement la traduction affichée, ne demandait qu'un texte
libre (pas de structure), et le prompt ne couvrait pas tous les points
attendus. Cette passe corrige les trois :

**1. Plus de remplacement automatique.** La traduction initiale reste
affichée telle quelle. Le résultat de la révision apparaît dans une section
séparée **"Version révisée"**, avec ses propres boutons Copier/Partager.
Un bouton dédié **"Remplacer la traduction initiale"** permet de reporter
la version révisée sur la traduction principale — uniquement sur clic
explicite, jamais automatiquement.

**2. Vraie réponse JSON structurée.** `/api/revise` demande maintenant au
modèle un objet JSON strict :
```json
{
  "revisedTranslation": "Texte révisé complet",
  "changesMade": ["Description courte d'une correction importante"],
  "warnings": ["Ambiguïté ou point nécessitant une vérification humaine"],
  "checks": {
    "meaningPreserved": true,
    "tonePreserved": true,
    "namesAndNumbersPreserved": true,
    "naturalLanguage": true
  }
}
```
`lib/parseRevisionResponse.js` valide strictement cette forme : essaie
`JSON.parse` direct, puis — si le modèle a entouré le JSON de texte — extrait
la sous-chaîne entre la première `{` et la dernière `}` et retente. Si le
résultat ne correspond toujours pas exactement au schéma (traduction
manquante, `checks` incomplet, valeur non booléenne...), le serveur répond
502 avec un message générique. **Le JSON brut n'est jamais renvoyé tel quel
à l'interface** — soit il est validé et restructuré, soit il est rejeté.

**3. Prompt renforcé.** Le prompt système (voir `lib/reviseHandler.js`,
constante `SYSTEM_PROMPT`) demande explicitement de vérifier : fidélité du
sens, contresens, omissions, ajouts injustifiés, fluidité, grammaire,
ponctuation, politesse, registre, cohérence du ton, noms propres, chiffres,
dates, montants, références, termes techniques, passages ambigus — et de
préserver intention, structure, paragraphes, faits, noms, nombres, degré de
formalité, sans jamais inventer d'information.

**4. Interface.** Sous "Version révisée" : la traduction révisée, une grille
compacte **"Points vérifiés"** (les 4 booléens de `checks`, avec un point
vert/rouge), **"Modifications principales"** (`changesMade`, masqué si vide),
**"Points à vérifier"** (`warnings`, masqué si vide), puis un avertissement
sur les documents sensibles, et les boutons Copier / Partager / Remplacer.

## Ce qui n'a PAS changé dans cette passe (comme demandé)
Traduction simple, dictée vocale, imports, historique, PDF premium, jetons
signés, rate limiting existant, CORS, design général (bleu nuit, ivoire,
jade, ambre, Fraunces) — tout est resté tel quel. Le scope de jeton premium
reste `"premium"` (déjà unifié PDF + révision depuis la passe précédente,
aucun changement nécessaire ici).

## Où le nom du fournisseur apparaît (ou pas)
Aucun des libellés visibles ("Réviser intelligemment", "Version révisée",
"Motamot Premium") ne mentionne Groq, Claude ou GPT. Le nom "Groq"
n'apparaît que dans le code serveur et ce README, jamais dans l'interface.

## Révision intelligente — limites et coûts honnêtes
- **Ce n'est pas gratuit en usage.** Chaque clic sur "Réviser intelligemment"
  déclenche un appel Groq supplémentaire, en plus de celui déjà fait par la
  traduction initiale — donc plus de requêtes et de jetons consommés que la
  traduction simple.
- **Ça peut atteindre plus vite les limites Groq** (quotas de leur côté, hors
  de contrôle de ce code) si l'usage premium est important.
- **Le temps de réponse est plus long** : la révision est un aller-retour
  Groq de plus, avec un prompt plus détaillé (donc plus de tokens à générer).
- **À surveiller en production** : le comportement réel sous charge, le taux
  de réponses JSON invalides du modèle (rejetées en 502), et la consommation
  Upstash/Groq réelle ne sont pas mesurables depuis cet environnement de
  développement (pas d'accès réseau ici).
- **Aucune garantie de justesse absolue.** Rappelé explicitement dans
  l'interface : "Motamot améliore la formulation, mais ne remplace pas la
  vérification d'un professionnel pour un document juridique, médical,
  administratif ou financier sensible."
- **Pas de découpage automatique pour la révision** (contrairement à la
  traduction simple) : plafonné à 8 000 caractères par appel, avec un message
  d'erreur clair si dépassé, plutôt que d'enchaîner plusieurs appels Groq
  séquentiels qui risqueraient un timeout Vercel. C'est une limite assumée
  de cette passe, pas un oubli.
- **Rate limit dédié**, distinct de la traduction et du PDF : 10 révisions
  / 10 min par IP par défaut, configurable via `REVISE_RATE_LIMIT`.
- Le jeton premium (`scope: "premium"`) donne accès au PDF **et** à la
  révision — un partage de clé de licence donne donc accès aux deux.

## Sécurité de la Révision intelligente
- Jeton premium signé HMAC-SHA256 vérifié **avant tout appel Groq** — un
  utilisateur sans jeton valide ne déclenche jamais de requête Groq (prouvé
  par un test qui compte les appels réseau : 0 appel sans jeton).
- Jeton absent, expiré, trafiqué (signature modifiée), ou signé avec un
  mauvais secret → 401 dans tous les cas, testés séparément.
- Clé Groq jamais exposée côté client.
- CORS restreint (pas de `*`), méthode POST uniquement, toutes les entrées
  validées, longueur de texte plafonnée.

## Fiabilité des imports (rappel, inchangé dans cette passe)
Taille de fichier plafonnée à 4 Mo, messages d'erreur différenciés (PDF
scanné, fichier corrompu, fichier vide, réponse serveur inattendue).

## Tests — exécutés réellement, pas juste écrits

```
node --test "tests/**/*.test.js"

tests 80
pass  80
fail  0
```

Couverture de `lib/reviseHandler.js` et `lib/parseRevisionResponse.js` —
correspond exactement à la liste demandée :
accès sans jeton premium, jeton valide, jeton expiré, jeton trafiqué, jeton
signé avec un mauvais secret, méthode HTTP incorrecte, texte original
absent, traduction absente, longueur excessive, réponse Groq invalide, JSON
incomplet, JSON entouré de texte, réponse correcte, avertissements vides,
avertissements présents, rate limiting (dont la limite configurable), erreur
Groq, timeout simulé (fetch qui rejette), absence de clé Groq, CORS (origine
autorisée vs refusée), et conservation des noms/chiffres dans le prompt
envoyé (vérifié en inspectant le corps de la requête réellement envoyée à
Groq dans le test).

**Ce qui N'est PAS testé, et pourquoi (honnêteté avant tout)** :
- **Groq en conditions réelles.** Cet environnement de développement n'a pas
  d'accès réseau — tout est mocké (`fetchImpl` injecté). Je ne peux pas
  garantir que Groq respecte réellement le format JSON demandé à chaque
  appel en production ; c'est précisément pour ça que
  `lib/parseRevisionResponse.js` a une extraction de secours et rejette
  proprement plutôt que de planter si le modèle dévie.
- **`pdf-parse` en conditions réelles** — même raison, `npm install` est
  impossible ici.
- **Gumroad et Upstash en conditions réelles** — mêmes raisons.
- **Le comportement dans un vrai navigateur** (rendu de la section "Version
  révisée", Web Share API, localStorage) — aucun test ici ne tourne dans un
  navigateur.
- **Le timeout Vercel réel** sur un appel de révision (prompt système plus
  long que la traduction simple = plus de tokens = potentiellement plus
  lent) — à surveiller après déploiement.

## Non fait (hors périmètre de cette passe, comme demandé)
Aucune autre fonction n'a été touchée : traduction simple, PDF, dictée,
imports, historique, PWA, sécurité générale, design — tous inchangés sauf
la correction de couleur de thème ci-dessous (nécessaire, pas cosmétique).

## Correction annexe nécessaire (au-delà de la liste stricte, mais liée)
En vérifiant le fichier avant de livrer, un vrai bug a été trouvé (pas une
fausse alerte) : un second bloc CSS (`#motamot-v2-design`, ajouté lors d'une
mise à jour visuelle précédente) redéfinit `--ink` en `#08161d`, alors que
`manifest.json` (`background_color`, `theme_color`) et la balise
`<meta name="theme-color">` étaient restés sur `#14182B` — l'ancienne
couleur, jamais mise à jour après l'ajustement visuel. Corrigé pour que le
splash screen et la barre de statut Android correspondent à l'apparence
réelle de l'app. Signalé séparément parce que ce n'est pas dans la liste
des corrections demandées, mais c'est un vrai défaut trouvé en vérifiant,
pas une fonctionnalité ajoutée de mon initiative.

## Positionnement premium
La fenêtre de déblocage premium présente maintenant "Motamot Premium —
Documents PDF et révision intelligente" plutôt que le PDF seul. Aucune
mention de "textes prêts à envoyer" ou d'autres promesses non développées.

## Freemium (rappel de configuration)
1. Créer un produit Gumroad (accès premium Motamot), récupérer son *product ID*.
2. Remplacer `GUMROAD_PRODUCT_ID` et `GUMROAD_PRODUCT_URL` dans
   `index.html` (cherche `REMPLACER`).
3. Configurer `GUMROAD_PRODUCT_ID` et `LICENSE_SECRET` sur Vercel.
4. Tester avec une clé de licence issue d'un achat test Gumroad.

## Autres fonctionnalités (inchangées)
- Traduction FR + 10 langues, détection auto, mode Naturel/Littéral
- Dictée vocale (Web Speech API), partage natif (Web Share API)
- Historique local (30 dernières traductions, `localStorage`, par appareil)
- Raccourci Android (appui long sur l'icône installée)
- Aucun branding perso dans l'UI, aucune mention du fournisseur technique
