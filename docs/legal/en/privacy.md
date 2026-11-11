## 1. Who processes the data
The service is called The Somnus. The sleep interview is called Morpheo.

## 2. What data we process
- Account data: email address, first name and surnames, date of birth, gender (you can choose “Prefer not to say”), country, language and, if you add them, city, phone number and profile photo.
- Usage data needed to keep the service secure: the session and the audit records.
- Your answers in the sleep assessment, including the text you write and, if you use the microphone, the voice of that answer.
- The guidance result and the report shown at the end.
- A record of each Morpheo assessment, under a random case number and without your name, email or account: what you were asked, what you answered and what you were shown.
- If you register as a professional: specialty, licence number, credentials and the documents you provide to be verified. If you register as a parent or guardian: the minor's age band.
- The messages we send you (access links, invitations): your email and the message.

## 3. What we use it for
To create and maintain your account, give you access, run the interview, show you the result and the report, save your assessments and protect the platform. We use gender, age, country and city to produce aggregate statistics that help us understand who uses the service; they are never used to calculate your sleep guidance. We only send you marketing communications if you give your communications consent, which is optional and can be withdrawn at any time. We do not sell your data. We keep the case record so that we can show, in the event of a claim, an audit or an authority's request, what was asked, what was answered and what was shown.

Fixed rules calculate the result of the interview. No language model scores, raises an alert, diagnoses or decides the level of care. The report you see at the end of the current interview is made of sentences that were already approved. A model does not write it.

## 4. Who else processes data
- Google Cloud, in region europe-west3 (Frankfurt): the application servers, the files, the queues and the sessions. The session stores the email and the sign-in state. Firebase Hosting serves the pages. Firebase Authentication stores the email and an account identifier for sign-in.
- TiDB Cloud: the application databases.
- Brevo, at https://api.brevo.com: the email address and the text of the message (access links and invitations). The delivery log stores the email address.
- AssemblyAI, at streaming.eu.assemblyai.com: if you dictate an answer, the browser sends the audio of your voice straight to AssemblyAI to turn it into text. The audio does not pass through our servers and we do not keep it. The text comes back to the box and you can correct it before continuing. If you say a name, a phone number, an email address or an identity number, that audio is sent too. The application asks you not to say them and, in the text, refuses those data before the answer is saved.
- OpenAI, at https://api.openai.com/v1, when the report service has a key. In this repository that address is described as processing in the United States; the European address is not configured. The current interview does not send your free-text answers to OpenAI: that service is configured with extraction off and with no key. If the older report route is called, OpenAI receives the level of care, the patterns and the protocol text, in order to write or translate an explanation. That call does not include your name, your email, your identifier or your free-text answers, and it asks that the answer not be kept as a stored platform response. To look up passages from the clinical library, OpenAI may receive already approved sentences from that library, not your answers.
- Google, in the same project and in europe-west3, when a member of staff asks: the text of an internal document, to correct it, and the text of a passage, to read it aloud at eu-texttospeech.googleapis.com. Reading aloud is on in the configuration. Translation of those documents is not. This is not part of your interview.

## 5. How long
For as long as you keep your account. Anonymous assessments that are not saved to an account are deleted after 30 days. The application session lasts 7 days; after that, the session document is deleted by its expiry time. The log of messages sent is deleted after 90 days. The case record is kept for 24 months from the day the assessment started and is then deleted. If you delete your account, or your assessment is deleted, the case record is kept for that period but is no longer linked to you. When you delete your account we also delete the sign-in account, the sessions, the profile photo, the saved assessments, the reports of those assessments stored under your name, and the messages addressed to your email. The audit record of that deletion is kept, without the text of your answers.

## 6. Your rights
You can access, rectify, erase and port your data, object to or restrict its processing, and withdraw your consents. You can also lodge a complaint with the Spanish Data Protection Agency (www.aepd.es). If you ask for your data to be erased, the case record is kept until its 24-month period ends; it will no longer be linked to you.

## 7. Security
Communications are encrypted. Photos and reports are kept in private storage. The team's internal documents are encrypted in the browser before they are saved; the service stores that ciphertext and does not hold the key that opens it. Dictation audio is not encrypted with that key: it goes to AssemblyAI. Text that a member of staff asks to have read aloud leaves that encryption and goes to Google. Only the platform's super administration can open a case record, with the case number and a written justification, and who opened it, when and why is recorded.

## 8. Cookies and browser storage
We use a session cookie and your browser's local storage only for what is strictly necessary: keeping you signed in, remembering your language and theme, resuming an interview you have started and completing sign-in by link. We use no analytics or advertising cookies and no third-party scripts.

## 9. Health-data consent
Before the interview, the application shows the health-data consent text and does not continue unless you accept it. If you already accepted it for the version in force, it does not ask again. If that text changes version, it stops counting as the version in force and the next interview shows it again. Withdrawing it does not erase processing already carried out. Without that consent the application does not start the assessment.
