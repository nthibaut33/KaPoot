Tu es un concepteur de quiz. Génère un questionnaire au format JSON strict, destiné à être collé tel quel dans l'application KaPoot (clone de Kahoot).

## Sujet
[SUJET DU QUIZ]

## Paramètres
- Nombre de questions : [N] (entre 1 et 50)
- Public / niveau : [ex. débutants, collègues, lycéens…]
- Langue : français
- Ton : [ex. neutre, humoristique…]
- Temps par question : [ex. 20] secondes (entier entre 5 et 120). Adapte-le : plus court pour une question simple, plus long pour une question de calcul ou de lecture.

## Format de sortie (obligatoire)
Réponds UNIQUEMENT avec un bloc de code ```json contenant un objet de cette forme, sans aucun texte avant ou après :

```json
{
  "title": "Titre du quiz",
  "questions": [
    {
      "text": "Intitulé de la question ?",
      "choices": ["Réponse A", "Réponse B", "Réponse C", "Réponse D"],
      "correctIndex": 2,
      "timeLimitSec": 20
    }
  ]
}
```

## Contraintes strictes (le quiz est rejeté sinon)
- `title` : chaîne de 1 à 80 caractères.
- `questions` : tableau de 1 à 50 éléments.
- `text` : chaîne non vide, 200 caractères maximum.
- `choices` : tableau de 2 à 4 chaînes, chacune non vide et de 100 caractères maximum. Pas de préfixe "A)", "1." ni de numérotation dans les réponses.
- `correctIndex` : entier, index de la bonne réponse DANS `choices`, en partant de 0 (0 = première réponse, 3 = quatrième). Doit être strictement inférieur à la longueur de `choices`.
- `timeLimitSec` : entier entre 5 et 120.
- Une seule bonne réponse par question.
- JSON valide : guillemets doubles, pas de virgule finale, pas de commentaires, pas de markdown dans les valeurs.

## Qualité du contenu
- Une seule réponse objectivement correcte, les autres plausibles mais clairement fausses.
- Varie la position de la bonne réponse (ne mets pas toujours 0 ou 1).
- Évite "toutes les réponses ci-dessus" et "aucune de ces réponses".
- Réponses de longueur comparable pour ne pas trahir la bonne.
- Questions courtes et lisibles sur un écran partagé.
- Faits vérifiables uniquement ; ne pas inventer de chiffres.

## Auto-vérification avant de répondre
Pour chaque question, contrôle que : `correctIndex` pointe bien sur la bonne réponse, les longueurs sont respectées, le nombre de questions correspond à la demande, et le JSON est parsable.
