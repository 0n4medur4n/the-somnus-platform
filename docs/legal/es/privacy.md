## 1. Quién trata los datos
El servicio se llama The Somnus. La entrevista de sueño se llama Morpheo.

## 2. Qué datos tratamos
- Datos de cuenta: correo electrónico, nombre y apellidos, fecha de nacimiento, género (puedes elegir «Prefiero no decirlo»), país, idioma y, si los añades, ciudad, teléfono y foto de perfil.
- Datos de uso necesarios para la seguridad del servicio: la sesión y los registros de auditoría.
- Las respuestas de la evaluación del sueño, incluido el texto que escribes y, si usas el micrófono, la voz de esa respuesta.
- El resultado orientativo y el informe que se muestra al terminar.
- Un registro de cada evaluación Morpheo, bajo un número de caso aleatorio y sin tu nombre, correo ni cuenta: lo que se te preguntó, lo que respondiste y lo que se te mostró.
- Si te registras como profesional: especialidad, número de colegiado, credenciales y la documentación que aportes para verificarte. Si te registras como madre, padre o tutor: la franja de edad del menor.
- Los avisos que te enviamos (enlaces de acceso, invitaciones): tu correo y el aviso.

## 3. Para qué los usamos
Para crear y mantener tu cuenta, darte acceso, hacer la entrevista, mostrarte el resultado y el informe, guardar tus evaluaciones y proteger la plataforma. Con el género, la edad, el país y la ciudad elaboramos estadísticas agregadas para entender quién usa el servicio; nunca se usan para calcular tu orientación del sueño. Solo te enviamos comunicaciones comerciales si das tu consentimiento de comunicaciones, que es opcional y puedes retirar cuando quieras. No vendemos tus datos. Conservamos el registro de caso para poder mostrar, ante una reclamación, una auditoría o una autoridad, qué se preguntó, qué se respondió y qué se mostró.

El resultado de la entrevista lo calculan reglas fijas. Ningún modelo de lenguaje puntúa, marca una alerta, diagnostica ni decide el nivel de atención. El informe que ves al terminar la entrevista actual está hecho con frases ya aprobadas. No lo redacta un modelo.

## 4. Quién más trata datos
- Google Cloud, en la región europe-west3 (Fráncfort): los servidores de la aplicación, los archivos, las colas y las sesiones. La sesión guarda el correo y el estado de acceso. Firebase Hosting sirve las páginas. Firebase Authentication guarda el correo y un identificador de cuenta para iniciar sesión.
- TiDB Cloud: las bases de datos de la aplicación.
- Brevo, en https://api.brevo.com: el correo y el texto del aviso (enlaces de acceso e invitaciones). El registro de envíos guarda el correo.
- AssemblyAI, en streaming.eu.assemblyai.com: si dictas una respuesta, el navegador envía el audio de tu voz directamente a AssemblyAI para convertirlo en texto. El audio no pasa por nuestros servidores y no lo guardamos nosotros. El texto vuelve al cuadro y puedes corregirlo antes de continuar. Si dices un nombre, un teléfono, un correo o un número de identidad, ese audio también se envía. La aplicación pide que no los digas y, en el texto, rechaza esos datos antes de guardar la respuesta.
- OpenAI, en https://api.openai.com/v1, cuando el servicio de informes tiene clave. En este repositorio, esa dirección está descrita como un tratamiento en Estados Unidos; la dirección europea no está configurada. La entrevista actual no envía tus respuestas libres a OpenAI: ese servicio está configurado con la extracción apagada y sin clave. Si se llama a la ruta antigua del informe, OpenAI recibe el nivel de atención, los patrones y el texto del protocolo, para redactar o traducir una explicación. Esa llamada no incluye tu nombre, tu correo, tu identificador ni tus respuestas libres, y pide que la respuesta no quede guardada como una respuesta almacenada de la plataforma. Para buscar fragmentos de la biblioteca clínica, OpenAI puede recibir frases ya aprobadas de esa biblioteca, no tus respuestas.
- Google, en el mismo proyecto y en europe-west3, cuando un miembro del equipo lo pide: el texto de un documento interno, para corregirlo, y el texto de un pasaje, para leerlo en voz alta en eu-texttospeech.googleapis.com. La lectura en voz alta está encendida en la configuración. La traducción de esos documentos no lo está. Esto no forma parte de tu entrevista.

## 5. Cuánto tiempo
Mientras mantengas tu cuenta. Las evaluaciones anónimas que no se guardan en una cuenta se eliminan a los 30 días. La sesión de la aplicación dura 7 días; después, el documento de sesión se borra por su fecha de caducidad. El registro de los avisos enviados se borra a los 90 días. El registro de caso se conserva 24 meses desde que empezó la evaluación y después se elimina. Si eliminas tu cuenta, o si tu evaluación se elimina, el registro de caso se mantiene durante ese plazo pero deja de estar ligado a ti. Al eliminar tu cuenta borramos la cuenta de acceso, las sesiones, la foto de perfil, las evaluaciones guardadas, los informes de esas evaluaciones guardados a tu nombre y los avisos dirigidos a tu correo. El registro de auditoría de esa eliminación se conserva, sin el texto de tus respuestas.

## 6. Tus derechos
Puedes acceder, rectificar, suprimir y portar tus datos, oponerte o limitar su tratamiento y retirar tus consentimientos. También puedes reclamar ante la Agencia Española de Protección de Datos (www.aepd.es). Si pides la supresión de tus datos, el registro de caso se mantiene hasta que acabe su plazo de 24 meses; ya no estará ligado a ti.

## 7. Seguridad
Las comunicaciones van cifradas. Las fotos y los informes se guardan en almacenamiento privado. Los documentos internos del equipo se cifran en el navegador antes de guardarse; el servicio guarda ese cifrado y no tiene la clave que lo abre. El audio del dictado no va cifrado con esa clave: va a AssemblyAI. El texto que un miembro del equipo pide leer en voz alta sale de ese cifrado y va a Google. Solo la superadministración de la plataforma puede abrir el registro de un caso, con el número de caso y una justificación escrita, y queda anotado quién lo abrió, cuándo y por qué.

## 8. Cookies y almacenamiento del navegador
Usamos una cookie de sesión y el almacenamiento local de tu navegador solo para lo estrictamente necesario: mantener tu sesión, recordar tu idioma y tu tema, retomar la entrevista que tengas empezada y completar el acceso por enlace. No usamos cookies de analítica ni de publicidad, ni scripts de terceros.

## 9. El consentimiento de los datos de salud
Antes de la entrevista, la aplicación muestra el texto de consentimiento de datos de salud y no sigue si no lo aceptas. Si ya lo aceptaste sobre la versión vigente, no te lo vuelve a pedir. Si ese texto cambia de versión, deja de contar como vigente y la siguiente entrevista te lo muestra otra vez. Retirarlo no borra lo ya tratado. Sin ese consentimiento la aplicación no inicia la evaluación.
