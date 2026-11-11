## 1. Qui traite les données
Le service s'appelle The Somnus. L'entretien sur le sommeil s'appelle Morpheo.

## 2. Quelles données nous traitons
- Données de compte : adresse e-mail, prénom et nom, date de naissance, genre (vous pouvez choisir « Je préfère ne pas le dire »), pays, langue et, si vous les ajoutez, ville, téléphone et photo de profil.
- Données d'utilisation nécessaires à la sécurité du service : la session et les enregistrements d'audit.
- Les réponses à l'évaluation du sommeil, y compris le texte que vous écrivez et, si vous utilisez le microphone, la voix de cette réponse.
- Le résultat d'orientation et le rapport affiché à la fin.
- Un enregistrement de chaque évaluation Morpheo, sous un numéro de dossier aléatoire et sans votre nom, votre e-mail ni votre compte : ce qui vous a été demandé, ce que vous avez répondu et ce qui vous a été montré.
- Si vous vous inscrivez en tant que professionnel : spécialité, numéro d'ordre, qualifications et documents que vous fournissez pour être vérifié. Si vous vous inscrivez en tant que parent ou tuteur : la tranche d'âge du mineur.
- Les messages que nous vous envoyons (liens d'accès, invitations) : votre e-mail et le message.

## 3. À quoi elles servent
À créer et gérer votre compte, vous donner accès, mener l'entretien, vous montrer le résultat et le rapport, enregistrer vos évaluations et protéger la plateforme. Le genre, l'âge, le pays et la ville nous servent à établir des statistiques agrégées pour comprendre qui utilise le service ; ils ne servent jamais à calculer votre orientation sur le sommeil. Nous ne vous envoyons des communications commerciales que si vous donnez votre consentement aux communications, qui est facultatif et révocable à tout moment. Nous ne vendons pas vos données. Nous conservons l'enregistrement du dossier afin de pouvoir montrer, en cas de réclamation, d'audit ou de demande d'une autorité, ce qui a été demandé, ce qui a été répondu et ce qui a été montré.

Des règles fixes calculent le résultat de l'entretien. Aucun modèle de langage ne note, ne signale une alerte, ne pose un diagnostic ni ne décide du niveau de prise en charge. Le rapport que vous voyez à la fin de l'entretien actuel est fait de phrases déjà approuvées. Un modèle ne le rédige pas.

## 4. Qui d'autre traite des données
- Google Cloud, dans la région europe-west3 (Francfort) : les serveurs de l'application, les fichiers, les files d'attente et les sessions. La session conserve l'e-mail et l'état de connexion. Firebase Hosting sert les pages. Firebase Authentication conserve l'e-mail et un identifiant de compte pour la connexion.
- TiDB Cloud : les bases de données de l'application.
- Brevo, à l'adresse https://api.brevo.com : l'e-mail et le texte du message (liens d'accès et invitations). Le journal d'envoi conserve l'e-mail.
- AssemblyAI, à l'adresse streaming.eu.assemblyai.com : si vous dictez une réponse, le navigateur envoie l'audio de votre voix directement à AssemblyAI pour le transformer en texte. L'audio ne passe pas par nos serveurs et nous ne le conservons pas. Le texte revient dans le champ et vous pouvez le corriger avant de continuer. Si vous dites un nom, un téléphone, un e-mail ou un numéro d'identité, cet audio est envoyé aussi. L'application demande de ne pas les dire et, dans le texte, refuse ces données avant d'enregistrer la réponse.
- OpenAI, à l'adresse https://api.openai.com/v1, lorsque le service de rapports a une clé. Dans ce dépôt, cette adresse est décrite comme un traitement aux États-Unis ; l'adresse européenne n'est pas configurée. L'entretien actuel n'envoie pas vos réponses libres à OpenAI : ce service est configuré avec l'extraction arrêtée et sans clé. Si l'ancienne route du rapport est appelée, OpenAI reçoit le niveau de prise en charge, les motifs et le texte du protocole, afin de rédiger ou de traduire une explication. Cet appel n'inclut ni votre nom, ni votre e-mail, ni votre identifiant, ni vos réponses libres, et il demande que la réponse ne soit pas conservée comme une réponse stockée de la plateforme. Pour chercher des extraits de la bibliothèque clinique, OpenAI peut recevoir des phrases déjà approuvées de cette bibliothèque, pas vos réponses.
- Google, dans le même projet et dans europe-west3, lorsqu'un membre de l'équipe le demande : le texte d'un document interne, pour le corriger, et le texte d'un passage, pour le lire à voix haute sur eu-texttospeech.googleapis.com. La lecture à voix haute est activée dans la configuration. La traduction de ces documents ne l'est pas. Cela ne fait pas partie de votre entretien.

## 5. Combien de temps
Tant que vous conservez votre compte. Les évaluations anonymes qui ne sont pas enregistrées dans un compte sont supprimées au bout de 30 jours. La session de l'application dure 7 jours ; ensuite, le document de session est effacé selon sa date d'expiration. Le journal des messages envoyés est effacé au bout de 90 jours. L'enregistrement du dossier est conservé 24 mois à compter du début de l'évaluation, puis supprimé. Si vous supprimez votre compte, ou si votre évaluation est supprimée, l'enregistrement du dossier est conservé pendant ce délai mais n'est plus lié à vous. En supprimant votre compte, nous effaçons le compte de connexion, les sessions, la photo de profil, les évaluations enregistrées, les rapports de ces évaluations enregistrés à votre nom et les messages adressés à votre e-mail. L'enregistrement d'audit de cette suppression est conservé, sans le texte de vos réponses.

## 6. Vos droits
Vous pouvez accéder à vos données, les rectifier, les effacer et les récupérer, vous opposer à leur traitement ou le limiter, et retirer vos consentements. Vous pouvez aussi introduire une réclamation auprès de l'Agence espagnole de protection des données (www.aepd.es). Si vous demandez l'effacement de vos données, l'enregistrement du dossier est conservé jusqu'à la fin de son délai de 24 mois ; il ne sera plus lié à vous.

## 7. Sécurité
Les communications sont chiffrées. Les photos et les rapports sont conservés dans un stockage privé. Les documents internes de l'équipe sont chiffrés dans le navigateur avant d'être enregistrés ; le service conserve ce chiffré et ne détient pas la clé qui l'ouvre. L'audio de la dictée n'est pas chiffré avec cette clé : il va chez AssemblyAI. Le texte qu'un membre de l'équipe demande de lire à voix haute sort de ce chiffrement et va chez Google. Seule la super-administration de la plateforme peut ouvrir l'enregistrement d'un dossier, avec le numéro de dossier et une justification écrite ; il est noté qui l'a ouvert, quand et pourquoi.

## 8. Cookies et stockage du navigateur
Nous utilisons un cookie de session et le stockage local de votre navigateur uniquement pour le strict nécessaire : maintenir votre session, retenir votre langue et votre thème, reprendre l'entretien commencé et terminer la connexion par lien. Nous n'utilisons ni cookies d'analyse ni cookies publicitaires, ni scripts tiers.

## 9. Le consentement aux données de santé
Avant l'entretien, l'application affiche le texte de consentement aux données de santé et ne continue pas si vous ne l'acceptez pas. Si vous l'avez déjà accepté pour la version en vigueur, elle ne le redemande pas. Si ce texte change de version, il cesse de compter comme la version en vigueur et l'entretien suivant l'affiche de nouveau. Le retirer n'efface pas ce qui a déjà été traité. Sans ce consentement, l'application ne commence pas l'évaluation.
