-- Privacy policy v4 and health-data processing policy v3 (ADR 0024): the case
-- record of every Morpheo interview -- what it holds, why, that it is kept 24
-- months from the day the interview started even if the interview or the
-- account is deleted (then unlinked from the person), and who can open it.
-- Each in es/en/ca/fr, as drafts for legal review, marked as such. The rest of
-- each text is the previous version's, unchanged. Inserts only: receipts given
-- against earlier versions keep pointing at them (build plan §13).
INSERT INTO `legal_document_versions` (`id`, `legal_document_id`, `version`, `locale`, `content`) VALUES
  ('019fe7a0-0015-7000-8000-000000000015', '019f9452-3938-7296-b556-0f0ee4ff0c7c', 4, 'es', 'BORRADOR PENDIENTE DE REVISIÓN LEGAL. Este texto es una versión de trabajo para el entorno de pruebas y será sustituido por la versión aprobada antes del lanzamiento.

## 1. Responsable del tratamiento
[Entidad responsable, domicilio, contacto y, en su caso, delegado de protección de datos: pendiente de completar por el área legal.]

## 2. Qué datos tratamos
- Datos de cuenta: correo electrónico, nombre y apellidos, fecha de nacimiento, género (puedes elegir «Prefiero no decirlo»), país, idioma y, si los añades, ciudad, teléfono y foto de perfil.
- Datos de uso necesarios para la seguridad del servicio: sesión, registros técnicos y de auditoría.
- Las respuestas de la evaluación del sueño se tratan aparte y solo con tu consentimiento expreso para datos de salud.
- Un registro de cada evaluación Morpheo, bajo un número de caso aleatorio y sin tu nombre, correo ni cuenta: lo que se te preguntó, lo que respondiste y lo que se te mostró.

## 3. Para qué los usamos
Para crear y mantener tu cuenta, darte acceso, mostrarte tus evaluaciones guardadas y proteger la plataforma. Con el género, la edad, el país y la ciudad elaboramos estadísticas agregadas para entender quién usa el servicio; nunca se usan para calcular tu orientación del sueño. Solo te enviamos comunicaciones comerciales si das tu consentimiento de comunicaciones, que es opcional y puedes retirar cuando quieras. No vendemos tus datos. Conservamos el registro de caso para poder acreditar, ante una reclamación, una auditoría o una autoridad, qué se preguntó, qué se respondió y qué se mostró.

## 4. Base legal
La ejecución del servicio que solicitas y, para los datos de salud, tu consentimiento explícito, que puedes retirar en cualquier momento. El registro de caso se conserva para la formulación, el ejercicio o la defensa de reclamaciones. [Base jurídica concreta: pendiente de confirmar por el área legal.]

## 5. Dónde se guardan y quién los trata
En proveedores de infraestructura en la Unión Europea (Google Cloud, región de Fráncfort). [Lista completa de encargados del tratamiento: pendiente de revisión legal.]

## 6. Cuánto tiempo
Mientras mantengas tu cuenta. Las evaluaciones anónimas que no se guardan en una cuenta se eliminan a los 30 días. Si eliminas tu cuenta, borramos tus datos salvo lo que la ley nos obligue a conservar. El registro de caso se conserva 24 meses desde que empezó la evaluación y después se elimina. Si eliminas tu cuenta, o si tu evaluación se elimina, el registro se mantiene durante ese plazo pero deja de estar ligado a ti; mientras tu evaluación siga guardada en tu cuenta, el registro sigue ligado a ella dentro del sistema.

## 7. Tus derechos
Puedes acceder, rectificar, suprimir y portar tus datos, oponerte o limitar su tratamiento y retirar tus consentimientos. También puedes reclamar ante la Agencia Española de Protección de Datos (www.aepd.es). Si pides la supresión de tus datos, el registro de caso se mantiene hasta que acabe su plazo de 24 meses, porque sirve para defender reclamaciones; ya no estará ligado a ti. [Fundamento legal: pendiente de confirmar por el área legal.]

## 8. Seguridad
Las comunicaciones van cifradas, las fotos y los informes se guardan en almacenamiento privado y el personal de soporte no ve tus respuestas de salud salvo en casos justificados y registrados. Solo la superadministración de la plataforma puede abrir el registro de un caso, con el número de caso y una justificación escrita, y queda anotado quién lo abrió, cuándo y por qué.'),
  ('019fe7a0-0016-7000-8000-000000000016', '019f9452-3938-7296-b556-0f0ee4ff0c7c', 4, 'en', 'DRAFT PENDING LEGAL REVIEW. This text is a working version for the test environment and will be replaced by the approved version before launch.

## 1. Data controller
[Responsible entity, address, contact details and, where applicable, data protection officer: to be completed by the legal team.]

## 2. What data we process
- Account data: email address, first name and surnames, date of birth, gender (you can choose “Prefer not to say”), country, language and, if you add them, city, phone number and profile photo.
- Usage data needed to keep the service secure: session, technical and audit logs.
- Your answers to the sleep assessment are handled separately and only with your explicit consent for health data.
- A record of each Morpheo assessment, under a random case number and without your name, email or account: what you were asked, what you answered and what you were shown.

## 3. What we use it for
To create and maintain your account, give you access, show you your saved assessments and protect the platform. We use gender, age, country and city to produce aggregate statistics that help us understand who uses the service; they are never used to calculate your sleep guidance. We only send you marketing communications if you give your communications consent, which is optional and can be withdrawn at any time. We do not sell your data. We keep the case record so that we can show, in the event of a claim, an audit or an authority''s request, what was asked, what was answered and what was shown.

## 4. Legal basis
Performance of the service you request and, for health data, your explicit consent, which you can withdraw at any time. The case record is kept for the establishment, exercise or defence of legal claims. [Specific legal basis: to be confirmed by the legal team.]

## 5. Where it is stored and who processes it
With infrastructure providers in the European Union (Google Cloud, Frankfurt region). [Full list of data processors: pending legal review.]

## 6. How long
For as long as you keep your account. Anonymous assessments that are not saved to an account are deleted after 30 days. If you delete your account, we erase your data except what the law requires us to keep. The case record is kept for 24 months from the day the assessment started and is then deleted. If you delete your account, or your assessment is deleted, the record is kept for that period but is no longer linked to you; while your assessment stays saved in your account, the record remains linked to it inside the system.

## 7. Your rights
You can access, rectify, erase and port your data, object to or restrict its processing, and withdraw your consents. You can also lodge a complaint with the Spanish Data Protection Agency (www.aepd.es). If you ask for your data to be erased, the case record is kept until its 24-month period ends, because it serves to defend legal claims; it will no longer be linked to you. [Legal grounds: to be confirmed by the legal team.]

## 8. Security
Communications are encrypted, photos and reports are kept in private storage, and support staff do not see your health answers except in justified and recorded cases. Only the platform''s super administration can open a case record, with the case number and a written justification, and who opened it, when and why is recorded.'),
  ('019fe7a0-0017-7000-8000-000000000017', '019f9452-3938-7296-b556-0f0ee4ff0c7c', 4, 'ca', 'ESBORRANY PENDENT DE REVISIÓ LEGAL. Aquest text és una versió de treball per a l''entorn de proves i se substituirà per la versió aprovada abans del llançament.

## 1. Responsable del tractament
[Entitat responsable, domicili, contacte i, si escau, delegat de protecció de dades: pendent de completar per l''àrea legal.]

## 2. Quines dades tractem
- Dades del compte: correu electrònic, nom i cognoms, data de naixement, gènere (pots triar «Prefereixo no dir-ho»), país, idioma i, si les afegeixes, ciutat, telèfon i foto de perfil.
- Dades d''ús necessàries per a la seguretat del servei: sessió, registres tècnics i d''auditoria.
- Les respostes de l''avaluació del son es tracten a part i només amb el teu consentiment exprés per a dades de salut.
- Un registre de cada avaluació Morpheo, sota un número de cas aleatori i sense el teu nom, correu ni compte: el que se''t va preguntar, el que vas respondre i el que se''t va mostrar.

## 3. Per a què les fem servir
Per crear i mantenir el teu compte, donar-te accés, mostrar-te les teves avaluacions desades i protegir la plataforma. Amb el gènere, l''edat, el país i la ciutat elaborem estadístiques agregades per entendre qui fa servir el servei; mai no es fan servir per calcular la teva orientació del son. Només t''enviem comunicacions comercials si dones el teu consentiment de comunicacions, que és opcional i pots retirar quan vulguis. No venem les teves dades. Conservem el registre de cas per poder acreditar, davant una reclamació, una auditoria o una autoritat, què es va preguntar, què es va respondre i què es va mostrar.

## 4. Base legal
L''execució del servei que sol·licites i, per a les dades de salut, el teu consentiment explícit, que pots retirar en qualsevol moment. El registre de cas es conserva per a la formulació, l''exercici o la defensa de reclamacions. [Base jurídica concreta: pendent de confirmar per l''àrea legal.]

## 5. On es desen i qui les tracta
En proveïdors d''infraestructura a la Unió Europea (Google Cloud, regió de Frankfurt). [Llista completa d''encarregats del tractament: pendent de revisió legal.]

## 6. Quant de temps
Mentre mantinguis el teu compte. Les avaluacions anònimes que no es desen en un compte s''eliminen als 30 dies. Si elimines el teu compte, esborrem les teves dades excepte el que la llei ens obligui a conservar. El registre de cas es conserva 24 mesos des que va començar l''avaluació i després s''elimina. Si elimines el teu compte, o si la teva avaluació s''elimina, el registre es manté durant aquest termini però deixa d''estar lligat a tu; mentre la teva avaluació continuï desada al teu compte, el registre continua lligat a ella dins del sistema.

## 7. Els teus drets
Pots accedir, rectificar, suprimir i portar les teves dades, oposar-te al seu tractament o limitar-lo i retirar els teus consentiments. També pots presentar una reclamació davant l''Agència Espanyola de Protecció de Dades (www.aepd.es). Si demanes la supressió de les teves dades, el registre de cas es manté fins que acabi el seu termini de 24 mesos, perquè serveix per defensar reclamacions; ja no estarà lligat a tu. [Fonament legal: pendent de confirmar per l''àrea legal.]

## 8. Seguretat
Les comunicacions van xifrades, les fotos i els informes es desen en emmagatzematge privat i el personal de suport no veu les teves respostes de salut excepte en casos justificats i registrats. Només la superadministració de la plataforma pot obrir el registre d''un cas, amb el número de cas i una justificació escrita, i queda anotat qui l''ha obert, quan i per què.'),
  ('019fe7a0-0018-7000-8000-000000000018', '019f9452-3938-7296-b556-0f0ee4ff0c7c', 4, 'fr', 'PROJET EN ATTENTE DE RÉVISION JURIDIQUE. Ce texte est une version de travail pour l''environnement de test et sera remplacé par la version approuvée avant le lancement.

## 1. Responsable du traitement
[Entité responsable, adresse, coordonnées et, le cas échéant, délégué à la protection des données : à compléter par le service juridique.]

## 2. Quelles données nous traitons
- Données de compte : adresse e-mail, prénom et nom, date de naissance, genre (vous pouvez choisir « Je préfère ne pas le dire »), pays, langue et, si vous les ajoutez, ville, téléphone et photo de profil.
- Données d''utilisation nécessaires à la sécurité du service : session, journaux techniques et d''audit.
- Les réponses à l''évaluation du sommeil sont traitées à part et uniquement avec votre consentement explicite pour les données de santé.
- Un enregistrement de chaque évaluation Morpheo, sous un numéro de dossier aléatoire et sans votre nom, votre e-mail ni votre compte : ce qui vous a été demandé, ce que vous avez répondu et ce qui vous a été montré.

## 3. À quoi elles servent
À créer et gérer votre compte, vous donner accès, vous montrer vos évaluations enregistrées et protéger la plateforme. Le genre, l''âge, le pays et la ville nous servent à établir des statistiques agrégées pour comprendre qui utilise le service ; ils ne servent jamais à calculer votre orientation sur le sommeil. Nous ne vous envoyons des communications commerciales que si vous donnez votre consentement aux communications, qui est facultatif et révocable à tout moment. Nous ne vendons pas vos données. Nous conservons l''enregistrement du dossier afin de pouvoir établir, en cas de réclamation, d''audit ou de demande d''une autorité, ce qui a été demandé, ce qui a été répondu et ce qui a été montré.

## 4. Base juridique
L''exécution du service que vous demandez et, pour les données de santé, votre consentement explicite, que vous pouvez retirer à tout moment. L''enregistrement du dossier est conservé pour la constatation, l''exercice ou la défense de droits en justice. [Base juridique précise : à confirmer par le service juridique.]

## 5. Où elles sont conservées et qui les traite
Chez des fournisseurs d''infrastructure dans l''Union européenne (Google Cloud, région de Francfort). [Liste complète des sous-traitants : en attente de révision juridique.]

## 6. Combien de temps
Tant que vous conservez votre compte. Les évaluations anonymes qui ne sont pas enregistrées dans un compte sont supprimées au bout de 30 jours. Si vous supprimez votre compte, nous effaçons vos données, sauf ce que la loi nous oblige à conserver. L''enregistrement du dossier est conservé 24 mois à compter du début de l''évaluation, puis supprimé. Si vous supprimez votre compte, ou si votre évaluation est supprimée, l''enregistrement est conservé pendant ce délai mais n''est plus lié à vous ; tant que votre évaluation reste enregistrée dans votre compte, l''enregistrement reste lié à celle-ci à l''intérieur du système.

## 7. Vos droits
Vous pouvez accéder à vos données, les rectifier, les effacer et les récupérer, vous opposer à leur traitement ou le limiter, et retirer vos consentements. Vous pouvez aussi introduire une réclamation auprès de l''Agence espagnole de protection des données (www.aepd.es). Si vous demandez l''effacement de vos données, l''enregistrement du dossier est conservé jusqu''à la fin de son délai de 24 mois, car il sert à défendre des droits en justice ; il ne sera plus lié à vous. [Fondement juridique : à confirmer par le service juridique.]

## 8. Sécurité
Les communications sont chiffrées, les photos et les rapports sont conservés dans un stockage privé et le personnel d''assistance ne voit pas vos réponses de santé, sauf dans des cas justifiés et enregistrés. Seule la super-administration de la plateforme peut ouvrir l''enregistrement d''un dossier, avec le numéro de dossier et une justification écrite ; il est noté qui l''a ouvert, quand et pourquoi.'),
  ('019fe7a0-0019-7000-8000-000000000019', '019f9452-3939-77df-baca-8bb8440f7075', 3, 'es', 'BORRADOR PENDIENTE DE REVISIÓN LEGAL. Este texto es una versión de trabajo para el entorno de pruebas y será sustituido por la versión aprobada antes del lanzamiento.

## Consentimiento para el tratamiento de datos de salud

Al aceptar este documento autorizas a The Somnus a tratar las respuestas que des en la evaluación del sueño Morpheo. Estas respuestas son datos de salud y se protegen con garantías reforzadas.

## Qué datos
Tus respuestas a las preguntas de seguridad y a los motivos de consulta, y el resultado orientativo que se calcula a partir de ellas. Si la evaluación es sobre un menor a tu cargo, las respuestas se refieren a ese menor. Además, guardamos un registro de la evaluación bajo un número de caso aleatorio, que verás junto a tu resultado: contiene lo que se te preguntó, lo que respondiste y lo que se te mostró, y no incluye tu nombre, tu correo ni tu cuenta.

## Para qué
Únicamente para calcular tu orientación, mostrártela y guardarla en tu cuenta para que puedas consultarla después. El resultado lo calculan reglas clínicas fijas; ningún sistema de inteligencia artificial decide tu nivel de atención.

## Qué no hacemos
No compartimos tus respuestas con terceros, no las usamos para publicidad y no se las mostramos a ningún profesional sin tu permiso expreso. La única excepción es el registro de caso, sin tu identidad: la superadministración de la plataforma puede abrirlo, con una justificación escrita que queda registrada, para atender una reclamación o una auditoría.

## Cuánto tiempo
Mientras mantengas tu cuenta. Si no guardas una evaluación en tu cuenta, se elimina a los 30 días. Además, el registro de caso se conserva 24 meses desde que empezó la evaluación y después se elimina. Se mantiene aunque se borre tu evaluación o tu cuenta, pero entonces ya no está ligado a ti.

## Tu derecho a retirarlo
Este consentimiento es voluntario. Puedes retirarlo en cualquier momento desde "Mis consentimientos"; retirarlo no afecta a lo tratado antes. Sin este consentimiento no podemos hacer la evaluación. Retirarlo no borra el registro de caso antes de que acabe ese plazo de 24 meses.

## Limitaciones
Morpheo no es un diagnóstico. Ante una urgencia, llama al 112.'),
  ('019fe7a0-001a-7000-8000-00000000001a', '019f9452-3939-77df-baca-8bb8440f7075', 3, 'en', 'DRAFT PENDING LEGAL REVIEW. This text is a working version for the test environment and will be replaced by the approved version before launch.

## Consent to the processing of health data

By accepting this document you authorise The Somnus to process the answers you give in the Morpheo sleep assessment. These answers are health data and are protected with enhanced safeguards.

## What data
Your answers to the safety questions and about your reasons for seeking help, and the guidance result calculated from them. If the assessment is about a minor in your care, the answers refer to that minor. We also keep a record of the assessment under a random case number, which you will see next to your result: it contains what you were asked, what you answered and what you were shown, and it does not include your name, your email or your account.

## What for
Solely to calculate your guidance, show it to you and save it in your account so you can look at it later. The result is calculated by fixed clinical rules; no artificial intelligence system decides your level of care.

## What we do not do
We do not share your answers with third parties, we do not use them for advertising and we do not show them to any professional without your express permission. The only exception is the case record, without your identity: the platform''s super administration may open it, with a written justification that is recorded, to deal with a claim or an audit.

## How long
For as long as you keep your account. If you do not save an assessment to your account, it is deleted after 30 days. The case record is also kept for 24 months from the day the assessment started and is then deleted. It is kept even if your assessment or your account is deleted, but it is then no longer linked to you.

## Your right to withdraw it
This consent is voluntary. You can withdraw it at any time from "My consents"; withdrawing it does not affect processing carried out before. Without this consent we cannot carry out the assessment. Withdrawing it does not delete the case record before that 24-month period ends.

## Limitations
Morpheo is not a diagnosis. In an emergency, call 112.'),
  ('019fe7a0-001b-7000-8000-00000000001b', '019f9452-3939-77df-baca-8bb8440f7075', 3, 'ca', 'ESBORRANY PENDENT DE REVISIÓ LEGAL. Aquest text és una versió de treball per a l''entorn de proves i se substituirà per la versió aprovada abans del llançament.

## Consentiment per al tractament de dades de salut

En acceptar aquest document autoritzes The Somnus a tractar les respostes que donis a l''avaluació del son Morpheo. Aquestes respostes són dades de salut i es protegeixen amb garanties reforçades.

## Quines dades
Les teves respostes a les preguntes de seguretat i als motius de consulta, i el resultat orientatiu que se''n calcula. Si l''avaluació és sobre un menor al teu càrrec, les respostes es refereixen a aquest menor. A més, desem un registre de l''avaluació sota un número de cas aleatori, que veuràs al costat del teu resultat: conté el que se''t va preguntar, el que vas respondre i el que se''t va mostrar, i no inclou el teu nom, el teu correu ni el teu compte.

## Per a què
Únicament per calcular la teva orientació, mostrar-te-la i desar-la al teu compte perquè la puguis consultar després. El resultat el calculen regles clíniques fixes; cap sistema d''intel·ligència artificial no decideix el teu nivell d''atenció.

## Què no fem
No compartim les teves respostes amb tercers, no les fem servir per a publicitat i no les mostrem a cap professional sense el teu permís exprés. L''única excepció és el registre de cas, sense la teva identitat: la superadministració de la plataforma el pot obrir, amb una justificació escrita que queda registrada, per atendre una reclamació o una auditoria.

## Quant de temps
Mentre mantinguis el teu compte. Si no deses una avaluació al teu compte, s''elimina als 30 dies. A més, el registre de cas es conserva 24 mesos des que va començar l''avaluació i després s''elimina. Es manté tot i que s''esborri la teva avaluació o el teu compte, però aleshores ja no està lligat a tu.

## El teu dret a retirar-lo
Aquest consentiment és voluntari. El pots retirar en qualsevol moment des d''"Els meus consentiments"; retirar-lo no afecta el que s''hagi tractat abans. Sense aquest consentiment no podem fer l''avaluació. Retirar-lo no esborra el registre de cas abans que acabi aquest termini de 24 mesos.

## Limitacions
Morpheo no és un diagnòstic. Davant d''una urgència, truca al 112.'),
  ('019fe7a0-001c-7000-8000-00000000001c', '019f9452-3939-77df-baca-8bb8440f7075', 3, 'fr', 'PROJET EN ATTENTE DE RÉVISION JURIDIQUE. Ce texte est une version de travail pour l''environnement de test et sera remplacé par la version approuvée avant le lancement.

## Consentement au traitement des données de santé

En acceptant ce document, vous autorisez The Somnus à traiter les réponses que vous donnez lors de l''évaluation du sommeil Morpheo. Ces réponses sont des données de santé et bénéficient de garanties renforcées.

## Quelles données
Vos réponses aux questions de sécurité et sur les motifs de consultation, ainsi que le résultat d''orientation calculé à partir de celles-ci. Si l''évaluation concerne un mineur à votre charge, les réponses se rapportent à ce mineur. Nous conservons aussi un enregistrement de l''évaluation sous un numéro de dossier aléatoire, que vous verrez à côté de votre résultat : il contient ce qui vous a été demandé, ce que vous avez répondu et ce qui vous a été montré, et il n''inclut ni votre nom, ni votre e-mail, ni votre compte.

## Dans quel but
Uniquement pour calculer votre orientation, vous la montrer et l''enregistrer dans votre compte afin que vous puissiez la consulter plus tard. Le résultat est calculé par des règles cliniques fixes ; aucun système d''intelligence artificielle ne décide de votre niveau de prise en charge.

## Ce que nous ne faisons pas
Nous ne partageons pas vos réponses avec des tiers, nous ne les utilisons pas à des fins publicitaires et nous ne les montrons à aucun professionnel sans votre autorisation expresse. La seule exception est l''enregistrement du dossier, sans votre identité : la super-administration de la plateforme peut l''ouvrir, avec une justification écrite qui est consignée, pour traiter une réclamation ou un audit.

## Combien de temps
Tant que vous conservez votre compte. Si vous n''enregistrez pas une évaluation dans votre compte, elle est supprimée au bout de 30 jours. L''enregistrement du dossier est aussi conservé 24 mois à compter du début de l''évaluation, puis supprimé. Il est conservé même si votre évaluation ou votre compte est supprimé, mais il n''est alors plus lié à vous.

## Votre droit de le retirer
Ce consentement est volontaire. Vous pouvez le retirer à tout moment depuis « Mes consentements » ; le retrait n''affecte pas les traitements effectués auparavant. Sans ce consentement, nous ne pouvons pas réaliser l''évaluation. Le retrait ne supprime pas l''enregistrement du dossier avant la fin de ce délai de 24 mois.

## Limites
Morpheo n''est pas un diagnostic. En cas d''urgence, appelez le 112.');
