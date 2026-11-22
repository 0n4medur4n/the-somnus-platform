## 1. Qui tracta les dades
El servei es diu The Somnus. L'entrevista del son es diu Morpheo.

## 2. Quines dades tractem
- Dades del compte: correu electrònic, nom i cognoms, data de naixement, gènere (pots triar «Prefereixo no dir-ho»), país, idioma i, si les afegeixes, ciutat, telèfon i foto de perfil.
- Dades d'ús necessàries per a la seguretat del servei: la sessió i els registres d'auditoria.
- Les respostes de l'avaluació del son, inclòs el text que escrius i, si fas servir el micròfon, la veu d'aquesta resposta.
- El resultat orientatiu i l'informe que es mostra en acabar.
- Un registre de cada avaluació Morpheo, sota un número de cas aleatori i sense el teu nom, correu ni compte: el que se't va preguntar, el que vas respondre i el que se't va mostrar.
- Si et registres com a professional: especialitat, número de col·legiat, credencials i la documentació que aportis per verificar-te. Si et registres com a mare, pare o tutor: la franja d'edat del menor.
- Els avisos que t'enviem (enllaços d'accés, invitacions): el teu correu i l'avís.

## 3. Per a què les fem servir
Per crear i mantenir el teu compte, donar-te accés, fer l'entrevista, mostrar-te el resultat i l'informe, desar les teves avaluacions i protegir la plataforma. Amb el gènere, l'edat, el país i la ciutat elaborem estadístiques agregades per entendre qui fa servir el servei; mai no es fan servir per calcular la teva orientació del son. Només t'enviem comunicacions comercials si dones el teu consentiment de comunicacions, que és opcional i pots retirar quan vulguis. No venem les teves dades. Conservem el registre de cas per poder mostrar, davant una reclamació, una auditoria o una autoritat, què es va preguntar, què es va respondre i què es va mostrar.

El resultat de l'entrevista el calculen regles fixes. Cap model de llenguatge no puntua, marca una alerta, diagnostica ni decideix el nivell d'atenció. L'informe que veus en acabar l'entrevista actual està fet amb frases ja aprovades. No el redacta un model.

## 4. Qui més tracta dades
- Google Cloud, a la regió europe-west3 (Frankfurt): els servidors de l'aplicació, els arxius, les cues i les sessions. La sessió desa el correu i l'estat d'accés. Firebase Hosting serveix les pàgines. Firebase Authentication desa el correu i un identificador de compte per iniciar sessió.
- TiDB Cloud: les bases de dades de l'aplicació.
- Brevo, a https://api.brevo.com: el correu i el text de l'avís (enllaços d'accés i invitacions). El registre d'enviaments desa el correu.
- AssemblyAI, a streaming.eu.assemblyai.com: si dictes una resposta, el navegador envia l'àudio de la teva veu directament a AssemblyAI per convertir-lo en text. L'àudio no passa pels nostres servidors i no el desem nosaltres. El text torna al quadre i el pots corregir abans de continuar. Si dius un nom, un telèfon, un correu o un número d'identitat, aquest àudio també s'envia. L'aplicació demana que no els diguis i, en el text, rebutja aquestes dades abans de desar la resposta.
- OpenAI, a https://api.openai.com/v1, quan el servei d'informes té clau. En aquest repositori, aquesta adreça es descriu com un tractament als Estats Units; l'adreça europea no està configurada. L'entrevista actual no envia les teves respostes lliures a OpenAI: aquest servei està configurat amb l'extracció apagada i sense clau. Si es crida la ruta antiga de l'informe, OpenAI rep el nivell d'atenció, els patrons i el text del protocol, per redactar o traduir una explicació. Aquesta crida no inclou el teu nom, el teu correu, el teu identificador ni les teves respostes lliures, i demana que la resposta no quedi desada com una resposta emmagatzemada de la plataforma. Per buscar fragments de la biblioteca clínica, OpenAI pot rebre frases ja aprovades d'aquesta biblioteca, no les teves respostes.
- Google, al mateix projecte i a europe-west3, quan un membre de l'equip ho demana: el text d'un document intern, per corregir-lo, i el text d'un passatge, per llegir-lo en veu alta a eu-texttospeech.googleapis.com. La lectura en veu alta està encesa a la configuració. La traducció d'aquests documents no ho està. Això no forma part de la teva entrevista.

## 5. Quant de temps
Mentre mantinguis el teu compte. Les avaluacions anònimes que no es desen en un compte s'eliminen als 30 dies. La sessió de l'aplicació dura 7 dies; després, el document de sessió s'esborra per la seva data de caducitat. El registre dels avisos enviats s'esborra als 90 dies. El registre de cas es conserva 24 mesos des que va començar l'avaluació i després s'elimina. Si elimines el teu compte, o si la teva avaluació s'elimina, el registre de cas es manté durant aquest termini però deixa d'estar lligat a tu. En eliminar el teu compte esborrem el compte d'accés, les sessions, la foto de perfil, les avaluacions desades, els informes d'aquestes avaluacions desats al teu nom i els avisos adreçats al teu correu. El registre d'auditoria d'aquesta eliminació es conserva, sense el text de les teves respostes.

## 6. Els teus drets
Pots accedir, rectificar, suprimir i portar les teves dades, oposar-te al seu tractament o limitar-lo i retirar els teus consentiments. També pots presentar una reclamació davant l'Agència Espanyola de Protecció de Dades (www.aepd.es). Si demanes la supressió de les teves dades, el registre de cas es manté fins que acabi el seu termini de 24 mesos; ja no estarà lligat a tu.

## 7. Seguretat
Les comunicacions van xifrades. Les fotos i els informes es desen en emmagatzematge privat. Els documents interns de l'equip es xifren al navegador abans de desar-se; el servei desa aquest xifrat i no té la clau que l'obre. L'àudio del dictat no va xifrat amb aquesta clau: va a AssemblyAI. El text que un membre de l'equip demana llegir en veu alta surt d'aquest xifrat i va a Google. Només la superadministració de la plataforma pot obrir el registre d'un cas, amb el número de cas i una justificació escrita, i queda anotat qui l'ha obert, quan i per què.

## 8. Cookies i emmagatzematge del navegador
Fem servir una cookie de sessió i l'emmagatzematge local del teu navegador només per al que és estrictament necessari: mantenir la teva sessió, recordar el teu idioma i el teu tema, reprendre l'entrevista que tinguis començada i completar l'accés per enllaç. No fem servir cookies d'analítica ni de publicitat, ni scripts de tercers.

## 9. El consentiment de les dades de salut
Abans de l'entrevista, l'aplicació mostra el text de consentiment de dades de salut i no continua si no l'acceptes. Si ja l'has acceptat sobre la versió vigent, no te'l torna a demanar. Si aquest text canvia de versió, deixa de comptar com a vigent i l'entrevista següent te'l mostra una altra vegada. Retirar-lo no esborra el que ja s'hagi tractat. Sense aquest consentiment l'aplicació no inicia l'avaluació.
