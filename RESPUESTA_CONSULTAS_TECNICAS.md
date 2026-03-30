# RESPUESTA A CONSULTAS TÉCNICAS — CITY2CRUISE / CRUISE CONNECT

Este documento detalla la alineación conceptual y técnica del sistema **City2Cruise** (anteriormente Cruise Connect) con los objetivos de eficiencia logística, digitalización portuaria y sostenibilidad.

---

## 3.1 Argumentario sobre la eficiencia logística portuaria

### 3.1.1 Impacto directo en la terminal
El sistema City2Cruise transforma radicalmente el flujo de equipaje de los pasajeros. Tradicionalmente, la llegada de pasajeros de forma escalonada con múltiples bultos genera un "goteo" constante en los escáneres de seguridad de la terminal, lo que obliga a mantener picos de personal y genera cuellos de botella ineficientes.

**Impacto positivo:**
- **Consolidación vs. Goteo:** Al centralizar la recogida de paquetes en lockers urbanos y transportarlos de forma consolidada, se reduce el número de interacciones individuales en los controles de seguridad.
- **Reducción de tiempos de paso:** Los bultos consolidados pueden ser procesados en lotes programados, optimizando la capacidad operativa de los escáneres y permitiendo una planificación de personal más ajustada a la demanda real.
- **Descongestión de áreas de espera:** El pasajero llega a la terminal libre de cargas, lo que agiliza el tránsito por las zonas comunes y mejora la experiencia del crucerista.

### 3.1.2 Modelo de datos de trazabilidad (Traza Auditable)
La trazabilidad del sistema se basa en un modelo de estados determinista y transaccional que registra cada evento crítico con sello de tiempo y firma HMAC-SHA256. Cada registro en la tabla `audit_events` incluye: UUID de evento, ID de solicitud, tipo de evento, ID del actor, metadata JSON opcional y firma de integridad. Los eventos exactos que componen la traza auditable son:

1.  **Request Created (Evento: `REQUESTED`):**
    *   *Datos:* ID del Cliente, dirección textual de recogida, coordenadas GPS (Lat/Lon), tamaño del paquete.
2.  **Driver Assigned (Evento: `ASSIGNED`):**
    *   *Datos:* ID del Conductor, generación de `handshake_code` (OTP de 4 dígitos hasheado con bcrypt), timestamp de expiración.
3.  **Handshake Pending (Evento: `CONFIRMATION_PENDING`):**
    *   *Datos:* Transición de estado cuando el conductor activa el proceso de entrega presencial.
4.  **Physical Handover (Evento: `HANDSHAKE_VALIDATED`):**
    *   *Datos:* Validación del código OTP introducido por el cliente (máx. 3 intentos; bloqueo HTTP 423 al exceder). Confirmación de recogida presencial.
5.  **Deposit Confirmed (Evento: `DEPOSITED`):**
    *   *Datos:* ID del Smart Locker asignado, generación de `locker_code` único de 6 dígitos (TTL hasta 23:59h), coordenadas de depósito.
6.  **Final Collection (Evento: `PICKED_UP`):**
    *   *Datos:* Validación del PIN de apertura, liberación del recurso (locker).

Eventos adicionales registrados: `CANCELLED` (solicitud anulada), `RATE_LIMIT_BLOCK` (bloqueo por exceso de intentos de handshake).

### 3.1.3 Especificaciones de sensorización de los Smart Lockers
Aunque el sistema actual abstrae la capa física mediante una simulación lógica robusta, el hardware de los Smart Lockers está diseñado para integrar los siguientes sensores físicos:

-   **Sensores magnéticos de estado de puerta:** Detectan si la puerta está físicamente cerrada o abierta, activando alertas en caso de apertura no autorizada o puertas mal cerradas.
-   **Células fotoeléctricas de ocupación:** Sensores de infrarrojos en el interior de cada cubículo para verificar la presencia real de un objeto, independientemente del estado lógico del software.
-   **Sensores de Temperatura y Humedad:** Monitoreo ambiental para garantizar la integridad de las compras del pasajero (especialmente útil si se transportan productos sensibles).
-   **Watchdog de conectividad:** Sistema de "latido" (heartbeat) que monitoriza la conexión a la red y reinicia el módulo de comunicación en caso de fallo persistente.

---

## 3.2 Alineación con el modelo de Puerto Inteligente (Smart Port)

### 3.2.1 Interfaces B2B/B2A (Dashboard/API para la APLP)
El proyecto contempla el desarrollo de un **Dashboard de Supervisión para la Autoridad Portuaria de Las Palmas (APLP)** y una **API REST de Interoperabilidad**.
-   **Consumo de datos:** La APLP podrá consumir datos agregados y anonimizados sobre flujos de movilidad urbana vinculados al puerto.
-   **Analítica de Flujo:** Mapas de calor de compras, horas pico de uso de la infraestructura y métricas de eficiencia en la última milla.
-   **Transparencia:** Acceso a la traza auditable (sin datos sensibles de usuarios) para fines de cumplimiento y optimización de servicios portuarios.

### 3.2.2 Co-creación de valor: El puerto como facilitador local
El concepto de "co-creación de valor" en City2Cruise reside en la integración del puerto con el tejido empresarial urbano. El puerto deja de ser una infraestructura pasiva de atraque para convertirse en un **Hub de Servicios Logísticos** que:
-   **Fomenta el comercio local:** Al eliminar la barrera física de cargar peso, se incentiva la compra en comercios urbanos (B2B).
-   **Integra operadores urbanos:** Los conductores locales participan en la dinámica portuaria, creando un ecosistema económico compartido entre la ciudad y el puerto.

### 3.2.3 Protocolos de integración IoT y Seguridad
La capa de comunicación hardware-nube utiliza una arquitectura híbrida para garantizar eficiencia e inmutabilidad:
-   **Telemetría y Estado:** Se utiliza **WebSockets persistentes (Socket.IO)** para la actualización en tiempo real del estado de los dispositivos y la ubicación de los conductores.
-   **Comandos Críticos:** Las aperturas de lockers y cambios de estado se gestionan mediante **HTTPS con cifrado TLS 1.3** y autenticación JWT para máxima seguridad.
-   **Inmutabilidad del registro:** Cada cambio de estado se registra en una base de datos relacional con integridad referencial y transacciones atómicas (SQLite/PostgreSQL), asegurando que la historia digital del paquete no pueda ser alterada retroactivamente.

---

## 3.3 Enfoque macro de la sostenibilidad (Green Port)

### 3.3.1 Lógica de la consolidación de carga
La ineficiencia del modelo actual es exponencial:
-   **Modelo Tradicional:** N cruceristas -> N Taxis/VTCs individuales -> N viajes fragmentados con carga mínima. Esto implica una alta saturación de las vías de acceso al puerto y un desperdicio masivo de combustible.
-   **Modelo City2Cruise:** N paquetes -> 1 Conductor profesional -> 1 Viaje consolidado. Se reduce el número total de vehículos en circulación y las emisiones de CO2 asociadas por cada bulto transportado.

### 3.3.2 Eficiencia del Geo-dispatching
La asignación de servicios se basa en el algoritmo de **Geo-dispatching por proximidad**, utilizando la **Fórmula de Haversine**:
-   **Minimización de "Dead-head miles":** El sistema solo notifica a los operadores logísticos que se encuentran en un radio de proximidad inmediata (ej. 3km).
-   **Reducción de consumo:** Al asignar al conductor más cercano, se minimiza el trayecto en vacío hacia el punto de recogida, reduciendo directamente el consumo de energía (combustible o batería) y el desgaste del vehículo.
-   **Optimización dinámica:** El uso de WebSockets permite que el sistema "vea" la posición en tiempo real, garantizando que la asignación sea siempre la más eficiente en el momento de la solicitud.

---

## 5.1 Alteración de la cadena de valor logística del puerto

Tradicionalmente, el puerto actúa como un **nodo pasivo** en la logística de equipaje y compras: simplemente recibe al pasajero cargado en el momento del embarque ("All Aboard"). City2Cruise transforma al puerto en un **gestor activo**, permitiendo la recepción de carga de forma anticipada, deslocalizada y consolidada.

### 5.1.1 KPIs de experiencia de usuario (UX)
La efectividad del sistema se medirá mediante indicadores que reflejen tanto la satisfacción emocional como el beneficio tangible en tiempo:
-   **Net Promoter Score (NPS) post-servicio:** Automatización de encuestas vía app inmediatamente después del `PICKED_UP`. Objetivo: NPS > 70 (Excelencia).
-   **Tiempo Urbano Liberado:** Cálculo del tiempo entre la recogida (`IN_PROGRESS`) y el embarque previsto. Se estima que cada crucerista recupera una media de **2 a 3 horas de "ocio real"** al no tener que regresar prematuramente al barco o buscar consignas físicas.
-   **Ratio de Esfuerzo del Cliente (CES):** Medición de la facilidad para solicitar la recogida (objetivo: < 3 clicks).

### 5.1.2 Impacto en los cuellos de botella de la terminal
La terminal sufre picos de densidad crítica en los filtros RX y arcos de seguridad durante las dos horas previas al "All Aboard".
-   **Inyección Asíncrona:** City2Cruise permite que las bolsas entren en la zona de seguridad de forma asíncrona respecto al flujo de pasajeros.
-   **Reducción de Densidad:** Al haber procesado previamente el equipaje consolidado de los lockers, se estima una **reducción del 15-20% en la densidad de bultos** en los controles manuales durante las horas punta, agilizando el paso del resto de cruceristas.

### 5.1.3 Modelo de valor para la Autoridad Portuaria (APLP)
El valor para la APLP es multidimensional:
-   **Reputacional (Smart Port):** Posicionamiento de Las Palmas como un puerto de vanguardia tecnológica en la red de Puertos del Estado.
-   **Operativo:** Menor congestión en las zonas públicas de la terminal.
-   **Monetización Futura:** El modelo prevé un **canon por concesión de espacio** para los lockers y una posible tasa por paquete gestionado, similar a otras concesiones de servicios comerciales.

---

## 5.2 Proyección macroeconómica y tracción comercial (TRL 7)

El piloto en entorno real (TRL 7) demuestra que existe una demanda latente no satisfecha, justificando la inversión pre-comercial.

### 5.2.1 Cuantificación del empleo
-   **Empleo Directo (Alta Cualificación):** Necesidad de un equipo central de **3-5 ingenieros de software y soporte técnico** en REKER Tech para mantenimiento y evolución de la plataforma.
-   **Empleo Indirecto:** Creación de una red de **conductores/operadores logísticos locales**. Se estima la generación de 1 empleo indirecto por cada 500 servicios mensuales realizados.

### 5.2.2 Impacto del modelo "Hands-free shopping"
La eliminación de la carga física tiene una correlación directa con la elasticidad de la demanda:
-   **Incremento del Ticket Medio:** Estudios de retail sugieren que un cliente "manos libres" gasta entre un **15% y un 25% más** en comercios locales al poder seguir visitando tiendas sin la limitación del peso acumulado.
-   **Estímulo al Comercio Local:** City2Cruise actúa como un catalizador económico para las zonas comerciales cercanas al puerto (ej. Triana o Mesa y López en Las Palmas).

### 5.2.3 Plan de escalabilidad
El modelo es 100% replicable en puertos con casuística de tránsito similar:
-   **Fase 1 (Nacional):** Barcelona, Palma, Málaga, Valencia y Santa Cruz de Tenerife.
-   **Fase 2 (Internacional):** Expansión a hubs del Mediterráneo y Caribe.
-   **Escalabilidad Técnica:** La arquitectura en la nube permite desplegar "instancias" por puerto con mínima configuración geográfica.

---

## 5.3 RSC y Cohesión Territorial

### 5.3.1 Diseño universal y accesibilidad
-   **App:** Cumplimiento de las pautas WCAG 2.1 para garantizar que personas con deficiencias visuales o motoras puedan usar la interfaz.
-   **Hardware de Taquillas:** El diseño físico de los lockers contempla que las taquillas de uso preferente para **Personas con Movilidad Reducida (PMR)** estén situadas en la franja de altura accesible (entre 70cm y 120cm del suelo).

### 5.3.2 Mitigación de la "Turismofobia"
El proyecto mejora la convivencia urbana al:
-   **Liberar el Transporte Público:** Menos pasajeros cargados con múltiples bolsas en guaguas (autobuses) y tranvías, dejando espacio para el residente.
-   **Reducción de Fricción Visual/Espacial:** Menor congestión de bultos en aceras y zonas peatonales de alta densidad.

---

## 5.4 Beneficio ambiental y Taxonomía Verde Europea

### 5.4.1 KPIs de mitigación de GEI (Gases de Efecto Invernadero)
La eficiencia ambiental se basa en el ratio de consolidación $R$:
-   **Fórmula:** $E_{ahorrada} = (N \times D \times E_{taxi}) - (D_{cons} \times E_{furgoneta})$
    *   $N$: Número de pasajeros.
    *   $D$: Distancia media.
    *   $D_{cons}$: Distancia del vehículo consolidado (optimizada por Haversine).
-   **Resultado:** Se estima una **reducción del 60-70% en la huella de CO2** por cada paquete gestionado mediante consolidación frente al transporte individual.

### 5.4.2 Estrategia Green Port y ODS
City2Cruise se alinea directamente con:
-   **ODS 9 (Industria, Innovación e Infraestructura):** Digitalización de la logística.
-   **ODS 11 (Ciudades y Comunidades Sostenibles):** Reducción del impacto ambiental de las ciudades portuarias.
-   **ODS 13 (Acción por el Clima):** Reducción directa de emisiones de carbono en la última milla.
-   **Estrategia Green Port de Puertos del Estado:** Contribución a la descarbonización de la actividad logística vinculada al puerto.

---

## 6.1 Estrategia de Propiedad Intelectual y Marca

La estrategia de REKER Tech Solutions para City2Cruise combina una postura defensiva inicial con una visión ofensiva para la escalabilidad comercial.

-   **Objetivo Principal:** Asegurar la **Libertad de Operación (Freedom to Operate - FTO)** para evitar bloqueos de terceros, al tiempo que se busca **monopolizar la explotación comercial** del modelo de negocio específico "Shop&Drop" en recintos portuarios estatales.
-   **Registro de Marca:** Se ha decidido tramitar el registro de la marca **"City2Cruise"** inicialmente a nivel nacional ante la **OEPM** (Oficina Española de Patentes y Marcas), con una extensión prevista a la **EUIPO** (European Union Intellectual Property Office) en la fase de escalabilidad internacional para proteger la identidad visual y comercial en todo el territorio europeo.

---

## 6.2 Salvaguarda del Conocimiento y Secreto Industrial

REKER Tech Solutions implementa protocolos estrictos para garantizar que el valor técnico y operativo del proyecto permanezca bajo control exclusivo de la empresa.

-   **Cláusulas Contractuales:** Todos los contratos de trabajo y colaboración con el equipo de desarrollo incluyen cláusulas de **cesión total y exclusiva de derechos de propiedad intelectual e industrial** a favor de REKER Tech Solutions.
-   **Acuerdos de Confidencialidad (NDA):** Se requiere la firma de NDAs restrictivos para cualquier tercero con acceso a información sensible, incluyendo fabricantes de hardware de lockers y operadores logísticos del piloto, protegiendo así el *know-how* operativo.

### 6.2.1 Metodología de Registro de Código Fuente
Para garantizar una prueba de autoría robusta y fehaciente del software (Backend Node.js y App React), se optará por un modelo híbrido:
1.  **Sello de Tiempo Cualificado (Blockchain):** Uso de plataformas como **Safe Creative** o similar para registrar los *hashes* de los commits de Git y versiones mayores, proporcionando una evidencia técnica inmutable de la existencia del código en una fecha específica.
2.  **Depósito Notarial (Escrow):** En fases de contratación pública o con grandes autoridades portuarias, se contempla el uso de depósitos notariales para asegurar la continuidad del servicio y la protección del código fuente.

### 6.2.2 Justificación del Secreto Empresarial
Dado que el algoritmo Haversine es de dominio público, la protección legal como **Secreto Empresarial** (bajo la Ley 1/2019) se sustenta en las medidas técnicas de ciberseguridad que restringen el acceso al "conjunto" de la solución:
-   **Repositorios Privados:** El código se aloja en repositorios privados con acceso limitado mediante **RBAC (Role-Based Access Control)**.
-   **Control de Accesos:** Solo el personal técnico directamente implicado tiene acceso a la lógica de negocio (cascadas de degradación, reglas de matching y gestión de timeouts).
-   **Cifrado:** Uso de encriptación tanto en reposo como en tránsito para proteger la lógica implementada y los datos de configuración.

---

## 6.3 Estrategia de Patentes vs. Secreto Industrial

Tras el análisis de la patentabilidad del software en Europa (Convenio de la Patente Europea):
-   **Decisión:** Actualmente se prioriza la vía del **Secreto Industrial + Copyright**. Se descarta la patente del software "como tal" por los elevados costes de mantenimiento y los tiempos de tramitación, que no se alinean con la velocidad de iteración del TRL 7.
-   **Excepción CII (Invenciones Implementadas por Ordenador):** No obstante, REKER Tech Solutions no descarta la posibilidad de solicitar una patente sobre el **método físico-digital integrado**. Esto cubriría la invención técnica del flujo completo: interacción App → Gestión de estados vía WSS → Validación Handshake → Protocolo IoT de apertura física, siempre que se demuestre que resuelve un problema técnico de coordinación logística de forma novedosa.

---

## 7.1 Modelo de Plataforma Multilateral (Multi-sided Platform)

City2Cruise opera como una plataforma que conecta a tres actores principales, alineando sus incentivos para generar un efecto de red positivo:

-   **El Crucerista (Usuario):** Entra en la red por **conveniencia y libertad operativa**. El valor principal es el ahorro de tiempo y la eliminación del esfuerzo físico.
-   **El Comercio Local (Socio B2B):** Participa para **aumentar su ticket medio** y mejorar la experiencia de servicio al cliente. El modelo es **B2B2C**, donde el comercio suele ofrecer y subvencionar parcial o totalmente el servicio al turista como una herramienta de fidelización y cierre de venta.
-   **El Conductor (Operador):** Se integra buscando **flexibilidad laboral** y una fuente de ingresos adicional optimizada por la proximidad geográfica del sistema Geo-dispatch.

---

## 7.2 Líneas de Monetización (Revenue Streams)

La estrategia de precios (*Pricing*) está diseñada para ser escalable y competitiva:

1.  **Tarifa por Servicio (Flat Fee):** Se cobra una tarifa fija por bulto gestionado al usuario final (o al comercio que lo subvenciona).
2.  **Suscripción B2B (SaaS Model):** Los comercios integrados en la app pagan una suscripción mensual por visibilidad, analíticas de consumo y acceso a la red de transporte.
3.  **Take Rate:** La plataforma retiene una comisión (aprox. 15-25%) sobre el coste del servicio del operador logístico por la gestión del matching y la seguridad.
4.  **Tasa de Uso de Infraestructura:** Posible canon por el uso extendido del locker más allá de un tiempo de cortesía definido.

---

## 7.3 Estructura de Costes (OPEX vs. CAPEX)

-   **CAPEX (Gasto de Capital):** Inversión inicial en la adquisición e instalación del hardware de los Smart Lockers y el desarrollo base de la plataforma tecnológica.
-   **OPEX (Gastos Operativos):**
    *   **Mantenimiento:** Conectividad IoT, limpieza y energía de los puntos físicos.
    *   **Infraestructura Cloud:** Costes de AWS/Google Cloud para el backend Node.js y consumo de APIs de mapas (OpenStreetMap/Google Maps).
    *   **Logística:** Es un **coste variable**. El grueso del pago a conductores solo se genera si existe un servicio solicitado y completado satisfactoriamente.

---

## 7.4 Estrategia de Comercialización (Go-to-Market)

Para captar la red inicial de actores, City2Cruise implementa una estrategia dual:

-   **Capatación B2B:** Ventas directas y acuerdos con **asociaciones de comerciantes** de centros urbanos (ej. Las Palmas, Barcelona). Instalación de material PLV (Publicidad en el Lugar de Venta) en las tiendas para informar al turista.
-   **Captación del Crucerista:** Integración opcional en las aplicaciones oficiales de los Puertos o Autoridades Portuarias, acuerdos con consignatarios y consignas de navieras para aparecer como servicio de valor añadido en el desembarque.

---

## 7.5 Modelo de Escalabilidad (Expansion Playbook)

El crecimiento del sistema se rige por variables técnicas y de flujo:

-   **Variables de Aptitud del Puerto:**
    *   Volumen de escalas > 500.000 pasajeros/año.
    *   Distancia Puerto-Ciudad > 1 km (donde la carga se vuelve un impedimento real).
-   **Arquitectura Cloud Replicable:** La infraestructura basada en nodos permite abrir un "nuevo puerto" simplemente instalando la red de lockers y configurando el radio de Haversine para la nueva zona. Esto facilita la expansión nacional (Málaga, Valencia, Palma) e internacional (Marsella, Nápoles, Miami) replicando el éxito de los nodos piloto.
