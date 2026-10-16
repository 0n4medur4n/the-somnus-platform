-- Version 3 of the privacy policy (adds gender, country and city, asked at
-- registration, and what they are used for) and of the marketing consent
-- (until now only a placeholder), each in es/en/ca/fr. Drafts for legal
-- review, marked as such. Inserts only: receipts given against v2 keep
-- pointing at v2 (build plan §13).
INSERT INTO `legal_document_versions` (`id`, `legal_document_id`, `version`, `locale`, `content`) VALUES
  ('019fe7a0-000d-7000-8000-00000000000d', '019f9452-3938-7296-b556-0f0ee4ff0c7c', 3, 'es', 'BORRADOR PENDIENTE DE REVISIÓN LEGAL. Este texto es una versión de trabajo para el entorno de pruebas y será sustituido por la versión aprobada antes del lanzamiento.

## 1. Responsable del tratamiento
[Entidad responsable, domicilio, contacto y, en su caso, delegado de protección de datos: pendiente de completar por el área legal.]

## 2. Qué datos tratamos
- Datos de cuenta: correo electrónico, nombre y apellidos, fecha de nacimiento, género (puedes elegir «Prefiero no decirlo»), país, idioma y, si los añades, ciudad, teléfono y foto de perfil.
- Datos de uso necesarios para la seguridad del servicio: sesión, registros técnicos y de auditoría.
- Las respuestas de la evaluación del sueño se tratan aparte y solo con tu consentimiento expreso para datos de salud.

## 3. Para qué los usamos
Para crear y mantener tu cuenta, darte acceso, mostrarte tus evaluaciones guardadas y proteger la plataforma. Con el género, la edad, el país y la ciudad elaboramos estadísticas agregadas para entender quién usa el servicio; nunca se usan para calcular tu orientación del sueño. Solo te enviamos comunicaciones comerciales si das tu consentimiento de comunicaciones, que es opcional y puedes retirar cuando quieras. No vendemos tus datos.

## 4. Base legal
La ejecución del servicio que solicitas y, para los datos de salud, tu consentimiento explícito, que puedes retirar en cualquier momento.

## 5. Dónde se guardan y quién los trata
En proveedores de infraestructura en la Unión Europea (Google Cloud, región de Fráncfort). [Lista completa de encargados del tratamiento: pendiente de revisión legal.]

## 6. Cuánto tiempo
Mientras mantengas tu cuenta. Las evaluaciones anónimas que no se guardan en una cuenta se eliminan a los 30 días. Si eliminas tu cuenta, borramos tus datos salvo lo que la ley nos obligue a conservar.

## 7. Tus derechos
Puedes acceder, rectificar, suprimir y portar tus datos, oponerte o limitar su tratamiento y retirar tus consentimientos. También puedes reclamar ante la Agencia Española de Protección de Datos (www.aepd.es).

## 8. Seguridad
Las comunicaciones van cifradas, las fotos y los informes se guardan en almacenamiento privado y el personal de soporte no ve tus respuestas de salud salvo en casos justificados y registrados.'),
  ('019fe7a0-000e-7000-8000-00000000000e', '019f9452-3938-7296-b556-0f0ee4ff0c7c', 3, 'en', 'DRAFT PENDING LEGAL REVIEW. This text is a working version for the test environment and will be replaced by the approved version before launch.

## 1. Data controller
[Responsible entity, address, contact details and, where applicable, data protection officer: to be completed by the legal team.]

## 2. What data we process
- Account data: email address, first name and surnames, date of birth, gender (you can choose “Prefer not to say”), country, language and, if you add them, city, phone number and profile photo.
- Usage data needed to keep the service secure: session, technical and audit logs.
- Your answers to the sleep assessment are handled separately and only with your explicit consent for health data.

## 3. What we use it for
To create and maintain your account, give you access, show you your saved assessments and protect the platform. We use gender, age, country and city to produce aggregate statistics that help us understand who uses the service; they are never used to calculate your sleep guidance. We only send you marketing communications if you give your communications consent, which is optional and can be withdrawn at any time. We do not sell your data.

## 4. Legal basis
Performance of the service you request and, for health data, your explicit consent, which you can withdraw at any time.

## 5. Where it is stored and who processes it
With infrastructure providers in the European Union (Google Cloud, Frankfurt region). [Full list of data processors: pending legal review.]

## 6. How long
For as long as you keep your account. Anonymous assessments that are not saved to an account are deleted after 30 days. If you delete your account, we erase your data except what the law requires us to keep.

## 7. Your rights
You can access, rectify, erase and port your data, object to or restrict its processing, and withdraw your consents. You can also lodge a complaint with the Spanish Data Protection Agency (www.aepd.es).

## 8. Security
Communications are encrypted, photos and reports are kept in private storage, and support staff do not see your health answers except in justified and recorded cases.'),
  ('019fe7a0-000f-7000-8000-00000000000f', '019f9452-3938-7296-b556-0f0ee4ff0c7c', 3, 'ca', 'ESBORRANY PENDENT DE REVISIÓ LEGAL. Aquest text és una versió de treball per a l''entorn de proves i se substituirà per la versió aprovada abans del llançament.

## 1. Responsable del tractament
[Entitat responsable, domicili, contacte i, si escau, delegat de protecció de dades: pendent de completar per l''àrea legal.]

## 2. Quines dades tractem
- Dades del compte: correu electrònic, nom i cognoms, data de naixement, gènere (pots triar «Prefereixo no dir-ho»), país, idioma i, si les afegeixes, ciutat, telèfon i foto de perfil.
- Dades d''ús necessàries per a la seguretat del servei: sessió, registres tècnics i d''auditoria.
- Les respostes de l''avaluació del son es tracten a part i només amb el teu consentiment exprés per a dades de salut.

## 3. Per a què les fem servir
Per crear i mantenir el teu compte, donar-te accés, mostrar-te les teves avaluacions desades i protegir la plataforma. Amb el gènere, l''edat, el país i la ciutat elaborem estadístiques agregades per entendre qui fa servir el servei; mai no es fan servir per calcular la teva orientació del son. Només t''enviem comunicacions comercials si dones el teu consentiment de comunicacions, que és opcional i pots retirar quan vulguis. No venem les teves dades.

## 4. Base legal
L''execució del servei que sol·licites i, per a les dades de salut, el teu consentiment explícit, que pots retirar en qualsevol moment.

## 5. On es desen i qui les tracta
En proveïdors d''infraestructura a la Unió Europea (Google Cloud, regió de Frankfurt). [Llista completa d''encarregats del tractament: pendent de revisió legal.]

## 6. Quant de temps
Mentre mantinguis el teu compte. Les avaluacions anònimes que no es desen en un compte s''eliminen als 30 dies. Si elimines el teu compte, esborrem les teves dades excepte el que la llei ens obligui a conservar.

## 7. Els teus drets
Pots accedir, rectificar, suprimir i portar les teves dades, oposar-te al seu tractament o limitar-lo i retirar els teus consentiments. També pots presentar una reclamació davant l''Agència Espanyola de Protecció de Dades (www.aepd.es).

## 8. Seguretat
Les comunicacions van xifrades, les fotos i els informes es desen en emmagatzematge privat i el personal de suport no veu les teves respostes de salut excepte en casos justificats i registrats.'),
  ('019fe7a0-0010-7000-8000-000000000010', '019f9452-3938-7296-b556-0f0ee4ff0c7c', 3, 'fr', 'PROJET EN ATTENTE DE RÉVISION JURIDIQUE. Ce texte est une version de travail pour l''environnement de test et sera remplacé par la version approuvée avant le lancement.

## 1. Responsable du traitement
[Entité responsable, adresse, coordonnées et, le cas échéant, délégué à la protection des données : à compléter par le service juridique.]

## 2. Quelles données nous traitons
- Données de compte : adresse e-mail, prénom et nom, date de naissance, genre (vous pouvez choisir « Je préfère ne pas le dire »), pays, langue et, si vous les ajoutez, ville, téléphone et photo de profil.
- Données d''utilisation nécessaires à la sécurité du service : session, journaux techniques et d''audit.
- Les réponses à l''évaluation du sommeil sont traitées à part et uniquement avec votre consentement explicite pour les données de santé.

## 3. À quoi elles servent
À créer et gérer votre compte, vous donner accès, vous montrer vos évaluations enregistrées et protéger la plateforme. Le genre, l''âge, le pays et la ville nous servent à établir des statistiques agrégées pour comprendre qui utilise le service ; ils ne servent jamais à calculer votre orientation sur le sommeil. Nous ne vous envoyons des communications commerciales que si vous donnez votre consentement aux communications, qui est facultatif et révocable à tout moment. Nous ne vendons pas vos données.

## 4. Base juridique
L''exécution du service que vous demandez et, pour les données de santé, votre consentement explicite, que vous pouvez retirer à tout moment.

## 5. Où elles sont conservées et qui les traite
Chez des fournisseurs d''infrastructure dans l''Union européenne (Google Cloud, région de Francfort). [Liste complète des sous-traitants : en attente de révision juridique.]

## 6. Combien de temps
Tant que vous conservez votre compte. Les évaluations anonymes qui ne sont pas enregistrées dans un compte sont supprimées au bout de 30 jours. Si vous supprimez votre compte, nous effaçons vos données, sauf ce que la loi nous oblige à conserver.

## 7. Vos droits
Vous pouvez accéder à vos données, les rectifier, les effacer et les récupérer, vous opposer à leur traitement ou le limiter, et retirer vos consentements. Vous pouvez aussi introduire une réclamation auprès de l''Agence espagnole de protection des données (www.aepd.es).

## 8. Sécurité
Les communications sont chiffrées, les photos et les rapports sont conservés dans un stockage privé et le personnel d''assistance ne voit pas vos réponses de santé, sauf dans des cas justifiés et enregistrés.'),
  ('019fe7a0-0011-7000-8000-000000000011', '019f9452-3939-77df-baca-a0653d2b551a', 3, 'es', 'BORRADOR PENDIENTE DE REVISIÓN LEGAL. Este texto es una versión de trabajo para el entorno de pruebas y será sustituido por la versión aprobada antes del lanzamiento.

## Consentimiento para recibir comunicaciones

Al aceptar este documento autorizas a The Somnus a enviarte por correo electrónico novedades del servicio, contenidos sobre el sueño y ofertas propias.

## Qué datos usamos
Tu correo electrónico, tu nombre y tu idioma, y, para elegir qué te puede interesar, tu país, tu ciudad, tu edad y tu género. Nunca usamos tus respuestas de la evaluación del sueño ni ningún otro dato de salud.

## Es opcional
No aceptar este consentimiento no cambia nada en tu cuenta ni en tus evaluaciones. Puedes retirarlo cuando quieras desde «Mis consentimientos» o con el enlace de baja de cada correo.

## Con quién
Los correos se envían a través de nuestro proveedor de envío de correo electrónico. No cedemos tus datos a terceros para sus propias comunicaciones. [Proveedor y garantías: pendiente de revisión legal.]'),
  ('019fe7a0-0012-7000-8000-000000000012', '019f9452-3939-77df-baca-a0653d2b551a', 3, 'en', 'DRAFT PENDING LEGAL REVIEW. This text is a working version for the test environment and will be replaced by the approved version before launch.

## Consent to receive communications

By accepting this document you authorise The Somnus to send you news about the service, content about sleep and its own offers by email.

## What data we use
Your email address, your name and your language, and, to choose what may interest you, your country, city, age and gender. We never use your sleep assessment answers or any other health data.

## It is optional
Not accepting this consent changes nothing in your account or your assessments. You can withdraw it at any time from “My consents” or with the unsubscribe link in every email.

## With whom
Emails are sent through our email delivery provider. We do not share your data with third parties for their own communications. [Provider and safeguards: pending legal review.]'),
  ('019fe7a0-0013-7000-8000-000000000013', '019f9452-3939-77df-baca-a0653d2b551a', 3, 'ca', 'ESBORRANY PENDENT DE REVISIÓ LEGAL. Aquest text és una versió de treball per a l''entorn de proves i se substituirà per la versió aprovada abans del llançament.

## Consentiment per rebre comunicacions

En acceptar aquest document autoritzes The Somnus a enviar-te per correu electrònic novetats del servei, continguts sobre el son i ofertes pròpies.

## Quines dades fem servir
El teu correu electrònic, el teu nom i el teu idioma, i, per triar què et pot interessar, el teu país, la teva ciutat, la teva edat i el teu gènere. Mai no fem servir les respostes de l''avaluació del son ni cap altra dada de salut.

## És opcional
No acceptar aquest consentiment no canvia res al teu compte ni a les teves avaluacions. El pots retirar quan vulguis des d''«Els meus consentiments» o amb l''enllaç de baixa de cada correu.

## Amb qui
Els correus s''envien a través del nostre proveïdor d''enviament de correu electrònic. No cedim les teves dades a tercers per a les seves pròpies comunicacions. [Proveïdor i garanties: pendent de revisió legal.]'),
  ('019fe7a0-0014-7000-8000-000000000014', '019f9452-3939-77df-baca-a0653d2b551a', 3, 'fr', 'PROJET EN ATTENTE DE RÉVISION JURIDIQUE. Ce texte est une version de travail pour l''environnement de test et sera remplacé par la version approuvée avant le lancement.

## Consentement à recevoir des communications

En acceptant ce document, vous autorisez The Somnus à vous envoyer par e-mail des nouvelles du service, des contenus sur le sommeil et ses propres offres.

## Quelles données nous utilisons
Votre adresse e-mail, votre nom et votre langue, et, pour choisir ce qui peut vous intéresser, votre pays, votre ville, votre âge et votre genre. Nous n''utilisons jamais vos réponses à l''évaluation du sommeil ni aucune autre donnée de santé.

## C''est facultatif
Ne pas accepter ce consentement ne change rien à votre compte ni à vos évaluations. Vous pouvez le retirer à tout moment depuis « Mes consentements » ou avec le lien de désinscription présent dans chaque e-mail.

## Avec qui
Les e-mails sont envoyés par l''intermédiaire de notre prestataire d''envoi d''e-mails. Nous ne cédons pas vos données à des tiers pour leurs propres communications. [Prestataire et garanties : en attente de révision juridique.]');
