/* ============================================================================
 * DARABIA ENGINE V6 — MOTOR CIEGO
 * script_caso05_core.js · v6.0.0
 * Autor: Honás Darabia (Jonás Agudo Osuna) · IES Virgen del Pilar, Zaragoza
 * Módulo: Psicosociología Aplicada (PRL) · Curso 2025-2026
 *
 * CAMBIOS v6.0.0 RESPECTO A v5.1.0:
 *   · Eliminada la mecánica de entrevistas a NPCs (Entrevistas, Pistas,
 *     coincidenciaPregunta, gameState.entrevistas, gameState.llaves).
 *   · Eliminada la máquina de estados de fases (Flujo, MOTOR.flujo,
 *     fase_actual, fases_completadas).
 *   · Eliminado modo_juego (BLOQUEANTE 5).
 *   · Eliminado Calificacion (decisión 9: feedback cualitativo, sin nota).
 *   · Eliminado renderizarFase y la dependencia con DarabiaUI.render(fase, ...).
 *   · Reescrito Dictamen para leer CASO.secciones_dictamen (no rubrica del
 *     corrector). Soporta secciones tipo "texto" y tipo "tabla".
 *   · Reescrito validarCaso para el contrato v6 (caso, contexto, documentos,
 *     transcripciones, secciones_dictamen).
 *   · Evaluador y Persistencia se mantienen como interfaces, pero la lógica
 *     interna se actualizará en capas posteriores (6 y 8 respectivamente).
 *
 * FILOSOFÍA (sin cambios):
 *   Este motor no sabe qué caso ejecuta. Lee un JSON externo y orquesta
 *   carga, estado y persistencia. Cero criterios de evaluación hardcodeados.
 *   Cero nombres de NPCs. Cero pesos de rúbrica. Todo vive en el JSON.
 *
 * INTERMODULARIDAD (contrato innegociable):
 *   Para ejecutar el Caso 06 el año que viene: se copia este motor tal cual
 *   y se cambia solo MOTOR.caso_json_path. Cero refactor entre casos.
 *
 * CONTRATO DEL JSON v6:
 *   Lee de: caso, contexto, documentos[], transcripciones[], secciones_dictamen[]
 *   Ignora: aciertos_criticos, jerarquia_preventiva, indicadores_validos,
 *           prompt_evaluacion (eso es del corrector, no del simulador).
 * ============================================================================ */

'use strict';

/* ============================================================================
 * SECCIÓN A — CONFIGURACIÓN DEL MOTOR
 * ============================================================================ */

const MOTOR = {
    version: '6.0.0', // versión semver del contrato motor↔JSON
    caso_json_path: './psicosocial_gestoria.json',
    api_endpoint: '/api/feedback-mentor', // capa 6 lo implementa; aquí solo se declara
    storage_prefix: 'darabia_v6_',
    autosave_interval_ms: 15000,
    api_timeout_ms: 45000,
    api_max_reintentos: 3
};

/* ============================================================================
 * SECCIÓN B — CONEXIÓN SCORM (pipwerks · Aeducar/Moodle)
 * ============================================================================
 * Se mantiene como utilidad disponible. La llamada efectiva se decide en la
 * capa 6 (¿enviamos algo al LMS al cerrar el flujo, sin nota?).
 * ============================================================================ */

const SCORM = {
    pipwerks: (typeof pipwerks !== 'undefined') ? pipwerks.SCORM : null,
    conectado: false,

    conectar() {
        if (!this.pipwerks) {
            console.log('[SCORM] pipwerks no disponible → modo local.');
            return false;
        }
        this.conectado = this.pipwerks.init();
        console.log(this.conectado ? '[SCORM] Conectado al LMS.' : '[SCORM] Modo local.');
        return this.conectado;
    },

    /**
     * Marca la actividad como completada en el LMS.
     *
     * Decisión 9 del briefing: el simulador NO calcula nota real. La nota
     * académica la pone el profesor tras corregir el PDF.
     *
     * Sin embargo, Aeducar/Moodle necesita un score numérico para registrar
     * la actividad como entregada con fiabilidad — algunos despliegues no
     * marcan como completado sin score.raw. Por eso enviamos un score
     * técnico de 100/100 que indica "actividad completada", NO "10 sobre 10".
     *
     * IMPORTANTE: este 100 es un MARCADOR TÉCNICO de finalización, no una
     * calificación académica. La nota real la introduce el profesor en la
     * libreta del LMS tras la corrección manual.
     */
    marcarCompletado() {
        if (!this.conectado) return;
        try {
            this.pipwerks.set('cmi.core.score.raw', '100');
            this.pipwerks.set('cmi.core.score.min', '0');
            this.pipwerks.set('cmi.core.score.max', '100');
            this.pipwerks.set('cmi.core.lesson_status', 'completed');
            this.pipwerks.save();
            console.log('[SCORM] Actividad marcada como completada (score técnico 100, NO calificación).');
        } catch (err) {
            console.error('[SCORM] Error marcando completado:', err);
        }
    },

    cerrar() {
        if (!this.conectado) return;
        try {
            this.pipwerks.quit();
            this.conectado = false;
        } catch (err) {
            console.error('[SCORM] Error cerrando sesión:', err);
        }
    }
};

/* ============================================================================
 * SECCIÓN C — ESTADO DEL CASO Y DE LA PARTIDA
 * ============================================================================ */

let CASO = null;

/**
 * gameState v6 — modelo simplificado.
 *
 * Cambios respecto a v5.1:
 *   - Sin fase_actual / fases_completadas (no hay máquina de estados).
 *   - Sin investigacion (no hay método ni datos analizados).
 *   - Sin entrevistas / llaves (no hay mecánica de NPCs).
 *   - Sin modo_juego.
 *   - dictamen.secciones es un objeto con tipo + contenido/filas según
 *     secciones_dictamen del JSON.
 *
 * El gameState NO se inicializa con la estructura del dictamen aquí —
 * se inicializa en Dictamen.inicializar() cuando el JSON ya está cargado.
 * Esto es porque la estructura depende del JSON del caso.
 */
let gameState = {
    caso_id: null,
    version_motor: MOTOR.version,

    alumno: { nombre: '', grupo: '', validado: false },

    dictamen: {
        secciones: {},      // se inicializa con Dictamen.inicializar()

        // Feedback del mentor (capa 6).
        // - feedback_ia: el JSON completo devuelto por /api/feedback-mentor.
        // - feedback_solicitado_at: timestamp ISO del momento de la solicitud.
        // - feedback_dictamen_hash: hash del dictamen en el momento de la
        //   solicitud, para detectar si el dictamen ha cambiado y marcar el
        //   feedback como obsoleto.
        feedback_ia: null,
        feedback_solicitado_at: null,
        feedback_dictamen_hash: null,

        // Generación del PDF (capa 7).
        pdf_generado_at: null
    },

    timestamps: {
        carga_caso: null,
        inicio: null,
        ultima_actividad: null,
        fin: null
    }
};

/* ============================================================================
 * SECCIÓN D — CARGA Y VALIDACIÓN DEL JSON DEL CASO
 * ============================================================================ */

async function cargarCaso() {
    try {
        const resp = await fetch(MOTOR.caso_json_path);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        CASO = await resp.json();
        validarCaso(CASO);
        gameState.caso_id = CASO.caso.id;
        gameState.timestamps.carga_caso = new Date().toISOString();
        console.log(`[MOTOR v${MOTOR.version}] Caso cargado: ${CASO.caso.titulo}`);
        return true;
    } catch (err) {
        console.error('[MOTOR] Error cargando caso:', err);
        mostrarErrorFatal(
            'No se pudo cargar el expediente del caso. Contacta con el profesor.',
            err.message
        );
        return false;
    }
}

/**
 * Valida que el JSON cumple el contrato v6.
 * El simulador NO valida los nodos del corrector (aciertos_criticos, etc.)
 * porque no son su problema.
 */
function validarCaso(caso) {
    const requeridos = [
        'caso.id', 'caso.titulo',
        'contexto.empresa',
        'documentos',
        'transcripciones',
        'secciones_dictamen'
    ];
    for (const ruta of requeridos) {
        if (obtenerRuta(caso, ruta) === undefined) {
            throw new Error(`JSON inválido (contrato v6): falta "${ruta}"`);
        }
    }

    if (!Array.isArray(caso.documentos) || caso.documentos.length === 0) {
        throw new Error('JSON inválido: "documentos" debe ser un array no vacío.');
    }
    if (!Array.isArray(caso.transcripciones)) {
        throw new Error('JSON inválido: "transcripciones" debe ser un array.');
    }
    if (!Array.isArray(caso.secciones_dictamen) || caso.secciones_dictamen.length === 0) {
        throw new Error('JSON inválido: "secciones_dictamen" debe ser un array no vacío.');
    }

    // Validación por documento
    for (const doc of caso.documentos) {
        for (const campo of ['id', 'titulo', 'html']) {
            if (!doc[campo]) {
                throw new Error(`JSON inválido: documento "${doc.id || '?'}" sin "${campo}".`);
            }
        }
    }

    // Validación por transcripción
    for (const tr of caso.transcripciones) {
        for (const campo of ['id', 'trabajador', 'html']) {
            if (!tr[campo]) {
                throw new Error(`JSON inválido: transcripción "${tr.id || '?'}" sin "${campo}".`);
            }
        }
    }

    // Validación por sección de dictamen
    const tiposValidos = ['texto', 'tabla'];
    for (const sec of caso.secciones_dictamen) {
        for (const campo of ['id', 'etiqueta', 'tipo']) {
            if (!sec[campo]) {
                throw new Error(`JSON inválido: sección "${sec.id || '?'}" sin "${campo}".`);
            }
        }
        if (!tiposValidos.includes(sec.tipo)) {
            throw new Error(`JSON inválido: sección "${sec.id}" tiene tipo "${sec.tipo}" no soportado. Válidos: ${tiposValidos.join(', ')}.`);
        }
        if (sec.tipo === 'tabla') {
            if (!Array.isArray(sec.columnas) || sec.columnas.length === 0) {
                throw new Error(`JSON inválido: sección tabla "${sec.id}" sin columnas[].`);
            }
            for (const col of sec.columnas) {
                if (!col.id || !col.etiqueta) {
                    throw new Error(`JSON inválido: columna de "${sec.id}" sin id o etiqueta.`);
                }
            }
        }
    }
}

function obtenerRuta(obj, ruta) {
    return ruta.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/* ============================================================================
 * SECCIÓN E — PERSISTENCIA EN localStorage
 * ============================================================================
 * NOTA: La invalidación por bump de versión y la restauración explícita
 * campo a campo (sin Object.assign plano) las implementa la CAPA 8.
 * Aquí mantenemos la interfaz pero documentamos la deuda técnica.
 * ============================================================================ */

const Persistencia = {
    clave() {
        const alumnoId = (gameState.alumno.nombre || 'anonimo')
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '_');
        return `${MOTOR.storage_prefix}${gameState.caso_id || 'sin_caso'}_${alumnoId}`;
    },

    guardar() {
        try {
            gameState.timestamps.ultima_actividad = new Date().toISOString();
            localStorage.setItem(this.clave(), JSON.stringify(gameState));
        } catch (err) {
            console.warn('[PERSIST] Error guardando:', err);
        }
    },

    /**
     * @deprecated Implementación provisional. CAPA 8 reescribe esta función
     * con restauración explícita campo a campo y banner de aviso.
     *
     * Validación mínima añadida en capa 2:
     *   - Ignora el save si caso_id no coincide.
     *   - Ignora el save si version_motor no coincide.
     *   - Ignora el save si dictamen.secciones no es un objeto válido
     *     (protección contra saves antiguos o corruptos).
     */
    cargar() {
        try {
            const raw = localStorage.getItem(this.clave());
            if (!raw) return false;
            const estadoGuardado = JSON.parse(raw);

            // Caso distinto → ignorar.
            if (estadoGuardado.caso_id !== gameState.caso_id) return false;

            // Versión de motor distinta → ignorar (capa 8 hará migración limpia).
            if (estadoGuardado.version_motor !== MOTOR.version) {
                console.warn(`[PERSIST] Save de versión ${estadoGuardado.version_motor} ignorado (motor actual ${MOTOR.version}). CAPA 8 implementará migración limpia.`);
                return false;
            }

            // Estructura mínima de dictamen → si falta, save inválido o corrupto.
            const dictGuardado = estadoGuardado.dictamen;
            if (!dictGuardado || typeof dictGuardado !== 'object' ||
                typeof dictGuardado.secciones !== 'object' ||
                dictGuardado.secciones === null) {
                console.warn('[PERSIST] Save sin estructura válida de dictamen. Ignorando.');
                return false;
            }

            // Object.assign plano por ahora — capa 8 lo reescribe.
            Object.assign(gameState, estadoGuardado);
            return true;
        } catch (err) {
            console.warn('[PERSIST] Error cargando:', err);
            return false;
        }
    },

    limpiar() {
        try { localStorage.removeItem(this.clave()); } catch (_) {}
    },

    _timerAutosave: null,
    iniciarAutosave() {
        this.detenerAutosave();
        this._timerAutosave = setInterval(() => this.guardar(), MOTOR.autosave_interval_ms);
    },
    detenerAutosave() {
        if (this._timerAutosave) clearInterval(this._timerAutosave);
        this._timerAutosave = null;
    }
};

/* ============================================================================
 * SECCIÓN F — DICTAMEN
 * ============================================================================
 * Lee la estructura de secciones desde CASO.secciones_dictamen (NO desde la
 * rúbrica del corrector). Soporta dos tipos de sección:
 *
 *   tipo: "texto"   → contenido string libre.
 *   tipo: "tabla"   → array de filas; cada fila es un objeto con las claves
 *                     definidas en la propiedad columnas[].id de la sección.
 * ============================================================================ */

const Dictamen = {
    /**
     * Inicializa gameState.dictamen.secciones según las secciones_dictamen
     * del CASO cargado. Idempotente: si ya hay contenido (tras restauración
     * de localStorage), lo respeta.
     */
    inicializar() {
        if (!CASO || !Array.isArray(CASO.secciones_dictamen)) return;
        const yaInicializado = gameState.dictamen.secciones &&
            Object.keys(gameState.dictamen.secciones).length > 0;

        for (const sec of CASO.secciones_dictamen) {
            // Si ya existe (por restauración) y es del mismo tipo, no la tocamos.
            const existente = gameState.dictamen.secciones[sec.id];
            if (existente && existente.tipo === sec.tipo) continue;

            // Crear estructura limpia según tipo.
            if (sec.tipo === 'texto') {
                gameState.dictamen.secciones[sec.id] = { tipo: 'texto', contenido: '' };
            } else if (sec.tipo === 'tabla') {
                const filas = sec.fila_inicial_vacia ? [this._filaVacia(sec)] : [];
                gameState.dictamen.secciones[sec.id] = { tipo: 'tabla', filas };
            }
        }

        if (!yaInicializado) {
            console.log(`[DICTAMEN] Inicializadas ${CASO.secciones_dictamen.length} secciones.`);
        }
    },

    /**
     * Devuelve la metadatos de las secciones tal y como están en el JSON.
     * La UI usa esto para construir las pestañas del editor.
     */
    secciones() {
        if (!CASO || !Array.isArray(CASO.secciones_dictamen)) return [];
        return CASO.secciones_dictamen.map(s => ({
            id: s.id,
            etiqueta: s.etiqueta,
            tipo: s.tipo,
            ayuda: s.ayuda || '',
            placeholder: s.placeholder || '',
            columnas: s.columnas || null,
            min_filas: s.min_filas ?? 0,
            max_filas: s.max_filas ?? Infinity
        }));
    },

    /**
     * Guarda el contenido de una sección de tipo "texto".
     * Si la sección no es de tipo texto, lanza error.
     */
    setTexto(seccionId, texto) {
        const sec = this._encontrarSeccion(seccionId);
        if (sec.tipo !== 'texto') {
            throw new Error(`Dictamen.setTexto: la sección "${seccionId}" es de tipo "${sec.tipo}", no "texto".`);
        }
        gameState.dictamen.secciones[seccionId] = {
            tipo: 'texto',
            contenido: texto || ''
        };
        Persistencia.guardar();
    },

    /**
     * Devuelve el contenido textual de una sección de tipo "texto".
     */
    getTexto(seccionId) {
        const data = gameState.dictamen.secciones[seccionId];
        if (!data || data.tipo !== 'texto') return '';
        return data.contenido || '';
    },

    /**
     * Devuelve las filas de una sección de tipo "tabla".
     * Devuelve array vacío si la sección no existe o no es tabla.
     */
    getFilas(seccionId) {
        const data = gameState.dictamen.secciones[seccionId];
        if (!data || data.tipo !== 'tabla') return [];
        return Array.isArray(data.filas) ? data.filas : [];
    },

    /**
     * Reemplaza el conjunto completo de filas de una sección tabla.
     * Útil para drag & drop de orden, clear, etc.
     */
    setFilas(seccionId, filas) {
        const sec = this._encontrarSeccion(seccionId);
        if (sec.tipo !== 'tabla') {
            throw new Error(`Dictamen.setFilas: la sección "${seccionId}" es de tipo "${sec.tipo}", no "tabla".`);
        }
        gameState.dictamen.secciones[seccionId] = {
            tipo: 'tabla',
            filas: Array.isArray(filas) ? filas : []
        };
        Persistencia.guardar();
    },

    /**
     * Añade una fila vacía al final de una sección tabla.
     * Devuelve el id de la fila creada, o null si se ha alcanzado max_filas.
     */
    anadirFila(seccionId) {
        const sec = this._encontrarSeccion(seccionId);
        if (sec.tipo !== 'tabla') {
            throw new Error(`Dictamen.anadirFila: la sección "${seccionId}" no es tabla.`);
        }
        const filas = this.getFilas(seccionId);
        const max = sec.max_filas ?? Infinity;
        if (filas.length >= max) return null;

        const nueva = this._filaVacia(sec);
        filas.push(nueva);
        gameState.dictamen.secciones[seccionId] = { tipo: 'tabla', filas };
        Persistencia.guardar();
        return nueva.id;
    },

    /**
     * Actualiza un campo de una fila concreta.
     * Devuelve true si se actualizó, false si no se encontró.
     */
    setCampoFila(seccionId, filaId, columnaId, valor) {
        const sec = this._encontrarSeccion(seccionId);
        if (sec.tipo !== 'tabla') {
            throw new Error(`Dictamen.setCampoFila: la sección "${seccionId}" no es tabla.`);
        }
        const columnasValidas = (sec.columnas || []).map(c => c.id);
        if (!columnasValidas.includes(columnaId)) {
            throw new Error(`Dictamen.setCampoFila: columna "${columnaId}" no existe en "${seccionId}". Válidas: ${columnasValidas.join(', ')}.`);
        }
        const filas = this.getFilas(seccionId);
        const fila = filas.find(f => f.id === filaId);
        if (!fila) return false;
        fila[columnaId] = valor ?? '';
        gameState.dictamen.secciones[seccionId] = { tipo: 'tabla', filas };
        Persistencia.guardar();
        return true;
    },

    /**
     * Elimina una fila por id.
     * Respeta min_filas: si eliminar dejaría la tabla por debajo del mínimo,
     * no la elimina y devuelve false.
     */
    eliminarFila(seccionId, filaId) {
        const sec = this._encontrarSeccion(seccionId);
        if (sec.tipo !== 'tabla') {
            throw new Error(`Dictamen.eliminarFila: la sección "${seccionId}" no es tabla.`);
        }
        const filas = this.getFilas(seccionId);
        const min = sec.min_filas ?? 0;
        if (filas.length <= min) return false;

        const nuevas = filas.filter(f => f.id !== filaId);
        if (nuevas.length === filas.length) return false; // no encontrada
        gameState.dictamen.secciones[seccionId] = { tipo: 'tabla', filas: nuevas };
        Persistencia.guardar();
        return true;
    },

    /**
     * Compone el dictamen como objeto serializable, con la estructura del
     * JSON del caso preservada. Útil para:
     *   - Generar PDF (capa 7)
     *   - Enviar al endpoint de feedback (capa 6)
     *
     * No es un string. Es una estructura tipada que respeta texto vs tabla.
     */
    componerEstructurado() {
        const secciones = this.secciones();
        return {
            caso_id: CASO?.caso?.id || null,
            version_motor: MOTOR.version,
            alumno: { ...gameState.alumno },
            generado_at: new Date().toISOString(),
            secciones: secciones.map(meta => {
                const data = gameState.dictamen.secciones[meta.id] || {};
                if (meta.tipo === 'texto') {
                    return {
                        id: meta.id,
                        etiqueta: meta.etiqueta,
                        tipo: 'texto',
                        contenido: data.contenido || ''
                    };
                }
                if (meta.tipo === 'tabla') {
                    return {
                        id: meta.id,
                        etiqueta: meta.etiqueta,
                        tipo: 'tabla',
                        columnas: meta.columnas,
                        filas: data.filas || []
                    };
                }
                return { id: meta.id, etiqueta: meta.etiqueta, tipo: meta.tipo };
            })
        };
    },

    /**
     * Valida que el dictamen está completo (todas las secciones tienen
     * contenido mínimo). Devuelve qué falta sin lanzar.
     */
    validar() {
        const secciones = this.secciones();
        const incompletas = [];
        for (const meta of secciones) {
            const data = gameState.dictamen.secciones[meta.id];
            if (!data) {
                incompletas.push({ id: meta.id, etiqueta: meta.etiqueta, motivo: 'no_inicializada' });
                continue;
            }
            if (meta.tipo === 'texto') {
                if (!(data.contenido || '').trim()) {
                    incompletas.push({ id: meta.id, etiqueta: meta.etiqueta, motivo: 'texto_vacio' });
                }
            } else if (meta.tipo === 'tabla') {
                const filas = data.filas || [];
                const filasNoVacias = filas.filter(f => this._filaTieneContenido(f, meta.columnas));
                if (filasNoVacias.length === 0) {
                    incompletas.push({ id: meta.id, etiqueta: meta.etiqueta, motivo: 'tabla_vacia' });
                }
            }
        }
        return { valido: incompletas.length === 0, secciones_incompletas: incompletas };
    },

    // ---- helpers privados ----

    _encontrarSeccion(seccionId) {
        const sec = (CASO?.secciones_dictamen || []).find(s => s.id === seccionId);
        if (!sec) {
            throw new Error(`Dictamen: sección "${seccionId}" no existe en el JSON del caso.`);
        }
        return sec;
    },

    _filaVacia(seccionMeta) {
        const fila = { id: this._nuevoFilaId() };
        for (const col of (seccionMeta.columnas || [])) {
            fila[col.id] = '';
        }
        return fila;
    },

    _filaTieneContenido(fila, columnas) {
        if (!fila || !Array.isArray(columnas)) return false;
        return columnas.some(col => (fila[col.id] || '').toString().trim().length > 0);
    },

    _nuevoFilaId() {
        return 'fila_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    }
};

/* ============================================================================
 * SECCIÓN G — EVALUADOR (FEEDBACK MENTOR) · capa 6B
 * ============================================================================
 * Solicitud de feedback orientativo al endpoint /api/feedback-mentor.
 *
 * Una sola llamada por solicitud (no streaming, no chat).
 *
 * Flujo:
 *   1. tieneAlgoQueEvaluar() → gatekeeper (200 chars + tabla mínima).
 *   2. solicitarFeedback() → construye payload, llama al endpoint,
 *      valida respuesta, persiste en gameState.dictamen.feedback_ia.
 *   3. feedbackEstaObsoleto() → la UI lo usa para mostrar aviso ámbar
 *      si el alumno modificó el dictamen tras pedir feedback.
 *
 * El hash del dictamen es no criptográfico (solo detección de cambios).
 * ============================================================================ */

/**
 * Error tipado para errores de feedback.
 * Códigos esperados:
 *   NADA_QUE_EVALUAR        → gatekeeper rechaza la solicitud (cliente).
 *   LIMITE_CUOTA            → backend devuelve 429 (Anthropic rate-limit).
 *   SIN_SALDO               → backend devuelve 402 (Anthropic sin saldo).
 *   TIMEOUT_API             → backend timeout (>50s).
 *   RESPUESTA_INVALIDA      → respuesta del backend mal formada.
 *   RED_ERROR               → fetch falla (sin conexión, CORS, etc.).
 *   DICTAMEN_DEMASIADO_LARGO → backend rechaza por tamaño (>150k chars).
 *   API_ERROR               → catch-all para otros 5xx.
 */
class ErrorFeedback extends Error {
    constructor(codigo, mensaje) {
        super(mensaje);
        this.name = 'ErrorFeedback';
        this.codigo = codigo;
    }
}

const Evaluador = {

    /**
     * Solicita feedback al endpoint /api/feedback-mentor.
     *
     * @returns {Promise<Object>} JSON con campos:
     *   diagnostico_general, fortalezas[], aspectos_a_mejorar[],
     *   recomendaciones[], version_prompt, generado_at.
     *
     * @throws {ErrorFeedback} con códigos tipados (ver clase).
     */
    async solicitarFeedback() {
        // 1. Gatekeeper duro
        if (!this.tieneAlgoQueEvaluar()) {
            throw new ErrorFeedback(
                'NADA_QUE_EVALUAR',
                'Escribe al menos un párrafo en alguna sección antes de pedir feedback.'
            );
        }

        // 2. Construir payload
        const dictamenEstructurado = Dictamen.componerEstructurado();
        const hashSolicitud = _hashDictamen(dictamenEstructurado);

        const payload = {
            caso_id: CASO.caso.id,
            version_motor: MOTOR.version,
            alumno: gameState.alumno,
            dictamen: dictamenEstructurado,
            timestamp: new Date().toISOString()
        };

        // 3. Llamada con reintentos en errores transitorios
        const data = await this._llamarConReintentos(payload);

        // 4. Validación cliente (defensa en profundidad)
        this._validarRespuestaFeedback(data);

        // 5. Persistir en gameState
        gameState.dictamen.feedback_ia = data;
        gameState.dictamen.feedback_solicitado_at = new Date().toISOString();
        gameState.dictamen.feedback_dictamen_hash = hashSolicitud;
        Persistencia.guardar();

        return data;
    },

    /**
     * Gatekeeper antes de invocar la API.
     *
     * Reglas (briefing capa 6 punto 10):
     *   - Mínimo 200 caracteres totales sumando todas las secciones de texto.
     *   - + al menos 1 fila de tabla con al menos 2 campos rellenos.
     *
     * Si NO se cumple, devuelve false. La UI usa esto para deshabilitar
     * el botón Feedback con tooltip explicativo.
     *
     * Razón: protege la cuenta API y educa al alumno (pedir feedback con
     * tres palabras es perder el tiempo, suyo y del mentor).
     */
    tieneAlgoQueEvaluar() {
        const secciones = Dictamen.secciones();

        let charsTexto = 0;
        let cumpleTabla = false;

        // Si NO hay tablas en el caso, la regla de tabla no aplica:
        // basta con cumplir el mínimo de caracteres en texto.
        let hayTablasEnCaso = false;

        for (const meta of secciones) {
            const data = gameState.dictamen.secciones[meta.id];
            if (!data) continue;

            if (meta.tipo === 'texto') {
                charsTexto += (data.contenido || '').trim().length;
            } else if (meta.tipo === 'tabla') {
                hayTablasEnCaso = true;
                const filas = data.filas || [];
                for (const fila of filas) {
                    const camposRellenos = (meta.columnas || []).filter(col =>
                        (fila[col.id] || '').toString().trim().length > 0
                    ).length;
                    if (camposRellenos >= 2) {
                        cumpleTabla = true;
                        break;
                    }
                }
            }
        }

        const cumpleTexto = charsTexto >= 200;

        // Si el caso no tiene tablas (caso futuro distinto a Moreno),
        // basta con texto. Caso-agnóstico.
        if (!hayTablasEnCaso) return cumpleTexto;

        // Si el caso tiene tablas, exigimos AMBAS condiciones.
        return cumpleTexto && cumpleTabla;
    },

    /**
     * Devuelve true si el alumno ha modificado el dictamen tras la última
     * solicitud de feedback. La UI muestra un aviso ámbar en ese caso.
     */
    feedbackEstaObsoleto() {
        const guardado = gameState.dictamen.feedback_dictamen_hash;
        if (!guardado) return false;
        const actual = _hashDictamen(Dictamen.componerEstructurado());
        return guardado !== actual;
    },

    /**
     * Devuelve el feedback persistido si existe, null en caso contrario.
     * La UI lo usa al abrir el modal: si hay feedback previo, lo muestra
     * sin gastar API; si no, dispara una nueva solicitud.
     */
    obtenerFeedbackPersistido() {
        return gameState.dictamen.feedback_ia || null;
    },

    /* -------- INTERNOS -------- */

    /**
     * Llamada al endpoint con reintentos en errores transitorios.
     */
    async _llamarConReintentos(payload, intento = 1) {
        try {
            const resp = await this._fetch(payload);
            const data = await resp.json().catch(() => null);

            if (resp.ok) {
                if (!data) {
                    throw new ErrorFeedback('RESPUESTA_INVALIDA',
                        'El servidor devolvió una respuesta vacía o no-JSON.');
                }
                return data;
            }

            // Mapear errores tipados que el backend devuelve en data.codigo
            const codigo = data?.codigo || `HTTP_${resp.status}`;
            const mensaje = data?.mensaje || `Error ${resp.status}`;

            // Reintentables: rate-limit y sobrecarga
            const reintentable = ['LIMITE_CUOTA', 'API_SOBRECARGADA', 'TIMEOUT_API']
                .includes(codigo);

            if (reintentable && intento < MOTOR.api_max_reintentos) {
                const espera = 1000 * Math.pow(2, intento);
                console.warn(`[FEEDBACK] Reintento ${intento + 1} en ${espera}ms (${codigo})`);
                await new Promise(r => setTimeout(r, espera));
                return this._llamarConReintentos(payload, intento + 1);
            }

            throw new ErrorFeedback(codigo, mensaje);

        } catch (err) {
            // Errores de red (TypeError de fetch, AbortError de timeout)
            if (err instanceof ErrorFeedback) throw err;

            const esTimeout = err.name === 'AbortError';
            const esRed = err.name === 'TypeError';

            if ((esTimeout || esRed) && intento < MOTOR.api_max_reintentos) {
                const espera = 1000 * Math.pow(2, intento);
                console.warn(`[FEEDBACK] Reintento ${intento + 1} en ${espera}ms (red/timeout)`);
                await new Promise(r => setTimeout(r, espera));
                return this._llamarConReintentos(payload, intento + 1);
            }

            if (esTimeout) {
                throw new ErrorFeedback('TIMEOUT_API',
                    'El mentor tarda demasiado en responder. Reintenta en unos segundos.');
            }
            if (esRed) {
                throw new ErrorFeedback('RED_ERROR',
                    'Error de red. Comprueba tu conexión y reintenta.');
            }
            // Error inesperado
            throw new ErrorFeedback('API_ERROR', err.message || 'Error desconocido.');
        }
    },

    /**
     * Fetch con timeout. Apunta a MOTOR.api_endpoint
     * (que en v6 es /api/feedback-mentor).
     */
    async _fetch(payload) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), MOTOR.api_timeout_ms);
        try {
            return await fetch(MOTOR.api_endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: controller.signal
            });
        } finally {
            clearTimeout(timeoutId);
        }
    },

    /**
     * Validación cliente (capa B de la defensa en profundidad).
     * El backend ya validó, pero re-validamos por si la respuesta llega
     * corrupta por la red o por una versión incompatible del backend.
     *
     * Reglas:
     *   - los 4 campos existen SIEMPRE
     *   - arrays son arrays (aunque vacíos)
     *   - diagnostico_general es string no vacío
     */
    _validarRespuestaFeedback(data) {
        if (!data || typeof data !== 'object') {
            throw new ErrorFeedback('RESPUESTA_INVALIDA',
                'El mentor devolvió una respuesta inválida.');
        }

        if (typeof data.diagnostico_general !== 'string'
            || data.diagnostico_general.trim().length < 5) {
            throw new ErrorFeedback('RESPUESTA_INVALIDA',
                'Falta diagnostico_general en la respuesta del mentor.');
        }

        for (const campo of ['fortalezas', 'aspectos_a_mejorar', 'recomendaciones']) {
            if (!Array.isArray(data[campo])) {
                throw new ErrorFeedback('RESPUESTA_INVALIDA',
                    `El campo "${campo}" no es un array.`);
            }
            for (const item of data[campo]) {
                if (typeof item !== 'string') {
                    throw new ErrorFeedback('RESPUESTA_INVALIDA',
                        `Los items de "${campo}" deben ser strings.`);
                }
            }
        }
    }
};

/**
 * Hash no criptográfico del dictamen, para detectar cambios.
 *
 * IMPORTANTE: NO es seguridad. Solo se usa para comparar si el dictamen
 * actual es el mismo que se envió al mentor. Colisiones son aceptables
 * (impacto: el feedback no se marca como obsoleto cuando debería).
 *
 * Algoritmo: djb2 sobre la representación canónica del dictamen.
 */
function _hashDictamen(dictamenEstructurado) {
    if (!dictamenEstructurado) return null;

    // Serializar de forma estable: solo el contenido de las secciones,
    // ordenadas por id. Ignoramos timestamps, alumno, etc. — solo lo
    // que el alumno escribe.
    const partes = (dictamenEstructurado.secciones || [])
        .slice()
        .sort((a, b) => (a.id || '').localeCompare(b.id || ''))
        .map(sec => {
            if (sec.tipo === 'texto') {
                return `${sec.id}|T|${(sec.contenido || '').trim()}`;
            }
            if (sec.tipo === 'tabla') {
                const filas = (sec.filas || []).map(fila => {
                    // Serializar campos en orden alfabético, omitiendo 'id'
                    return Object.entries(fila)
                        .filter(([k]) => k !== 'id')
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([k, v]) => `${k}=${(v || '').toString().trim()}`)
                        .join(';');
                }).join('||');
                return `${sec.id}|TBL|${filas}`;
            }
            return `${sec.id}|?|`;
        });

    const canonico = partes.join('§');

    // djb2
    let h = 5381;
    for (let i = 0; i < canonico.length; i++) {
        h = ((h << 5) + h + canonico.charCodeAt(i)) | 0;
    }
    return Math.abs(h).toString(36);
}

/* ============================================================================
 * SECCIÓN H — UTILIDADES
 * ============================================================================ */

function mostrarErrorFatal(mensaje, detalle) {
    const c = document.getElementById('darabia-root');
    if (!c) return;
    c.innerHTML = `
        <div style="padding:24px; color:#ff4d6a; font-family:Inter,sans-serif;">
            <h2>No se puede arrancar el simulador</h2>
            <p>${mensaje}</p>
            <pre style="font-family:JetBrains Mono,monospace; font-size:.85rem; opacity:.7;">${detalle || ''}</pre>
        </div>`;
}

/* ============================================================================
 * SECCIÓN I — API PÚBLICA
 * ============================================================================ */

const Darabia = {
    MOTOR, SCORM, Dictamen, Evaluador, Persistencia,
    get caso() { return CASO; },
    get estado() { return gameState; },

    /**
     * Bootstrap del motor:
     *   1. Conecta SCORM (si existe).
     *   2. Carga y valida el JSON del caso.
     *   3. Restaura estado desde localStorage si hay un save válido.
     *   4. Inicializa la estructura del dictamen según secciones_dictamen.
     *   5. Arranca autosave.
     *
     * No renderiza nada. La UI (capa 3) se monta llamando a window.__darabiaUIBoot()
     * desde el orquestador del index.html, NO desde aquí.
     */
    async iniciar() {
        SCORM.conectar();
        const ok = await cargarCaso();
        if (!ok) return false;
        Persistencia.cargar();
        Dictamen.inicializar();
        Persistencia.iniciarAutosave();
        return true;
    },

    /**
     * Registra al alumno y persiste. La validación es mínima (nombre no vacío)
     * — no es una autenticación real, solo identificación para el PDF.
     */
    registrarAlumno(nombre, grupo) {
        const nombreLimpio = (nombre || '').trim();
        const grupoLimpio = (grupo || '').trim();
        if (!nombreLimpio) {
            console.warn('[DARABIA] Nombre vacío: registro rechazado.');
            return false;
        }
        gameState.alumno = {
            nombre: nombreLimpio,
            grupo: grupoLimpio,
            validado: true
        };
        if (!gameState.timestamps.inicio) {
            gameState.timestamps.inicio = new Date().toISOString();
        }
        Persistencia.guardar();
        return true;
    },

    /**
     * Cierra el flujo. La generación del PDF la dispara la UI desde su lado;
     * aquí solo marcamos timestamp, paramos autosave y notificamos al LMS.
     * SCORM no recibe nota (decisión 9 del briefing).
     */
    finalizar() {
        Persistencia.detenerAutosave();
        if (!gameState.timestamps.fin) {
            gameState.timestamps.fin = new Date().toISOString();
        }
        Persistencia.guardar();
        SCORM.marcarCompletado();
        SCORM.cerrar();
    },

    reiniciar() {
        Persistencia.detenerAutosave();
        Persistencia.limpiar();
        location.reload();
    }
};

if (typeof window !== 'undefined') {
    window.Darabia = Darabia;
}

/* ============================================================================
 * FIN · script_caso05_core.js · v6.0.0
 * ============================================================================ */
