/**
 * ============================================================================
 * DARABIA ENGINE V6 — BACKEND FEEDBACK MENTOR
 * api/feedback-mentor.js · Vercel Serverless Function (Node.js 18+)
 *
 * Autor: Honás Darabia (Jonás Agudo Osuna) · IES Virgen del Pilar, Zaragoza
 * Módulo: Psicosociología Aplicada (PRL) · Curso 2025-2026
 *
 * RESPONSABILIDADES:
 *   1. Recibir el payload del simulador (motor cliente).
 *   2. Resolver el JSON del caso por caso_id.
 *   3. Construir un system prompt orientativo (no evaluador) desde el JSON.
 *   4. Llamar a la API de Anthropic (o Mock si DARABIA_MOCK=true).
 *   5. Validar la respuesta y reenviarla al motor.
 *
 * RELACIÓN CON /api/evaluar (corrector docente):
 *   - Endpoint INDEPENDIENTE. Cero código compartido.
 *   - Ambos sirven al mismo proyecto Vercel pero tienen prompts distintos
 *     y validan respuestas con esquemas distintos.
 *   - /api/evaluar  → CORRECTOR (rúbrica, nota, knockouts, vector_ejes)
 *   - /api/feedback-mentor → SIMULADOR ALUMNO (cualitativo, sin nota)
 *
 * SEGURIDAD:
 *   - ANTHROPIC_API_KEY vive solo en Vercel env vars.
 *   - Sin sanitización de HTML porque no inyectamos HTML; trabajamos con
 *     texto plano del dictamen.
 *
 * VARIABLES DE ENTORNO REQUERIDAS:
 *   ANTHROPIC_API_KEY   → sk-ant-...
 *   DARABIA_MOCK        → "true" para staging/desarrollo sin coste de API
 *   DARABIA_ENV         → "production" | "staging" | "development"
 *
 * VERSIÓN DEL PROMPT:
 *   El system prompt incluye "mentor_v1.0". Si en el futuro afinamos el
 *   prompt tras testeo en aula, bumpamos a mentor_v1.1 etc. El campo
 *   version_prompt se devuelve al frontend para trazabilidad.
 * ============================================================================
 */

'use strict';

// ============================================================================
// SECCIÓN A — REGISTRO DE CASOS
// ============================================================================
// Mismo patrón que /api/evaluar. Para añadir caso 06: añadir línea aquí.
// ============================================================================

const CASOS = {
  'psicosocial_gestoria_v1': require('../data/psicosocial_gestoria.json'),
  // 'psicosocial_hospital_v1': require('../data/psicosocial_hospital.json'),
};

// ============================================================================
// SECCIÓN B — CONFIGURACIÓN
// ============================================================================

const CONFIG = {
  modelo: 'claude-sonnet-4-5-20250929',  // Mismo modelo que el corrector docente
  max_tokens: 1500,                        // El feedback completo cabe en ~500 tokens; 1500 es margen
  timeout_ms: 50000,                       // Timeout duro tras el que devolvemos TIMEOUT_API

  // Versión del prompt mentor — bumpar al ajustarlo
  version_prompt: 'mentor_v1.0',

  // Tamaño máximo del dictamen del alumno (en caracteres). Si excede,
  // rechazamos con DICTAMEN_DEMASIADO_LARGO. 150.000 caracteres ≈ 22.000
  // palabras ≈ 50 páginas A4. Es un caso degenerado real.
  max_dictamen_chars: 150000,

  // Versiones del motor cliente que aceptamos. Compatible con bumps de patch.
  version_motor_minima: '6.0.0',

  cors_origins_permitidos: [
    'https://darabia.vercel.app',
    'https://ies-virgen-pilar.aeducar.es',
    'http://localhost:3000',
    'http://127.0.0.1:5500',
  ],
};

// ============================================================================
// SECCIÓN C — HANDLER PRINCIPAL (entry point Vercel)
// ============================================================================

module.exports = async function handler(req, res) {

  // — CORS —
  _setCorsHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // — Solo POST —
  if (req.method !== 'POST') {
    return _error(res, 405, 'METHOD_NOT_ALLOWED', 'Solo se admite POST.');
  }

  try {
    // 1. Parsear y validar payload
    const payload = _validarPayload(req.body);

    // 2. Resolver JSON del caso
    const caso = _resolverCaso(payload.caso_id);

    // 3. Validar tamaño del dictamen
    _validarTamanoDictamen(payload.dictamen);

    // 4. Modo Mock o real
    const esMock = process.env.DARABIA_MOCK === 'true';
    const respuesta = esMock
      ? _generarMock(caso, payload)
      : await _llamarAnthropic(caso, payload);

    // 5. Validar respuesta antes de enviarla al frontend
    _validarRespuestaIA(respuesta);

    // 6. Enriquecer con metadatos del backend
    respuesta.version_prompt = CONFIG.version_prompt;
    respuesta.generado_at = new Date().toISOString();

    // 7. Auditoría (sin nombres del alumno)
    _logAuditoria(payload, respuesta, esMock);

    return res.status(200).json(respuesta);

  } catch (err) {
    return _manejarError(res, err);
  }
};

// ============================================================================
// SECCIÓN D — VALIDACIÓN DEL PAYLOAD
// ============================================================================

function _validarPayload(body) {
  if (!body || typeof body !== 'object') {
    throw _crearError('PAYLOAD_INVALIDO', 400,
      'El cuerpo de la petición no es un objeto JSON válido.');
  }

  const requeridos = ['caso_id', 'version_motor', 'alumno', 'dictamen'];
  for (const campo of requeridos) {
    if (!body[campo]) {
      throw _crearError('PAYLOAD_INVALIDO', 400,
        `Campo requerido ausente: "${campo}".`);
    }
  }

  if (!body.alumno?.validado || !body.alumno?.nombre) {
    throw _crearError('ALUMNO_NO_VALIDADO', 400,
      'El alumno no está validado en el payload.');
  }

  if (!Array.isArray(body.dictamen?.secciones)) {
    throw _crearError('DICTAMEN_INVALIDO', 400,
      'El dictamen no contiene un array "secciones".');
  }

  if (body.dictamen.secciones.length === 0) {
    throw _crearError('DICTAMEN_VACIO', 400,
      'El dictamen no contiene secciones.');
  }

  // Aviso de versión inesperada (no bloquea)
  if (body.version_motor !== CONFIG.version_motor_minima) {
    console.warn(`[FEEDBACK] Versión de motor inesperada: ${body.version_motor} (esperada: ${CONFIG.version_motor_minima})`);
  }

  return body;
}

// ============================================================================
// SECCIÓN E — RESOLUCIÓN DEL CASO
// ============================================================================

function _resolverCaso(caso_id) {
  const caso = CASOS[caso_id];
  if (!caso) {
    throw _crearError(
      'CASO_NO_ENCONTRADO',
      404,
      `El caso_id "${caso_id}" no está registrado en este servidor. ¿Falta añadirlo al mapa CASOS?`
    );
  }
  return caso;
}

// ============================================================================
// SECCIÓN F — VALIDACIÓN DE TAMAÑO DEL DICTAMEN
// ============================================================================

/**
 * Calcula el tamaño total del dictamen del alumno (en caracteres) sumando
 * el contenido de todas las secciones de texto y todas las celdas de las
 * tablas. Si supera CONFIG.max_dictamen_chars, rechaza la solicitud.
 *
 * Decisión de diseño (capa 6 wireframe punto A): NO recortamos. Recortar
 * silenciosamente engaña al alumno. Si excede el límite, error claro y
 * el alumno sabe que tiene que reducir.
 */
function _validarTamanoDictamen(dictamen) {
  let total = 0;

  for (const sec of dictamen.secciones) {
    if (sec.tipo === 'texto') {
      total += (sec.contenido || '').length;
    } else if (sec.tipo === 'tabla') {
      for (const fila of (sec.filas || [])) {
        for (const [k, v] of Object.entries(fila)) {
          if (k === 'id') continue;
          total += String(v || '').length;
        }
      }
    }
  }

  if (total > CONFIG.max_dictamen_chars) {
    throw _crearError(
      'DICTAMEN_DEMASIADO_LARGO',
      400,
      `El dictamen excede el tamaño máximo soportado (${total.toLocaleString()} caracteres, máximo ${CONFIG.max_dictamen_chars.toLocaleString()}). Reduce su extensión antes de pedir feedback.`
    );
  }
}

// ============================================================================
// SECCIÓN G — CONSTRUCCIÓN DEL SYSTEM PROMPT
// ============================================================================
// Caso-agnóstico: lee del JSON del caso. Sin hardcoding de Moreno.
// ============================================================================

function _construirSystemPrompt(caso) {
  const ctxCaso = caso.contexto || {};
  const datos = ctxCaso.datos_objetivos || {};

  // Lista de secciones del dictamen tal y como las ve el alumno
  const seccionesDictamen = (caso.secciones_dictamen || [])
    .map(s => `  - [${s.id}] ${s.etiqueta}: ${s.ayuda || '(sin ayuda)'}`)
    .join('\n');

  // ¿El caso requiere mención de la Señal Sonia (o equivalente)?
  // Detectamos automáticamente si el JSON tiene knockout_criteria.senyal_sonia
  // (el knockout transversal del Caso Moreno). Caso-agnóstico: en otros
  // casos puede no existir y la sección se omite.
  const tieneSenyalSonia = !!caso?.aciertos_criticos?.knockout_criteria?.senyal_sonia;

  const seccionSonia = tieneSenyalSonia
    ? `

ATENCIÓN ESPECIAL — INDICIOS DE CONDUCTA HOSTIL:
Si el alumno NO menciona en su dictamen ningún protocolo de investigación
frente a posibles conductas hostiles entre compañeros (cuando el caso lo
requiera por la presencia de indicios), inclúyelo en aspectos_a_mejorar
como ORIENTACIÓN, no como sanción.

REGLAS ESTRICTAS sobre cómo abordarlo:
  - NO uses la palabra "knockout" ni "penalización" ni "fallo".
  - NO digas "has fallado" ni "te has equivocado".
  - SÍ sugiere consultar la transcripción relevante (la del trabajador
    que verbaliza la conducta hostil) y considerar si procede protocolo
    de investigación según RD 901/2020 y Art. 48 LO 3/2007.
  - Tono: orientación profesional. Estás avisándole de algo que el
    técnico PRL real debería identificar para que no le coja por
    sorpresa cuando el profesor corrija.`
    : '';

  return `Eres Honás Darabia, técnico PRL colegiado nº 0847, mentor del simulador
de psicosociología aplicada Darabia Engine V6.

Tu papel es ORIENTAR a un alumno de CFGS Prevención de Riesgos Profesionales
mientras redacta su dictamen psicosocial. NO eres su corrector ni su juez.
NO pones nota. La calificación oficial la pone el profesor tras corregir
el PDF de entrega.

TONO Y ESTILO:
  - Directo, técnico, sin condescendencia.
  - Sin tono emocional ni validación vacía ("buen trabajo", "vas bien").
  - Sin repetir lo que el alumno ya ha escrito.
  - Sin inventar datos del caso ni de la legislación que no estén en el JSON.
  - Responde SIEMPRE en español (castellano de España).
  - Sé conciso. Prioriza precisión sobre exhaustividad.
  - Evita generalidades; cada bullet debe ser específico y basado en
    el dictamen.

CONTEXTO DEL CASO:
  Título: ${caso.caso?.titulo || '(sin título)'}
  Sector: ${caso.caso?.sector || '(no especificado)'}
  Empresa: ${ctxCaso.empresa || '(no especificada)'}
  Plantilla: ${ctxCaso.plantilla || '(desconocida)'} personas
  Modelos teóricos del caso: ${(caso.caso?.modelos_teoricos || []).join(', ') || '(no especificados)'}
  Instrumento: ${caso.caso?.instrumento || '(no especificado)'}
  Datos objetivos del expediente:
    Absentismo: ${datos.absentismo || 'n/d'} (sector: ${datos.referencia_sector || 'n/d'})
    Bajas psicológicas 12m: ${datos.bajas_psicologicas_12m ?? 'n/d'} (${datos.dias_baja_total ?? 'n/d'} días)
    Horas extra media: ${datos.horas_extra_media_marzo || 'n/d'}
    Última evaluación psicosocial: ${datos.ultima_evaluacion_psicosocial || 'n/d'}

ESTRUCTURA DEL DICTAMEN QUE EL ALUMNO ESCRIBE:
${seccionesDictamen}

NOTA SOBRE EL PLAN DE ACCIÓN (si el caso incluye sección de tipo tabla):
Las medidas se valoran por su rigor operativo: idealmente cada medida
incluye factor, medida, indicador (KPI), responsable y plazo. Si alguna
columna queda sin rellenar, NO lo trates como error crítico — comenta
de forma orientativa que ese campo concreto refuerza la operatividad
de la medida. NO insistas en cada bullet si solo una o dos celdas están
vacías; menciónalo una vez si procede.
${seccionSonia}

REGLAS DE SALIDA — JSON ESTRICTO:
1. Responde EXCLUSIVAMENTE con un objeto JSON válido. Sin texto antes
   ni después. Sin backticks. Sin markdown.
2. Estructura obligatoria del JSON:
   {
     "diagnostico_general":  "<string · 1-4 frases · máx 80 palabras>",
     "fortalezas":           ["<string ≤25 palabras>", ...],
     "aspectos_a_mejorar":   ["<string ≤25 palabras>", ...],
     "recomendaciones":      ["<string ≤30 palabras>", ...]
   }
3. Longitudes:
   - diagnostico_general: 1 a 4 frases, máximo 80 palabras.
   - fortalezas: 2 a 4 bullets. Si no hay fortalezas reales, devuelve [].
   - aspectos_a_mejorar: 2 a 5 bullets.
   - recomendaciones: 2 a 5 bullets.
   - Total combinado: máximo 300 palabras.
4. Si una sección del dictamen está vacía, indícalo en aspectos_a_mejorar
   de forma neutra ("La sección X no ha sido redactada"). NO inventes
   contenido.
5. Si el dictamen entero está casi vacío, devuelve fortalezas: [] y centra
   diagnóstico + recomendaciones en orientación inicial.

NO incluyas en tu respuesta ningún campo distinto de los cuatro listados.
NO incluyas notas, puntuaciones, knockouts, vectores ni penalizaciones.
NO uses formato markdown dentro de los strings (sin **negrita**, sin
listas con guiones; los strings son texto plano).`;
}

// ============================================================================
// SECCIÓN H — CONSTRUCCIÓN DEL USER MESSAGE
// ============================================================================
// Convierte el dictamen estructurado a texto plano legible por la IA.
// La tabla del Plan de acción se renderiza como bloques con campos
// etiquetados para que la IA distinga celdas vacías de campos rellenos.
// ============================================================================

function _construirUserMessage(payload) {
  const { alumno, dictamen, timestamp } = payload;

  const cabecera = [
    `DICTAMEN DEL ALUMNO`,
    `Alumno: ${alumno.nombre}${alumno.grupo ? ' · Grupo: ' + alumno.grupo : ''}`,
    `Solicitud: ${timestamp || new Date().toISOString()}`,
    '',
    'CONTENIDO POR SECCIONES:'
  ].join('\n');

  const cuerpo = (dictamen.secciones || []).map(sec => {
    const titulo = `--- ${sec.etiqueta || sec.id} ---`;

    if (sec.tipo === 'texto') {
      const contenido = (sec.contenido || '').trim();
      return [titulo, contenido || '(sin contenido)', ''].join('\n');
    }

    if (sec.tipo === 'tabla') {
      return [titulo, _renderizarTablaTexto(sec), ''].join('\n');
    }

    return [titulo, '(tipo de sección no soportado)', ''].join('\n');
  }).join('\n');

  const cierre = '\nGenera el feedback en JSON estricto según las reglas del system prompt.';

  return cabecera + '\n\n' + cuerpo + cierre;
}

/**
 * Convierte una sección de tipo "tabla" en texto plano legible.
 * Cada fila se imprime con sus campos etiquetados. Celdas vacías
 * aparecen explícitamente como "(vacío)" para que la IA distinga
 * "no rellenado" de "rellenado pero corto".
 */
function _renderizarTablaTexto(sec) {
  const columnas = sec.columnas || [];
  const filas = sec.filas || [];

  if (filas.length === 0) {
    return '(tabla sin filas)';
  }

  const out = [];
  filas.forEach((fila, idx) => {
    out.push(`Fila ${idx + 1}:`);
    for (const col of columnas) {
      const valor = (fila[col.id] || '').toString().trim();
      out.push(`  ${col.etiqueta}: ${valor || '(vacío)'}`);
    }
  });
  return out.join('\n');
}

// ============================================================================
// SECCIÓN I — LLAMADA A ANTHROPIC
// ============================================================================

async function _llamarAnthropic(caso, payload) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw _crearError('CONFIG_ERROR', 500,
      'ANTHROPIC_API_KEY no está configurada en las variables de entorno de Vercel.');
  }

  const systemPrompt = _construirSystemPrompt(caso);
  const userMessage = _construirUserMessage(payload);

  // Política de reintentos exponencial: solo en errores transitorios.
  const MAX_INTENTOS = 3;
  const ESPERAS_MS = [0, 2000, 4000];
  const REINTENTABLES = ['LIMITE_CUOTA', 'API_SOBRECARGADA', 'TIMEOUT_API'];

  let ultimoError;

  for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
    if (ESPERAS_MS[intento - 1] > 0) {
      await new Promise(r => setTimeout(r, ESPERAS_MS[intento - 1]));
    }

    try {
      return await _ejecutarLlamada(apiKey, systemPrompt, userMessage);
    } catch (err) {
      ultimoError = err;
      if (!REINTENTABLES.includes(err.codigo) || intento === MAX_INTENTOS) {
        throw err;
      }
      console.warn(`[FEEDBACK] Intento ${intento}/${MAX_INTENTOS} fallido (${err.codigo}). Reintentando...`);
    }
  }

  throw ultimoError;
}

async function _ejecutarLlamada(apiKey, systemPrompt, userMessage) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CONFIG.timeout_ms);

  let respuestaRaw;
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CONFIG.modelo,
        max_tokens: CONFIG.max_tokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // Mapeo de errores HTTP de Anthropic
    if (resp.status === 401) throw _crearError('API_KEY_INVALIDA', 502, 'API key inválida o expirada.');
    if (resp.status === 429) throw _crearError('LIMITE_CUOTA', 429, 'Límite de rate de Anthropic alcanzado. Reintenta en unos segundos.');
    if (resp.status === 402) throw _crearError('SIN_SALDO', 402, 'Cuenta de Anthropic sin saldo suficiente.');
    if (resp.status === 529) throw _crearError('API_SOBRECARGADA', 503, 'API de Anthropic sobrecargada. Reintenta en unos segundos.');
    if (!resp.ok) throw _crearError('API_ERROR', 502, `Anthropic respondió con HTTP ${resp.status}.`);

    respuestaRaw = await resp.json();

  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw _crearError('TIMEOUT_API', 504, `La API de Anthropic no respondió en ${CONFIG.timeout_ms / 1000}s.`);
    }
    if (err.codigo) throw err;
    throw _crearError('RED_ERROR', 502, `Error de red al contactar Anthropic: ${err.message}`);
  }

  // Extraer texto de la respuesta de Anthropic
  const texto = respuestaRaw?.content
    ?.filter(b => b.type === 'text')
    ?.map(b => b.text)
    ?.join('')
    ?.trim();

  if (!texto) {
    throw _crearError('RESPUESTA_VACIA', 502, 'Anthropic devolvió una respuesta sin contenido de texto.');
  }

  // Parsear JSON limpiando posibles backticks por si el modelo los añade
  const jsonLimpio = texto
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(jsonLimpio);
  } catch (parseErr) {
    throw _crearError(
      'JSON_INVALIDO',
      502,
      `La IA devolvió texto que no es JSON válido. Fragmento: "${jsonLimpio.substring(0, 200)}..."`
    );
  }
}

// ============================================================================
// SECCIÓN J — MODO MOCK
// ============================================================================
// Genera una respuesta simulada coherente para staging/desarrollo sin
// gastar API real. Detecta si el alumno mencionó protocolo de investigación
// para decidir si la "Señal Sonia" aparece en aspectos_a_mejorar.
// ============================================================================

function _generarMock(caso, payload) {
  const dictamenTexto = JSON.stringify(payload.dictamen).toLowerCase();
  const mencionaProtocolo = /protocolo.*investigaci[oó]n|rd ?901|art\.?\s*48/.test(dictamenTexto);
  const tieneSenyalSonia = !!caso?.aciertos_criticos?.knockout_criteria?.senyal_sonia;

  // Cuántas secciones tienen contenido (para variar el feedback)
  const secciones = payload.dictamen?.secciones || [];
  const completas = secciones.filter(s => {
    if (s.tipo === 'texto') return (s.contenido || '').trim().length > 50;
    if (s.tipo === 'tabla') return (s.filas || []).some(f =>
      Object.entries(f).filter(([k]) => k !== 'id')
        .some(([_, v]) => String(v || '').trim().length > 0)
    );
    return false;
  });

  const fortalezas = completas.length >= 3
    ? [
        'Identificación correcta de unidades de análisis diferenciadas por puesto y carga.',
        'Triangulación con al menos dos fuentes documentales en la mayoría de factores.'
      ]
    : [];

  const aspectosMejora = [
    completas.length < 3
      ? 'El dictamen está en fase inicial. Avanza en las secciones aún vacías o muy breves.'
      : 'Profundiza la aplicación operativa de Karasek y Siegrist a los datos del caso, no solo definición.',
    'Las medidas del plan de acción requieren indicador, responsable y plazo concretos por fila.'
  ];

  if (tieneSenyalSonia && !mencionaProtocolo) {
    aspectosMejora.push(
      'Revisa la transcripción de Sonia Peralta. Si identificas indicios de conducta hostil entre compañeros, considera si procede abrir un protocolo de investigación según RD 901/2020 y Art. 48 LO 3/2007.'
    );
  }

  return {
    diagnostico_general: completas.length >= 3
      ? '[MOCK] El dictamen muestra estructura clara y triangulación parcial. Falta consolidar la articulación entre evidencias y modelos teóricos. La hipótesis se mantiene en plano descriptivo y debe evolucionar hacia mecanismo causal estructural.'
      : '[MOCK] El dictamen está en fase muy inicial. Se recomienda avanzar en la identificación de unidades de análisis y la triangulación de fuentes antes de aplicar los modelos teóricos.',
    fortalezas,
    aspectos_a_mejorar: aspectosMejora,
    recomendaciones: [
      'Para cada factor de riesgo, cita explícitamente al menos tres fuentes convergentes (ítem ISTAS21 + transcripción + registro documental).',
      'Aplica Karasek (DCA) y Siegrist (ERI) sobre datos concretos del caso, no como definición abstracta.',
      'En el plan de acción, prioriza medidas primarias (organización del trabajo) sobre secundarias o terciarias.'
    ],
    _mock: true
  };
}

// ============================================================================
// SECCIÓN K — VALIDACIÓN DE LA RESPUESTA IA
// ============================================================================

function _validarRespuestaIA(data) {
  if (!data || typeof data !== 'object') {
    throw _crearError('RESPUESTA_INVALIDA', 502,
      'La respuesta del mentor no es un objeto.');
  }

  if (typeof data.diagnostico_general !== 'string' || data.diagnostico_general.trim().length < 5) {
    throw _crearError('RESPUESTA_INVALIDA', 502,
      'Falta diagnostico_general o es demasiado breve.');
  }

  for (const campo of ['fortalezas', 'aspectos_a_mejorar', 'recomendaciones']) {
    if (!Array.isArray(data[campo])) {
      throw _crearError('RESPUESTA_INVALIDA', 502,
        `El campo "${campo}" debe ser un array.`);
    }
    for (const item of data[campo]) {
      if (typeof item !== 'string') {
        throw _crearError('RESPUESTA_INVALIDA', 502,
          `Todos los items de "${campo}" deben ser strings.`);
      }
    }
  }

  // Defensa: limpiar campos prohibidos que el mentor NO debería incluir
  // pero que podrían aparecer si el modelo se confunde con el corrector.
  const camposProhibidos = [
    'nota_global', 'puntuacion_total', 'vector_ejes', 'detalle_criterios',
    'knockouts_aplicados', 'nota_asesoramiento_docente', 'nivel'
  ];
  for (const campo of camposProhibidos) {
    if (campo in data) {
      console.warn(`[FEEDBACK][SEGURIDAD] Campo prohibido "${campo}" en respuesta. Eliminando.`);
      delete data[campo];
    }
  }
}

// ============================================================================
// SECCIÓN L — CORS
// ============================================================================

function _setCorsHeaders(req, res) {
  const origin = req.headers.origin || '';
  const esOrigenPermitido = CONFIG.cors_origins_permitidos.includes(origin)
    || process.env.DARABIA_ENV !== 'production';

  res.setHeader('Access-Control-Allow-Origin', esOrigenPermitido ? origin : CONFIG.cors_origins_permitidos[0]);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

// ============================================================================
// SECCIÓN M — MANEJO DE ERRORES
// ============================================================================

function _crearError(codigo, httpStatus, mensaje) {
  const err = new Error(mensaje);
  err.codigo = codigo;
  err.httpStatus = httpStatus;
  return err;
}

function _error(res, status, codigo, mensaje) {
  return res.status(status).json({ error: true, codigo, mensaje });
}

function _manejarError(res, err) {
  const esOperacional = !!err.codigo;
  const httpStatus = err.httpStatus || 500;
  const codigo = err.codigo || 'ERROR_INTERNO';
  const mensaje = esOperacional
    ? err.message
    : 'Error interno del servidor. Contacta con el administrador.';

  const detalle = process.env.DARABIA_ENV !== 'production'
    ? (err.stack || err.message)
    : undefined;

  console.error(`[FEEDBACK] ERROR ${httpStatus} ${codigo}: ${err.message}`, detalle || '');

  return res.status(httpStatus).json({
    error: true,
    codigo,
    mensaje,
    ...(detalle && { detalle }),
  });
}

// ============================================================================
// SECCIÓN N — LOG DE AUDITORÍA (sin datos personales)
// ============================================================================

function _logAuditoria(payload, respuesta, esMock) {
  const log = {
    timestamp: new Date().toISOString(),
    endpoint: 'feedback-mentor',
    caso_id: payload.caso_id,
    grupo: payload.alumno?.grupo || 'N/A',
    alumno_hash: _hash(payload.alumno?.nombre),
    n_secciones: payload.dictamen?.secciones?.length || 0,
    n_fortalezas: respuesta.fortalezas?.length || 0,
    n_aspectos: respuesta.aspectos_a_mejorar?.length || 0,
    n_recomendaciones: respuesta.recomendaciones?.length || 0,
    modo: esMock ? 'MOCK' : 'REAL',
    motor: payload.version_motor,
    prompt: CONFIG.version_prompt,
    env: process.env.DARABIA_ENV || 'unknown',
  };
  console.log('[AUDIT-FB]', JSON.stringify(log));
}

function _hash(str) {
  if (!str) return '?';
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36).toUpperCase();
}

// ============================================================================
// FIN · api/feedback-mentor.js · capa 6A
// ============================================================================
