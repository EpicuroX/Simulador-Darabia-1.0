/* ==========================================================================
   DARABIA ENGINE V6 · CONSOLA DE PERITAJE PSICOSOCIAL
   script_ui.js · v6.0.0 — capa 3B
   --------------------------------------------------------------------------
   Esta capa monta:
     - Shell completo (header con 2 líneas, workspace 2 paneles, footer).
     - Panel izquierdo funcional: acordeón Documentos/Transcripciones,
       lista de items, visor de documento abierto con botón volver y Esc.
     - Panel derecho con placeholder (capa 3C lo reescribe con el editor).
     - Botones de footer (no funcionales: capa 6 y capa 7 los conectan).

   Filosofía:
     - Shell caso-agnóstico: todo se construye desde el JSON sin asumir
       cuántos documentos, transcripciones o secciones hay.
     - Sin animaciones de layout. Solo color/opacity en hover/focus.
     - DOM mínimo: si no hay documentos, no se renderiza el grupo.

   Consume del motor:
     window.Darabia.caso              → JSON cargado
     window.Darabia.estado            → gameState
     window.Darabia.Dictamen          → para tabs y progreso
     window.Darabia.Evaluador         → para botón feedback
     window.Darabia.finalizar()       → al cerrar el flujo
   ========================================================================== */

'use strict';

(function () {

    /* ======================================================================
       0 · UTILIDADES
       ====================================================================== */

    /** querySelector corto */
    const $ = (sel, root = document) => root.querySelector(sel);

    /** querySelectorAll → array */
    const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

    /**
     * Crea un elemento DOM con atributos y children.
     * Atajos:
     *   class: 'foo bar'      → className
     *   data: { foo: 'bar' }  → data-foo
     *   onclick: fn           → addEventListener
     *   children pueden ser strings (textNode), nodos, arrays, o falsy (skip).
     */
    function el(tag, attrs, ...children) {
        const node = document.createElement(tag);
        if (attrs) {
            for (const [k, v] of Object.entries(attrs)) {
                if (v === false || v == null) continue;
                if (k === 'class') node.className = v;
                else if (k === 'data') Object.assign(node.dataset, v);
                else if (k === 'html') node.innerHTML = v;
                else if (k.startsWith('on') && typeof v === 'function') {
                    node.addEventListener(k.slice(2), v);
                } else if (v === true) node.setAttribute(k, '');
                else node.setAttribute(k, v);
            }
        }
        for (const child of children.flat()) {
            if (child == null || child === false) continue;
            node.appendChild(typeof child === 'string'
                ? document.createTextNode(child)
                : child);
        }
        return node;
    }

    /** Escape HTML básico para strings inyectados. */
    function escapeHtml(s) {
        return String(s ?? '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }


    /* ======================================================================
       1 · ESTADO DE LA UI (separado del gameState del motor)
       ====================================================================== */
    const UIState = {
        /** id del documento o transcripción abierto en el visor (null = lista) */
        itemAbierto: null,
        /** tipo del item abierto: 'documento' | 'transcripcion' | null */
        itemAbiertoTipo: null,
        /** estado de cada grupo del acordeón (id → bool colapsado) */
        gruposColapsados: { documentos: false, transcripciones: false }
    };


    /* ======================================================================
       2 · MONTAJE DEL SHELL
       ====================================================================== */

    function montarShell() {
        const root = $('#darabia-root');
        if (!root) {
            console.error('[UI v6] No se encontró #darabia-root.');
            return;
        }
        root.innerHTML = '';
        document.body.classList.remove('drawer-left-open');

        root.appendChild(montarHeader());
        root.appendChild(montarWorkspace());
        root.appendChild(montarFooter());

        // Atajo global: Esc cierra el visor si está abierto.
        // Nos protegemos contra montajes repetidos (por ejemplo, si el shell
        // se vuelve a montar sin recargar la página): removeEventListener
        // antes de addEventListener garantiza un único listener activo.
        document.removeEventListener('keydown', onKeydownGlobal);
        document.addEventListener('keydown', onKeydownGlobal);
    }

    function onKeydownGlobal(e) {
        if (e.key === 'Escape' && UIState.itemAbierto) {
            cerrarVisor();
        }
    }


    /* ======================================================================
       3 · HEADER (dos líneas — Ajuste 1 del briefing)
       ====================================================================== */

    function montarHeader() {
        const caso = window.Darabia?.caso?.caso;
        const contexto = window.Darabia?.caso?.contexto;
        const alumno = window.Darabia?.estado?.alumno;

        // Línea 2 (contexto) — fallback elegante si falta info
        const contextoTexto = [
            caso?.titulo,
            contexto?.empresa
        ].filter(Boolean).join(' · ');

        return el('header', { class: 'topbar' },

            // Bloque marca + contexto (izquierda)
            el('div', { class: 'topbar-brand-block' },
                el('div', { class: 'topbar-line-1' },
                    el('span', { class: 'topbar-mark' }, 'D'),
                    'DARABIA · Consola de Peritaje'
                ),
                contextoTexto
                    ? el('div', { class: 'topbar-line-2', id: 'topbar-line-2' }, contextoTexto)
                    : null
            ),

            // Acciones (derecha)
            el('div', { class: 'topbar-actions' },
                // Botón cajón móvil (solo visible < 800px gracias al CSS)
                el('button', {
                    class: 'topbar-mobile-toggle',
                    type: 'button',
                    onclick: () => document.body.classList.toggle('drawer-left-open'),
                    'aria-label': 'Abrir expediente'
                }, '📁 Expediente'),

                // Bloque alumno
                alumno?.validado
                    ? el('div', { class: 'topbar-alumno' },
                        escapeHtml(alumno.nombre),
                        alumno.grupo
                            ? el('span', { class: 'topbar-alumno-grupo' }, '· ' + escapeHtml(alumno.grupo))
                            : null
                    )
                    : null
            )
        );
    }


    /* ======================================================================
       4 · WORKSPACE (dos columnas)
       ====================================================================== */

    function montarWorkspace() {
        const ws = el('div', { class: 'workspace', id: 'workspace' });
        ws.appendChild(montarPanelIzquierdo());
        ws.appendChild(montarPanelDerecho());
        return ws;
    }


    /* ======================================================================
       5 · PANEL IZQUIERDO · EXPEDIENTE
       ====================================================================== */

    function montarPanelIzquierdo() {
        // Contenedor vacío — el contenido lo pinta renderPanelIzquierdo()
        return el('aside', { class: 'panel panel-left', id: 'panel-left' });
    }

    /**
     * Renderiza el panel izquierdo en uno de dos modos:
     *   - "lista":  cabecera EXPEDIENTE + acordeón con grupos
     *   - "visor":  toolbar con botón volver + contenido del item
     */
    function renderPanelIzquierdo() {
        const panel = $('#panel-left');
        if (!panel) return;
        panel.innerHTML = '';

        if (UIState.itemAbierto) {
            renderVisor(panel);
        } else {
            renderListaExpediente(panel);
        }
    }


    /* ----- 5a · LISTA (acordeón) ----- */

    function renderListaExpediente(panel) {
        const caso = window.Darabia?.caso || {};
        const docs = caso.documentos || [];
        const trans = caso.transcripciones || [];

        // Cabecera
        panel.appendChild(
            el('div', { class: 'panel-header' },
                el('div', { class: 'panel-title' }, 'Expediente')
            )
        );

        // Body con acordeón
        const body = el('div', { class: 'panel-body' });

        // Caso-agnóstico: solo se renderiza un grupo si tiene elementos
        if (docs.length > 0) {
            body.appendChild(montarGrupoAcordeon('documentos', 'Documentos', docs, 'documento'));
        }
        if (trans.length > 0) {
            body.appendChild(montarGrupoAcordeon('transcripciones', 'Transcripciones', trans, 'transcripcion'));
        }

        // Caso degenerado: ningún elemento en el JSON
        if (docs.length === 0 && trans.length === 0) {
            body.appendChild(
                el('div', {
                    class: 'doc-locked-mini',
                    style: 'margin: 16px;'
                }, 'El expediente de este caso no contiene documentos ni transcripciones.')
            );
        }

        panel.appendChild(body);
    }

    /**
     * Genera un grupo del acordeón (Documentos o Transcripciones).
     * Caso-agnóstico: el motor pasa el array de items, esta función no
     * sabe nada de su contenido.
     *
     * @param {string} grupoId        clave en UIState.gruposColapsados
     * @param {string} etiqueta       texto visible (ej. "Documentos")
     * @param {Array}  items          array de items del JSON
     * @param {string} itemTipo       'documento' | 'transcripcion'
     */
    function montarGrupoAcordeon(grupoId, etiqueta, items, itemTipo) {
        const colapsado = UIState.gruposColapsados[grupoId];
        const grupo = el('section', {
            class: 'expediente-grupo' + (colapsado ? ' is-collapsed' : ''),
            data: { grupo: grupoId }
        });

        // Cabecera del grupo (clic para colapsar)
        const header = el('button', {
            class: 'expediente-grupo-header',
            type: 'button',
            'aria-expanded': !colapsado,
            onclick: () => toggleGrupo(grupoId)
        },
            el('span', { class: 'expediente-grupo-caret' }, '▾'),
            etiqueta,
            el('span', { class: 'expediente-grupo-count' }, `(${items.length})`)
        );
        grupo.appendChild(header);

        // Lista de items, ordenada por la propiedad 'orden' si existe
        const lista = el('div', { class: 'expediente-grupo-list' });
        const ordenados = [...items].sort((a, b) => (a.orden || 0) - (b.orden || 0));

        for (const item of ordenados) {
            lista.appendChild(montarItemExpediente(item, itemTipo));
        }
        grupo.appendChild(lista);

        return grupo;
    }

    /**
     * Genera un item de la lista (un documento o una transcripción).
     * Lee del JSON tres campos comunes: id, icono, titulo.
     * Para transcripciones, además: trabajador, fecha, duracion.
     */
    function montarItemExpediente(item, tipo) {
        // Para transcripciones, el "título" es el nombre del trabajador,
        // y el "meta" es la fecha + duración.
        // Para documentos, el "título" es el campo titulo, sin meta visible.
        let titulo, meta;
        if (tipo === 'transcripcion') {
            titulo = item.trabajador || item.id;
            const partes = [];
            if (item.fecha) partes.push(formatearFecha(item.fecha));
            if (item.duracion) partes.push(item.duracion);
            meta = partes.join(' · ');
        } else {
            titulo = item.titulo || item.id;
            meta = '';
        }

        return el('button', {
            class: 'expediente-item',
            type: 'button',
            data: { id: item.id, tipo },
            onclick: (e) => abrirItem(item, tipo, e.currentTarget)
        },
            el('span', { class: 'expediente-item-icon' }, item.icono || '·'),
            el('span', { class: 'expediente-item-body' },
                el('span', { class: 'expediente-item-titulo' }, titulo),
                meta ? el('span', { class: 'expediente-item-meta' }, meta) : null
            )
        );
    }

    function formatearFecha(iso) {
        // 2026-04-08 → 08/04
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
        return m ? `${m[3]}/${m[2]}` : iso;
    }

    function toggleGrupo(grupoId) {
        UIState.gruposColapsados[grupoId] = !UIState.gruposColapsados[grupoId];
        renderPanelIzquierdo();
    }


    /* ----- 5b · VISOR DE DOCUMENTO ABIERTO ----- */

    function abrirItem(item, tipo, elementoOrigen) {
        UIState.itemAbierto = item.id;
        UIState.itemAbiertoTipo = tipo;
        renderPanelIzquierdo();
        // Tras renderizar, llevar el foco al botón "← Volver" para a11y.
        const back = $('.visor-back');
        if (back) back.focus();
    }

    function cerrarVisor() {
        const idAnterior = UIState.itemAbierto;
        UIState.itemAbierto = null;
        UIState.itemAbiertoTipo = null;
        renderPanelIzquierdo();
        // Devolver foco al item que se había abierto (a11y).
        if (idAnterior) {
            const item = $(`.expediente-item[data-id="${idAnterior}"]`);
            if (item) item.focus();
        }
    }

    function renderVisor(panel) {
        const caso = window.Darabia?.caso || {};
        const tipo = UIState.itemAbiertoTipo;
        const lista = tipo === 'transcripcion' ? caso.transcripciones : caso.documentos;
        const item = (lista || []).find(x => x.id === UIState.itemAbierto);

        if (!item) {
            // El JSON cambió o el id es inválido. Volver a la lista.
            console.warn('[UI v6] Item no encontrado:', UIState.itemAbierto);
            UIState.itemAbierto = null;
            UIState.itemAbiertoTipo = null;
            renderListaExpediente(panel);
            return;
        }

        // Toolbar del visor
        const titulo = tipo === 'transcripcion'
            ? `${item.trabajador || ''}${item.fecha ? ' · ' + formatearFechaCompleta(item.fecha) : ''}`.trim()
            : item.titulo || item.id;

        const toolbar = el('div', { class: 'visor-toolbar' },
            el('button', {
                class: 'visor-back',
                type: 'button',
                onclick: cerrarVisor,
                'aria-label': 'Volver al expediente'
            },
                el('span', { class: 'visor-back-arrow' }, '←'),
                'Volver'
            ),
            el('div', { class: 'visor-titulo', title: titulo }, titulo)
        );

        // Contenido: HTML del JSON. Tablas envueltas para scroll horizontal.
        //
        // SEGURIDAD: el HTML que se inyecta aquí proviene del JSON del caso,
        // que es contenido trusted (lo escribe el profesor, no un usuario
        // externo). Por eso usamos innerHTML directamente sin sanitizar.
        // Si en el futuro el JSON pudiera ser editado por terceros (alumnos
        // generando casos, p.ej.), reemplazar innerHTML por un sanitizador
        // (DOMPurify o similar) ANTES de inyectar.
        const content = el('div', { class: 'visor-content' });
        content.innerHTML = item.html || '<p>(sin contenido)</p>';
        envolverTablasParaScroll(content);

        // Contenedor con scroll interno
        const visor = el('div', { class: 'visor' }, toolbar, content);
        panel.appendChild(visor);
    }

    function formatearFechaCompleta(iso) {
        if (!iso) return '';
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
        return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
    }

    /**
     * Envuelve cada <table> del visor en <div class="visor-tabla-wrap">
     * para permitir scroll horizontal local sin romper la maquetación
     * (sugerencia 2 del usuario al revisar el CSS).
     */
    function envolverTablasParaScroll(contentNode) {
        const tablas = contentNode.querySelectorAll('table');
        for (const tabla of tablas) {
            // Idempotente: si ya está envuelta, no hacer nada.
            if (tabla.parentElement?.classList?.contains('visor-tabla-wrap')) continue;
            const wrap = document.createElement('div');
            wrap.className = 'visor-tabla-wrap';
            tabla.parentNode.insertBefore(wrap, tabla);
            wrap.appendChild(tabla);
        }
    }


    /* ======================================================================
       6 · PANEL DERECHO · DICTAMEN (capa 3C)
       ======================================================================
       Render del editor del dictamen. Lee la estructura desde
       Darabia.Dictamen.secciones() — caso-agnóstico.

       Para cada sección del JSON crea una tab. Al pulsar una tab, renderiza
       el editor según su tipo:
           tipo: "texto" → un único <textarea> editable
           tipo: "tabla" → tabla HTML con inputs/textareas en celdas

       Persistencia: cada cambio del usuario llama a Darabia.Dictamen.*
       con debounce de 600ms, salvo cambios estructurales (añadir/eliminar
       fila) que se persisten inmediatamente. */

    /** id de la sección activa actualmente. null = todavía no inicializado. */
    let seccionActivaId = null;

    /** Mapa filaId → timer de confirmación de borrado activo. */
    const confirmacionBorradoTimers = new Map();

    /**
     * Devuelve un debouncer por clave. Útil para tener un debounce
     * independiente por cada celda de tabla / textarea, sin colisiones.
     */
    const debouncers = new Map();
    function debouncePorClave(clave, fn, ms = 600) {
        const ant = debouncers.get(clave);
        if (ant) clearTimeout(ant);
        const t = setTimeout(() => {
            debouncers.delete(clave);
            fn();
        }, ms);
        debouncers.set(clave, t);
    }

    function montarPanelDerecho() {
        return el('aside', { class: 'panel panel-editor', id: 'panel-editor' },
            el('div', { class: 'editor-tabs', id: 'editor-tabs' }),
            el('div', { class: 'editor-canvas', id: 'editor-canvas' })
        );
    }

    /**
     * Renderiza tabs + sección activa. Idempotente: se puede llamar varias
     * veces, vuelve a pintar todo. NO toca scroll ni foco salvo si la
     * sección activa cambia (porque el alumno cambió de tab).
     */
    function renderEditor() {
        const secciones = window.Darabia?.Dictamen?.secciones?.() || [];
        if (secciones.length === 0) {
            console.warn('[UI v6] Sin secciones de dictamen en el JSON.');
            return;
        }

        // Si no hay sección activa o la activa ya no existe, tomar la primera.
        if (!seccionActivaId || !secciones.find(s => s.id === seccionActivaId)) {
            seccionActivaId = secciones[0].id;
        }

        renderTabs(secciones);
        renderSeccionActiva(secciones);
        actualizarFooterProgreso();
        actualizarBotonFeedback();
    }


    /* ----- 6a · TABS ----- */

    function renderTabs(secciones) {
        const cont = $('#editor-tabs');
        if (!cont) return;
        cont.innerHTML = '';

        secciones.forEach((sec, idx) => {
            const tieneContenido = seccionTieneContenido(sec);
            const activa = sec.id === seccionActivaId;
            const num = String(idx + 1).padStart(2, '0');

            const tab = el('button', {
                class: 'editor-tab'
                    + (activa ? ' is-active' : '')
                    + (tieneContenido ? ' has-content' : ''),
                type: 'button',
                'aria-selected': activa,
                onclick: () => seleccionarSeccion(sec.id)
            },
                el('span', { class: 'editor-tab-dot' }),
                el('span', { class: 'editor-tab-num' }, num),
                sec.etiqueta
            );
            cont.appendChild(tab);
        });
    }

    function seleccionarSeccion(id) {
        if (seccionActivaId === id) return;
        // Antes de cambiar, forzar el guardado de cualquier debounce pendiente
        // para no perder los últimos caracteres tecleados.
        forzarFlushDebouncers();
        seccionActivaId = id;
        renderEditor();
    }

    function forzarFlushDebouncers() {
        for (const [clave, timer] of debouncers.entries()) {
            clearTimeout(timer);
        }
        debouncers.clear();
        // Nota: no re-ejecuta los callbacks pendientes — son guardados a Dictamen
        // que ya tienen su propio mecanismo (Persistencia.guardar). El último
        // valor del DOM se persiste explícitamente al cambiar de tab si hace
        // falta, vía guardarSeccionActivaSiTexto().
        guardarSeccionActivaSiTexto();
    }

    /**
     * Si la sección activa es de tipo texto, persiste el contenido actual
     * del textarea en Dictamen. Útil al cambiar de tab.
     */
    function guardarSeccionActivaSiTexto() {
        const ta = $('#editor-textarea');
        if (!ta || !seccionActivaId) return;
        const D = window.Darabia?.Dictamen;
        if (!D) return;
        const meta = D.secciones().find(s => s.id === seccionActivaId);
        if (meta?.tipo === 'texto') {
            try {
                D.setTexto(seccionActivaId, ta.value);
            } catch (e) {
                console.warn('[UI v6] Error guardando sección activa:', e);
            }
        }
    }


    /* ----- 6b · ENCABEZADO + RENDER POR TIPO ----- */

    function renderSeccionActiva(secciones) {
        const canvas = $('#editor-canvas');
        if (!canvas) return;
        canvas.innerHTML = '';

        const meta = secciones.find(s => s.id === seccionActivaId);
        if (!meta) return;
        const idx = secciones.indexOf(meta);

        // Encabezado de la sección (siempre presente)
        canvas.appendChild(montarSeccionHeader(meta, idx));

        // Aviso de evaluación (Ajuste 3 del briefing) — solo si el JSON lo define
        if (meta.tipo === 'tabla' && meta.aviso_evaluacion) {
            canvas.appendChild(montarAvisoEvaluacion(meta.aviso_evaluacion));
        }

        // Render según tipo
        if (meta.tipo === 'texto') {
            canvas.appendChild(montarEditorTexto(meta));
        } else if (meta.tipo === 'tabla') {
            canvas.appendChild(montarEditorTabla(meta));
        }
    }

    function montarSeccionHeader(meta, idx) {
        const num = String(idx + 1).padStart(2, '0');
        return el('div', { class: 'editor-section-head' },
            el('div', { class: 'editor-section-titulo' },
                el('span', { class: 'editor-section-titulo-num' }, num + ' ·'),
                meta.etiqueta
            ),
            meta.ayuda
                ? el('div', { class: 'editor-section-ayuda' }, meta.ayuda)
                : null
        );
    }

    function montarAvisoEvaluacion(texto) {
        return el('div', { class: 'editor-section-aviso' },
            el('span', { class: 'editor-section-aviso-icon' }, '⚠'),
            el('span', null, texto)
        );
    }


    /* ----- 6c · EDITOR DE TEXTO ----- */

    function montarEditorTexto(meta) {
        const valorActual = window.Darabia?.Dictamen?.getTexto?.(meta.id) || '';

        const wrap = el('div', { class: 'editor-texto-wrap' });
        const textarea = el('textarea', {
            class: 'editor-texto',
            id: 'editor-textarea',
            placeholder: meta.placeholder || '',
            spellcheck: 'true',
            oninput: onInputTextarea
        });
        textarea.value = valorActual;
        wrap.appendChild(textarea);

        // Llevar foco al textarea tras el render (UX: el alumno empieza a
        // escribir directamente al cambiar de sección).
        // Lo programamos en el siguiente tick para no interferir con el
        // flujo síncrono de innerHTML clearing.
        setTimeout(() => {
            const node = $('#editor-textarea');
            if (node) {
                // Posiciona el cursor al final del texto, no al inicio.
                const len = node.value.length;
                node.focus();
                node.setSelectionRange(len, len);
            }
        }, 0);

        return wrap;
    }

    function onInputTextarea(e) {
        const ta = e.currentTarget;
        const D = window.Darabia?.Dictamen;
        if (!D || !seccionActivaId) return;

        marcarGuardando();

        debouncePorClave('texto:' + seccionActivaId, () => {
            try {
                D.setTexto(seccionActivaId, ta.value);
                marcarGuardado('idle');
                refrescarTabsContenido();
                actualizarFooterProgreso();
                actualizarBotonFeedback();
            } catch (err) {
                console.warn('[UI v6] Error en setTexto:', err);
                marcarGuardado('error');
            }
        });
    }


    /* ----- 6d · TABLA DEL PLAN DE ACCIÓN ----- */

    function montarEditorTabla(meta) {
        const D = window.Darabia?.Dictamen;
        const filas = D?.getFilas?.(meta.id) || [];
        const columnas = meta.columnas || [];

        const wrap = el('div', { class: 'editor-tabla-wrap' });

        // Tabla
        const tabla = el('table', { class: 'editor-tabla' });

        // Colgroup con anchos del JSON (caso-agnóstico)
        const colgroup = document.createElement('colgroup');
        for (const col of columnas) {
            const c = document.createElement('col');
            if (col.ancho) c.style.width = col.ancho;
            colgroup.appendChild(c);
        }
        // Columna extra para el botón de eliminar
        const colAcciones = document.createElement('col');
        colAcciones.style.width = '36px';
        colgroup.appendChild(colAcciones);
        tabla.appendChild(colgroup);

        // thead
        const thead = el('thead');
        const trHead = el('tr');
        for (const col of columnas) {
            trHead.appendChild(el('th', null, col.etiqueta));
        }
        trHead.appendChild(el('th', { class: 'col-acciones', 'aria-label': 'Acciones' }));
        thead.appendChild(trHead);
        tabla.appendChild(thead);

        // tbody
        const tbody = el('tbody', { id: 'editor-tabla-tbody' });
        for (const fila of filas) {
            tbody.appendChild(montarFilaTabla(meta, fila));
        }
        tabla.appendChild(tbody);
        wrap.appendChild(tabla);

        // Botón añadir fila
        const max = meta.max_filas ?? Infinity;
        const limiteAlcanzado = filas.length >= max;
        const btnAnadir = el('button', {
            class: 'editor-tabla-anadir',
            type: 'button',
            disabled: limiteAlcanzado,
            onclick: onClickAnadirFila,
            title: limiteAlcanzado ? `Máximo ${max} filas` : 'Añadir una nueva fila al plan de acción'
        }, '+ Añadir fila');
        wrap.appendChild(btnAnadir);

        return wrap;
    }

    function montarFilaTabla(meta, fila) {
        const tr = el('tr', { data: { fila: fila.id } });

        for (const col of meta.columnas || []) {
            tr.appendChild(montarCeldaTabla(meta, fila, col));
        }
        // Celda de acciones
        tr.appendChild(montarCeldaAcciones(meta, fila));

        return tr;
    }

    function montarCeldaTabla(meta, fila, col) {
        const valor = fila[col.id] || '';
        const td = el('td');

        // Tipo de input según col.tipo del JSON
        const esTextoLargo = col.tipo === 'texto_largo';
        const tag = esTextoLargo ? 'textarea' : 'input';

        const opts = {
            class: esTextoLargo ? 'editor-celda-textarea' : 'editor-celda-input',
            data: { fila: fila.id, col: col.id },
            placeholder: col.etiqueta,
            'aria-label': col.etiqueta,
            oninput: onInputCelda
        };
        if (!esTextoLargo) opts.type = 'text';

        const input = el(tag, opts);
        if (esTextoLargo) {
            input.value = valor;
            input.rows = 2;
        } else {
            input.value = valor;
        }
        td.appendChild(input);
        return td;
    }

    function montarCeldaAcciones(meta, fila) {
        const D = window.Darabia?.Dictamen;
        const filas = D?.getFilas?.(meta.id) || [];
        const min = meta.min_filas ?? 0;
        const puedeEliminar = filas.length > min;

        const btn = el('button', {
            class: 'editor-fila-borrar',
            type: 'button',
            disabled: !puedeEliminar,
            'aria-label': 'Eliminar fila',
            data: { fila: fila.id },
            title: puedeEliminar ? 'Eliminar esta fila' : `Mínimo ${min} fila(s) requerida(s)`,
            onclick: onClickEliminarFila
        }, '✕');

        const td = el('td', { class: 'col-acciones' }, btn);
        return td;
    }


    /* ----- 6d.bis · INTERACCIÓN DE TABLA ----- */

    function onInputCelda(e) {
        const input = e.currentTarget;
        const filaId = input.dataset.fila;
        const colId = input.dataset.col;
        if (!filaId || !colId || !seccionActivaId) return;

        const D = window.Darabia?.Dictamen;
        if (!D) return;

        marcarGuardando();

        debouncePorClave(`celda:${seccionActivaId}:${filaId}:${colId}`, () => {
            try {
                D.setCampoFila(seccionActivaId, filaId, colId, input.value);
                marcarGuardado('idle');
                refrescarTabsContenido();
                actualizarFooterProgreso();
                actualizarBotonFeedback();
            } catch (err) {
                console.warn('[UI v6] Error en setCampoFila:', err);
                marcarGuardado('error');
            }
        });
    }

    function onClickAnadirFila() {
        const D = window.Darabia?.Dictamen;
        if (!D || !seccionActivaId) return;

        const nuevoId = D.anadirFila(seccionActivaId);
        if (!nuevoId) {
            console.warn('[UI v6] No se pudo añadir fila (¿límite alcanzado?).');
            return;
        }

        // Re-render de la sección. Más simple y robusto que insertar el TR
        // a mano y luego tener que sincronizar el estado del botón eliminar
        // de la primera fila (que pasa de deshabilitado a habilitado al
        // tener una segunda fila).
        const secciones = window.Darabia.Dictamen.secciones();
        renderSeccionActiva(secciones);
        actualizarFooterProgreso();

        // Foco en la primera celda de la fila recién creada (UX).
        setTimeout(() => {
            const sel = `[data-fila="${nuevoId}"] input, [data-fila="${nuevoId}"] textarea`;
            const primera = document.querySelectorAll(sel)[0];
            if (primera) primera.focus();
        }, 0);
    }

    /**
     * Eliminación con confirmación inline:
     *   - Primer click: el botón cambia a "✕ ¿Seguro?" durante 3 segundos.
     *   - Segundo click dentro de 3s: confirma y elimina.
     *   - Si pasan 3s sin segundo click: vuelve a estado normal.
     */
    function onClickEliminarFila(e) {
        const btn = e.currentTarget;
        const filaId = btn.dataset.fila;
        if (!filaId) return;

        const enConfirmacion = btn.classList.contains('is-confirmando');

        if (enConfirmacion) {
            // Segundo click → eliminar
            const timer = confirmacionBorradoTimers.get(filaId);
            if (timer) clearTimeout(timer);
            confirmacionBorradoTimers.delete(filaId);

            const D = window.Darabia?.Dictamen;
            if (!D || !seccionActivaId) return;

            const eliminado = D.eliminarFila(seccionActivaId, filaId);
            if (!eliminado) {
                console.warn('[UI v6] No se pudo eliminar fila', filaId);
                return;
            }

            // Re-render
            const secciones = window.Darabia.Dictamen.secciones();
            renderSeccionActiva(secciones);
            actualizarFooterProgreso();
            refrescarTabsContenido();
            return;
        }

        // Primer click → mostrar confirmación
        // Limpiar cualquier confirmación previa pendiente en otra fila.
        for (const [otroId, timer] of confirmacionBorradoTimers.entries()) {
            clearTimeout(timer);
            const otroBtn = document.querySelector(
                `.editor-fila-borrar[data-fila="${otroId}"]`);
            if (otroBtn) {
                otroBtn.classList.remove('is-confirmando');
                otroBtn.textContent = '✕';
            }
        }
        confirmacionBorradoTimers.clear();

        btn.classList.add('is-confirmando');
        btn.textContent = '✕ ¿Seguro?';

        const timer = setTimeout(() => {
            btn.classList.remove('is-confirmando');
            btn.textContent = '✕';
            confirmacionBorradoTimers.delete(filaId);
        }, 3000);
        confirmacionBorradoTimers.set(filaId, timer);
    }


    /* ----- 6e · HELPERS DE ESTADO PARA TABS Y FOOTER ----- */

    /**
     * Refresca solo la clase has-content y el dot de cada tab, sin
     * re-renderizar el contenido del editor (evita perder cursor).
     */
    function refrescarTabsContenido() {
        const tabs = $$('.editor-tab', $('#editor-tabs'));
        const secciones = window.Darabia?.Dictamen?.secciones?.() || [];
        if (tabs.length !== secciones.length) {
            // Inconsistencia → re-render completo
            renderEditor();
            return;
        }
        secciones.forEach((sec, idx) => {
            const tab = tabs[idx];
            if (!tab) return;
            const tiene = seccionTieneContenido(sec);
            tab.classList.toggle('has-content', tiene);
        });
    }

    /** Devuelve true si la sección tiene contenido editado por el alumno. */
    function seccionTieneContenido(meta) {
        const D = window.Darabia?.Dictamen;
        if (!D) return false;
        if (meta.tipo === 'texto') {
            return (D.getTexto(meta.id) || '').trim().length > 0;
        }
        if (meta.tipo === 'tabla') {
            const filas = D.getFilas(meta.id) || [];
            return filas.some(fila =>
                (meta.columnas || []).some(col =>
                    (fila[col.id] || '').toString().trim().length > 0
                )
            );
        }
        return false;
    }

    /** Actualiza el contador "Secciones completadas: N / M" del footer. */
    function actualizarFooterProgreso() {
        const node = $('#footer-progress-num');
        if (!node) return;
        const secciones = window.Darabia?.Dictamen?.secciones?.() || [];
        const completadas = secciones.filter(seccionTieneContenido).length;
        node.textContent = String(completadas);
    }

    /**
     * Refresca el estado visual del botón "Pedir consejo" + el texto
     * auxiliar bajo el botón.
     *
     * Tres estados (capa 6D-2):
     *
     *   A. Sin contenido suficiente (gatekeeper bloqueante):
     *      - Botón deshabilitado, tooltip "Escribe al menos un párrafo..."
     *      - Texto auxiliar OCULTO (no tiene sentido contar consultas
     *        cuando aún no se puede pedir).
     *
     *   B. Con contenido y consultas restantes > 0:
     *      - Botón habilitado.
     *      - Texto auxiliar visible:
     *          "Te quedan 2 consultas con Honás Darabia"
     *          "Te queda 1 consulta con Honás Darabia"
     *
     *   C. Sin consultas restantes (=== 0):
     *      - Botón DESHABILITADO (mismo aspecto, con disabled=true).
     *      - Texto auxiliar visible:
     *          "Las 2 consultas ya se han usado. El cierre técnico
     *           se generará al pedir el PDF."
     */
    function actualizarBotonFeedback() {
        const btn = $('#btn-feedback');
        const aux = $('#footer-consultas-aux');
        if (!btn) return;

        const E = window.Darabia?.Evaluador;
        if (!E) return;

        const hayContenido = E.tieneAlgoQueEvaluar?.() || false;
        const restantes = E.consultasRestantes?.() ?? 2;

        // Estado A: sin contenido (gatekeeper bloquea)
        if (!hayContenido) {
            btn.disabled = true;
            btn.title = 'Escribe al menos un párrafo antes de consultar a Honás Darabia.';
            if (aux) {
                aux.textContent = '';
                aux.classList.remove('is-visible', 'is-agotado');
            }
            return;
        }

        // Estado C: sin consultas restantes
        if (restantes <= 0) {
            btn.disabled = true;
            btn.title = 'Ya has usado tus consultas. Genera el PDF para recibir el cierre técnico.';
            if (aux) {
                aux.textContent = 'Ya has usado tus 2 consultas. El cierre técnico se generará al pedir el PDF.';
                aux.classList.add('is-visible', 'is-agotado');
            }
            return;
        }

        // Estado B: contenido OK + consultas disponibles
        btn.disabled = false;
        btn.title = 'Solicitar consejo de Honás Darabia';
        if (aux) {
            aux.textContent = restantes === 1
                ? 'Te queda 1 consulta con Honás Darabia'
                : `Te quedan ${restantes} consultas con Honás Darabia`;
            aux.classList.add('is-visible');
            aux.classList.remove('is-agotado');
        }
    }


    /* ====================================================================== */
    /* helper: marcador de "guardando" inmediato (sin esperar al debounce)    */
    /* ====================================================================== */
    function marcarGuardando() {
        marcarGuardado('saving');
    }


    /* ======================================================================
       7 · FOOTER · barra de estado + botones
       ====================================================================== */

    function montarFooter() {
        return el('footer', { class: 'footer' },
            // Estado de guardado + progreso
            el('div', { class: 'footer-status' },
                el('span', { class: 'save-dot', id: 'save-dot' }),
                el('span', { id: 'save-text' }, 'Listo'),
                // Progreso de secciones (capa 3C lo conecta a Dictamen)
                el('span', { class: 'footer-progress', id: 'footer-progress' },
                    'Secciones completadas:',
                    el('span', { class: 'footer-progress-num', id: 'footer-progress-num' }, '0'),
                    '/',
                    el('span', { class: 'footer-progress-num' }, String(totalSecciones()))
                )
            ),
            // Botones de acción global
            el('div', { class: 'footer-actions' },
                // Bloque del botón Pedir consejo (con texto auxiliar debajo)
                el('div', { class: 'footer-consejo-bloque' },
                    el('button', {
                        class: 'btn btn-secondary',
                        id: 'btn-feedback',
                        type: 'button',
                        disabled: true,
                        onclick: onClickFeedback,
                        title: 'Escribe al menos un párrafo antes de consultar a Honás Darabia.'
                    }, '🕵️ Pedir consejo'),
                    el('div', {
                        class: 'footer-consultas-aux',
                        id: 'footer-consultas-aux'
                    }, '')   // se rellena dinámicamente
                ),
                el('button', {
                    class: 'btn btn-primary',
                    id: 'btn-pdf',
                    type: 'button',
                    onclick: onClickPDF
                }, '📄 Generar PDF')
            )
        );
    }

    function totalSecciones() {
        return (window.Darabia?.Dictamen?.secciones?.() || []).length;
    }

    function onClickFeedback() {
        ModalFeedback.abrir();
    }

    function onClickPDF() {
        // Capa 7: tres caminos posibles.
        //   1. SIN cierre persistido           → ModalFriccionPDF
        //   2. CON cierre · primera apertura   → ModalCierre (mostrar persistido)
        //   3. CON cierre · ya visto y cerrado → generarPDF() directo
        //
        // El estado intermedio "ya he visto el cierre, ahora quiero el PDF"
        // se marca con la propiedad _cierreYaMostrado del ModalCierre, que
        // se activa al cerrar el modal del cierre por primera vez.
        const E = window.Darabia?.Evaluador;
        const cierre = E?.obtenerCierrePersistido?.() || null;

        if (!cierre) {
            // Camino 1: sin cierre → fricción
            ModalFriccionPDF.abrir();
            return;
        }

        if (!ModalCierre._cierreYaMostrado) {
            // Camino 2: cierre persistido pero el alumno aún no lo ha visto
            // (o ha recargado la página y no lo ha mirado tras la recarga).
            ModalCierre.abrir();
            return;
        }

        // Camino 3: alumno ya vio el cierre → generar PDF directo
        generarPDF();
    }

    /**
     * Lanza la generación del PDF a través de PDFGenerator.
     * Muestra ModalGenerandoPDF mientras se genera y captura errores.
     */
    async function generarPDF() {
        const PG = window.Darabia?.PDFGenerator;
        if (!PG || typeof PG.generar !== 'function') {
            alert('El generador de PDF no está disponible. Recarga la página e inténtalo de nuevo.');
            return;
        }

        ModalGenerandoPDF.abrir();
        try {
            await PG.generar();
        } catch (err) {
            console.error('[PDF] Error al generar:', err);
            alert('No se ha podido generar el PDF. Recarga la página e inténtalo de nuevo.\n\nDetalle: ' + (err.message || err));
        } finally {
            ModalGenerandoPDF.cerrar();
        }
    }


    /* ======================================================================
       7.quater · MODAL DE GENERACIÓN DEL PDF (capa 7)
       ======================================================================
       Loading simple mientras html2pdf renderiza el documento. Sin
       interacción del usuario: se abre antes de generar y se cierra
       automáticamente cuando termina (éxito o error).
       ====================================================================== */

    const ModalGenerandoPDF = {
        _backdrop: null,
        _abierto: false,

        abrir() {
            if (this._abierto) return;
            this._asegurarMontado();
            this._abierto = true;
            this._backdrop.classList.add('is-open');
        },

        cerrar() {
            if (!this._abierto) return;
            this._abierto = false;
            if (this._backdrop) this._backdrop.classList.remove('is-open');
        },

        _asegurarMontado() {
            if (this._backdrop) return;

            const backdrop = el('div', {
                class: 'pdfgen-backdrop',
                id: 'pdfgen-backdrop'
                // Sin onclick: este modal no se cierra manualmente.
            });

            const modal = el('div', { class: 'pdfgen-modal' },
                el('div', { class: 'fb-spinner' }),
                el('div', { class: 'pdfgen-msg' }, 'Generando PDF...')
            );

            backdrop.appendChild(modal);
            document.body.appendChild(backdrop);
            this._backdrop = backdrop;
        }
    };


    /* ======================================================================
       7.bis · MODAL DE FRICCIÓN PRE-PDF (capa 6E-2)
       ======================================================================
       Diálogo de decisión que se abre al pulsar "📄 Generar PDF" cuando el
       alumno NO ha solicitado todavía el cierre técnico de Honás Darabia.

       Pedagogía:
         - No bloquea: el alumno puede seguir sin cierre.
         - Refuerza la narrativa: cierre técnico = última revisión antes
           de entregar.
         - Fricción suave, no alarmista (sin ⚠️, sin dramatismo).

       Este módulo es UN diálogo de decisión, no un panel de contenido.
       Por eso es más pequeño que ModalFeedback (480px) y no comparte
       contenido (loading, render, errores). Solo comparte el patrón
       visual del backdrop y el sistema de focus/Esc/click-backdrop.
       ====================================================================== */

    const ModalFriccionPDF = {
        _abierto: false,
        _backdrop: null,
        _onKeydown: null,

        /**
         * Abre el modal de fricción. Idempotente: si ya está abierto,
         * no hace nada (cumple el requisito de "no permitir múltiples
         * instancias").
         */
        abrir() {
            if (this._abierto) return;
            this._asegurarMontado();
            this._abierto = true;

            this._backdrop.classList.add('is-open');

            // Deshabilitar botón "📄 Generar PDF" mientras el modal esté abierto
            const btnPdf = $('#btn-pdf');
            if (btnPdf) btnPdf.disabled = true;

            // Esc cierra el modal
            this._onKeydown = (e) => {
                if (e.key === 'Escape') this.cerrar();
            };
            document.addEventListener('keydown', this._onKeydown);

            // Focus al botón primario tras el repaint
            setTimeout(() => {
                const btn = $('#frix-btn-cierre');
                if (btn) btn.focus();
            }, 30);
        },

        cerrar() {
            if (!this._abierto) return;
            this._abierto = false;
            this._backdrop.classList.remove('is-open');

            const btnPdf = $('#btn-pdf');
            if (btnPdf) btnPdf.disabled = false;

            if (this._onKeydown) {
                document.removeEventListener('keydown', this._onKeydown);
                this._onKeydown = null;
            }
        },

        /**
         * Construye el DOM del modal una sola vez. En llamadas posteriores,
         * reutiliza el nodo (igual patrón que ModalFeedback).
         */
        _asegurarMontado() {
            if (this._backdrop) return;

            const backdrop = el('div', {
                class: 'frix-backdrop',
                id: 'frix-backdrop',
                onclick: (e) => {
                    // Click fuera del modal → cerrar (no si el click es
                    // sobre el contenido del modal en sí)
                    if (e.target === backdrop) this.cerrar();
                }
            });

            const modal = el('div', {
                class: 'frix-modal',
                role: 'dialog',
                'aria-modal': 'true',
                'aria-labelledby': 'frix-titulo'
            });

            // Header (título + cerrar)
            const head = el('div', { class: 'frix-head' },
                el('div', { class: 'frix-titulo', id: 'frix-titulo' },
                    '¿Generar PDF sin cierre técnico?'),
                el('button', {
                    class: 'frix-cerrar',
                    type: 'button',
                    'aria-label': 'Cerrar',
                    title: 'Cerrar (Esc)',
                    onclick: () => this.cerrar()
                }, '×')
            );

            // Body (texto explicativo)
            const body = el('div', { class: 'frix-body' },
                el('p', { class: 'frix-texto' },
                    'Vas a generar el dictamen sin la revisión final de ' +
                    'Honás Darabia. Puedes continuar igualmente o solicitar ' +
                    'el cierre técnico antes de entregar.')
            );

            // Footer con botones
            const foot = el('div', { class: 'frix-foot' },
                el('button', {
                    class: 'btn btn-ghost',
                    type: 'button',
                    onclick: () => {
                        // Capa 7: cierra fricción y genera PDF (sin anexo
                        // de cierre técnico, porque el alumno no lo solicitó).
                        this.cerrar();
                        generarPDF();
                    }
                }, 'Generar PDF directamente'),
                el('button', {
                    class: 'btn btn-primary',
                    id: 'frix-btn-cierre',
                    type: 'button',
                    onclick: () => {
                        // Capa 6E-3: cierra fricción y abre modal de cierre.
                        // ModalCierre.abrir() decide internamente si llama
                        // a la API o muestra el persistido.
                        this.cerrar();
                        ModalCierre.abrir();
                    }
                }, '🕵️ Recibir cierre técnico')
            );

            modal.appendChild(head);
            modal.appendChild(body);
            modal.appendChild(foot);
            backdrop.appendChild(modal);

            document.body.appendChild(backdrop);
            this._backdrop = backdrop;
        }
    };


    /* ======================================================================
       7.ter · MODAL DE CIERRE TÉCNICO (capa 6E-3)
       ======================================================================
       El cierre técnico es la 3ª y última intervención de Honás Darabia,
       integradora, justo antes de generar el PDF.

       Diferencias clave respecto a ModalFeedback:
         - Solo se puede generar UNA vez por dictamen.
         - No hay aviso de "obsoleto" (no se regenera).
         - No hay botón "Actualizar".
         - Subtítulo fijo: "Última revisión antes de la entrega del dictamen."
         - Si ya hay cierre persistido al abrir → render directo (sin API).

       Reutiliza estructuralmente las clases .fb-* (misma familia visual).
       Usa la clase añadida .fbc-subtitulo para el subtítulo fijo.
       ====================================================================== */

    const ModalCierre = {

        /* === Estado interno (lazy-mounted) === */
        _backdrop: null,
        _bodyNode: null,
        _footNode: null,
        _headSubtitulo: null,
        _btnCerrar: null,
        _onKeydown: null,
        _abierto: false,
        _cargando: false,
        _timersLoading: [],

        /**
         * Flag de capa 7: indica si el alumno ya ha cerrado el modal de
         * cierre al menos una vez (es decir, ya ha leído el cierre).
         * Tras esto, futuros clicks en "Generar PDF" lanzan directamente
         * la generación del PDF sin volver a abrir este modal.
         */
        _cierreYaMostrado: false,

        /**
         * Abre el modal del cierre técnico.
         *   - Si hay cierre persistido → render directo, sin llamar a la API.
         *   - Si no → dispara solicitarCierreTecnico() y renderiza la respuesta.
         */
        async abrir() {
            this._asegurarMontado();
            this._abierto = true;
            this._backdrop.classList.add('is-open');

            // Deshabilitar el botón "📄 Generar PDF" mientras el modal
            // esté abierto (mismo patrón que ModalFeedback con Pedir consejo).
            const btnPdf = $('#btn-pdf');
            if (btnPdf) btnPdf.disabled = true;

            // Esc cierra el modal SALVO durante loading
            this._onKeydown = (e) => {
                if (e.key === 'Escape' && !this._cargando) this.cerrar();
            };
            document.addEventListener('keydown', this._onKeydown);

            const E = window.Darabia?.Evaluador;
            if (!E) {
                this._renderError({
                    codigo: 'API_ERROR',
                    mensaje: 'Motor no disponible.'
                }, false);
                return;
            }

            const persistido = E.obtenerCierrePersistido();
            if (persistido) {
                // Ya hay cierre técnico → render directo, sin gastar API.
                this._renderCierre(persistido);
            } else {
                // No hay cierre todavía → solicitar.
                await this._solicitarYRenderizar();
            }
        },

        /** Cierra el modal. Bloqueado durante loading. */
        cerrar() {
            if (!this._abierto || this._cargando) return;
            this._abierto = false;
            this._backdrop.classList.remove('is-open');

            // Capa 7: marcar que el alumno ya ha visto el cierre.
            // Tras esto, onClickPDF irá directo a generar PDF.
            this._cierreYaMostrado = true;

            const btnPdf = $('#btn-pdf');
            if (btnPdf) btnPdf.disabled = false;

            if (this._onKeydown) {
                document.removeEventListener('keydown', this._onKeydown);
                this._onKeydown = null;
            }

            this._limpiarTimersLoading();
        },

        /**
         * Construye el DOM del modal una sola vez (lazy-mount).
         * Reutiliza las clases .fb-* del modal de feedback para
         * coherencia visual + clase específica .fbc-subtitulo.
         */
        _asegurarMontado() {
            if (this._backdrop) return;

            const backdrop = el('div', {
                class: 'fb-backdrop fbc-backdrop',
                id: 'fbc-backdrop',
                onclick: (e) => {
                    if (e.target === backdrop && !this._cargando) this.cerrar();
                }
            });

            const modal = el('div', {
                class: 'fb-modal',
                role: 'dialog',
                'aria-modal': 'true',
                'aria-labelledby': 'fbc-titulo'
            });

            // Cabecera
            const head = el('div', { class: 'fb-head' },
                el('div', null,
                    el('div', {
                        class: 'fb-head-titulo',
                        id: 'fbc-titulo'
                    }, '📄 Cierre técnico de Honás Darabia'),
                    el('div', {
                        class: 'fbc-subtitulo',
                        id: 'fbc-subtitulo'
                    }, 'Última revisión antes de la entrega del dictamen.')
                ),
                el('button', {
                    class: 'fb-cerrar',
                    id: 'fbc-cerrar',
                    type: 'button',
                    'aria-label': 'Cerrar',
                    title: 'Cerrar (Esc)',
                    onclick: () => this.cerrar()
                }, '×')
            );

            // Cuerpo (se rellena dinámicamente en loading/cierre/error)
            const body = el('div', { class: 'fb-body', id: 'fbc-body' });

            // Pie (se rellena dinámicamente)
            const foot = el('div', { class: 'fb-foot', id: 'fbc-foot' });

            modal.appendChild(head);
            modal.appendChild(body);
            modal.appendChild(foot);
            backdrop.appendChild(modal);
            document.body.appendChild(backdrop);

            this._backdrop = backdrop;
            this._bodyNode = body;
            this._footNode = foot;
            this._headSubtitulo = $('#fbc-subtitulo');
            this._btnCerrar = $('#fbc-cerrar');
        },

        /**
         * Llama a Evaluador.solicitarCierreTecnico(), gestiona loading
         * y errores. Mismo patrón que ModalFeedback._solicitarYRenderizar()
         * pero llamando al método de cierre y silenciando PETICION_EN_CURSO.
         */
        async _solicitarYRenderizar() {
            this._renderLoading();
            this._cargando = true;
            this._btnCerrar.disabled = true;

            try {
                const data = await window.Darabia.Evaluador.solicitarCierreTecnico();
                this._cargando = false;
                this._btnCerrar.disabled = false;
                this._limpiarTimersLoading();
                this._renderCierre(data);
            } catch (err) {
                // Silenciar PETICION_EN_CURSO (mismo patrón que ModalFeedback):
                // si pasa, hay otra solicitud activa y no debemos pisarla.
                if (err?.codigo === 'PETICION_EN_CURSO') {
                    return;
                }

                this._cargando = false;
                this._btnCerrar.disabled = false;
                this._limpiarTimersLoading();

                const reintentable = ['LIMITE_CUOTA', 'TIMEOUT_API', 'RED_ERROR', 'API_ERROR']
                    .includes(err.codigo);
                this._renderError(err, reintentable);
            }
        },

        /* ======== RENDER LOADING (con mensajes incrementales) ======== */

        _renderLoading() {
            // Vaciar pie (sin botones durante loading)
            this._footNode.innerHTML = '';

            this._bodyNode.innerHTML = '';
            const cont = el('div', { class: 'fb-loading' },
                el('div', { class: 'fb-spinner' }),
                el('div', {
                    class: 'fb-loading-msg',
                    id: 'fbc-loading-msg'
                }, 'Conectando con Honás Darabia...')
            );
            this._bodyNode.appendChild(cont);

            // Mensajes incrementales (mismo patrón que feedback,
            // segundo mensaje específico del cierre).
            const mensajes = [
                { t: 3000,  txt: 'Honás Darabia está revisando el dictamen completo...' },
                { t: 15000, txt: 'Esto está tardando un poco...' },
                { t: 25000, txt: 'Anthropic tarda más de lo habitual. Aguanta unos segundos más...' }
            ];

            this._limpiarTimersLoading();
            for (const { t, txt } of mensajes) {
                const id = setTimeout(() => {
                    const node = $('#fbc-loading-msg');
                    if (node) node.textContent = txt;
                }, t);
                this._timersLoading.push(id);
            }
        },

        _limpiarTimersLoading() {
            for (const id of this._timersLoading) clearTimeout(id);
            this._timersLoading = [];
        },

        /* ======== RENDER DEL CIERRE (4 bloques) ======== */

        _renderCierre(data) {
            this._bodyNode.innerHTML = '';

            // Bloque 1: Diagnóstico general (corazón del cierre, 1-2 párrafos)
            this._bodyNode.appendChild(this._bloqueDiagnostico(data.diagnostico_general));

            // Bloque 2: Fortalezas (puede ser [])
            if (Array.isArray(data.fortalezas) && data.fortalezas.length > 0) {
                this._bodyNode.appendChild(this._bloqueLista(
                    'Fortalezas', data.fortalezas, 'fortalezas'));
            }

            // Bloque 3: Aspectos a mejorar
            if (Array.isArray(data.aspectos_a_mejorar) && data.aspectos_a_mejorar.length > 0) {
                this._bodyNode.appendChild(this._bloqueLista(
                    'Aspectos a mejorar', data.aspectos_a_mejorar, 'mejora'));
            }

            // Bloque 4: Recomendaciones
            if (Array.isArray(data.recomendaciones) && data.recomendaciones.length > 0) {
                this._bodyNode.appendChild(this._bloqueLista(
                    'Recomendaciones', data.recomendaciones, 'recomendacion'));
            }

            // Disclaimer
            this._bodyNode.appendChild(el('div', { class: 'fb-disclaimer' },
                'Este cierre técnico es orientativo. La evaluación oficial corresponde al profesorado.'
            ));

            // Pie con SOLO botón "Cerrar" (cierre no se regenera)
            this._footNode.innerHTML = '';
            this._footNode.appendChild(el('div', { class: 'fb-foot-actions' },
                el('button', {
                    class: 'btn btn-primary',
                    type: 'button',
                    onclick: () => this.cerrar()
                }, 'Cerrar')
            ));
        },

        _bloqueDiagnostico(texto) {
            return el('div', { class: 'fb-bloque' },
                el('div', { class: 'fb-bloque-titulo' }, 'Diagnóstico general'),
                el('div', { class: 'fb-bloque-diagnostico' },
                    String(texto || '').trim() || '(sin diagnóstico)')
            );
        },

        _bloqueLista(titulo, items, tipo) {
            const ul = el('ul', { class: `fb-lista fb-lista-${tipo}` });
            for (const item of items) {
                ul.appendChild(el('li', { class: 'fb-lista-item' },
                    String(item || '').trim()));
            }
            return el('div', { class: 'fb-bloque' },
                el('div', { class: 'fb-bloque-titulo' }, titulo),
                ul
            );
        },

        /* ======== RENDER DE ERROR ======== */

        _renderError(err, reintentable) {
            this._bodyNode.innerHTML = '';
            this._footNode.innerHTML = '';

            const codigo = err.codigo || 'ERROR';
            const mensaje = err.mensaje || err.message || 'Error desconocido.';

            // Mensajes humanizados (cierre técnico — sin SIN_CONSULTAS_DISPONIBLES
            // porque el cierre NO usa el contador de consultas iterativas).
            const mensajesHumanos = {
                NADA_QUE_EVALUAR:         'Escribe al menos un párrafo antes de solicitar el cierre técnico.',
                LIMITE_CUOTA:             'El servicio está saturado. Espera 1-2 minutos y reintenta.',
                SIN_SALDO:                'La cuenta de la API está sin saldo. Avisa a tu profesor.',
                TIMEOUT_API:              'Honás Darabia tarda demasiado en responder. Reintenta en unos segundos.',
                RESPUESTA_INVALIDA:       'Honás Darabia ha devuelto una respuesta mal formada. Reintenta.',
                RED_ERROR:                'Error de red. Comprueba tu conexión y reintenta.',
                DICTAMEN_DEMASIADO_LARGO: 'Tu dictamen es demasiado extenso. Reduce su longitud antes de pedir el cierre técnico.',
                API_ERROR:                'Ha ocurrido un error inesperado al contactar con Honás Darabia.'
            };
            const textoFinal = mensajesHumanos[codigo] || mensaje;

            this._bodyNode.appendChild(
                el('div', { class: 'fb-error' },
                    el('div', { class: 'fb-error-icon' }, '✕'),
                    el('div', { class: 'fb-error-codigo' }, codigo),
                    el('div', { class: 'fb-error-mensaje' }, textoFinal)
                )
            );

            const acciones = el('div', { class: 'fb-foot-actions' });
            acciones.appendChild(el('button', {
                class: 'btn btn-ghost',
                type: 'button',
                onclick: () => this.cerrar()
            }, 'Cerrar'));

            if (reintentable) {
                acciones.appendChild(el('button', {
                    class: 'btn btn-primary',
                    type: 'button',
                    onclick: () => this._solicitarYRenderizar()
                }, 'Reintentar'));
            }

            this._footNode.appendChild(acciones);
        }
    };


    /* ======================================================================
       7.bis · MODAL DE FEEDBACK MENTOR (capa 6C)
       ======================================================================
       Estados del modal:
         "loading"    → spinner + mensajes incrementales
         "feedback"   → 4 bloques renderizados
         "error"      → icono + mensaje + botón reintentar (si procede)

       Comportamiento:
         - Al abrir: si hay feedback persistido → mostrar (con aviso obsoleto
           si feedbackEstaObsoleto). Si no → solicitar nuevo.
         - Botón "Actualizar feedback": fuerza nueva solicitud.
         - Cierre: backdrop, Esc o ✕. Bloqueado durante loading.
       ====================================================================== */

    const ModalFeedback = {

        /** Referencias al DOM del modal (lazy-mounted). */
        _backdrop: null,
        _bodyNode: null,
        _footNode: null,
        _headMeta: null,
        _btnCerrar: null,

        /** Estado interno */
        _abierto: false,
        _cargando: false,
        _timersLoading: [],   // timers de los mensajes incrementales
        _onKeydown: null,     // listener Esc

        /**
         * Asegura que el modal esté montado en el DOM. Idempotente.
         */
        _asegurarMontado() {
            if (this._backdrop) return;

            const backdrop = el('div', { class: 'fb-backdrop', id: 'fb-backdrop',
                onclick: (e) => {
                    // Solo cerrar si se hace click directamente en el backdrop,
                    // no en el modal interior.
                    if (e.target === backdrop) this.cerrar();
                }
            });

            const head = el('div', { class: 'fb-head' },
                el('div', null,
                    el('div', { class: 'fb-head-titulo' }, '🕵️ Consejo de Honás Darabia'),
                    el('div', { class: 'fb-head-meta', id: 'fb-head-meta' }, '')
                ),
                el('button', {
                    class: 'fb-cerrar',
                    id: 'fb-cerrar',
                    type: 'button',
                    'aria-label': 'Cerrar',
                    title: 'Cerrar (Esc)',
                    onclick: () => this.cerrar()
                }, '✕')
            );

            const body = el('div', { class: 'fb-body', id: 'fb-body' });
            const foot = el('div', { class: 'fb-foot', id: 'fb-foot' });

            const modal = el('div', {
                class: 'fb-modal',
                role: 'dialog',
                'aria-modal': 'true',
                'aria-labelledby': 'fb-head-titulo'
            }, head, body, foot);

            backdrop.appendChild(modal);
            document.body.appendChild(backdrop);

            this._backdrop = backdrop;
            this._bodyNode = body;
            this._footNode = foot;
            this._headMeta = $('#fb-head-meta');
            this._btnCerrar = $('#fb-cerrar');
        },

        /**
         * Abre el modal. Si hay feedback previo, lo muestra. Si no, solicita.
         */
        async abrir() {
            this._asegurarMontado();
            this._abierto = true;
            this._backdrop.classList.add('is-open');

            // Deshabilitar el botón Feedback del footer mientras el modal
            // esté abierto, para evitar dobles llamadas y estados raros.
            const btnFooter = $('#btn-feedback');
            if (btnFooter) btnFooter.disabled = true;

            // Listener Esc (registrar una vez por apertura)
            this._onKeydown = (e) => {
                if (e.key === 'Escape' && !this._cargando) this.cerrar();
            };
            document.addEventListener('keydown', this._onKeydown);

            const E = window.Darabia?.Evaluador;
            if (!E) {
                this._renderError({
                    codigo: 'API_ERROR',
                    mensaje: 'Motor no disponible.'
                }, false);
                return;
            }

            const persistido = E.obtenerFeedbackPersistido();

            if (persistido) {
                // Mostrar feedback existente (con aviso obsoleto si aplica)
                this._renderFeedback(persistido, E.feedbackEstaObsoleto());
            } else {
                // Solicitar nuevo feedback
                await this._solicitarYRenderizar();
            }
        },

        /**
         * Cierra el modal. Bloqueado durante loading.
         */
        cerrar() {
            if (this._cargando) return;
            this._abierto = false;
            this._backdrop?.classList.remove('is-open');
            this._limpiarTimersLoading();
            if (this._onKeydown) {
                document.removeEventListener('keydown', this._onKeydown);
                this._onKeydown = null;
            }
            // Recalcular estado del botón Feedback según gatekeeper
            // (NO simplemente disabled=false: si el dictamen está vacío,
            // el botón debe seguir disabled por la regla normal).
            actualizarBotonFeedback();
        },

        /**
         * Solicita feedback y renderiza el resultado (o error).
         * Maneja todo el ciclo de loading + retorno + render.
         */
        async _solicitarYRenderizar() {
            this._renderLoading();
            this._cargando = true;
            this._btnCerrar.disabled = true;

            try {
                const data = await window.Darabia.Evaluador.solicitarFeedback();
                this._cargando = false;
                this._btnCerrar.disabled = false;
                this._limpiarTimersLoading();
                // Tras una solicitud nueva, el feedback NO está obsoleto
                this._renderFeedback(data, false);
            } catch (err) {
                // Caso especial · capa 6D-2: silenciar PETICION_EN_CURSO.
                // Esto pasa cuando el alumno hace doble click rapidísimo: la
                // 1ª llamada está en curso y la 2ª llega aquí. El loading
                // que estamos viendo es el de la 1ª llamada (que sigue su
                // curso). No tiene sentido mostrar pantalla de error sobre
                // un loading legítimo. Salimos sin tocar nada.
                if (err?.codigo === 'PETICION_EN_CURSO') {
                    return;
                }

                this._cargando = false;
                this._btnCerrar.disabled = false;
                this._limpiarTimersLoading();
                const reintentable = ['LIMITE_CUOTA', 'TIMEOUT_API', 'RED_ERROR', 'API_ERROR']
                    .includes(err.codigo);
                this._renderError(err, reintentable);
            }
        },


        /* ======== RENDER LOADING (con mensajes incrementales) ======== */

        _renderLoading() {
            this._headMeta.textContent = '';
            this._footNode.innerHTML = '';

            // Cuerpo con spinner + mensaje + tiempo
            this._bodyNode.innerHTML = '';
            const spinner = el('div', { class: 'fb-loading-spinner' });
            const msg = el('div', { class: 'fb-loading-msg', id: 'fb-loading-msg' },
                'Conectando con Honás Darabia...');
            const tiempo = el('div', { class: 'fb-loading-tiempo', id: 'fb-loading-tiempo' },
                '0s');
            const wrap = el('div', { class: 'fb-loading' }, spinner, msg, tiempo);
            this._bodyNode.appendChild(wrap);

            // Mensajes incrementales según el plan que validaste
            this._limpiarTimersLoading();
            const mensajes = [
                { t: 3000,  txt: 'Honás Darabia está analizando tu dictamen...' },
                { t: 15000, txt: 'Esto está tardando un poco. Sigue ahí, no se ha colgado.' },
                { t: 25000, txt: 'Anthropic tarda más de lo habitual. Si tarda mucho más, podrás reintentar.' }
            ];
            for (const m of mensajes) {
                const id = setTimeout(() => {
                    const node = $('#fb-loading-msg');
                    if (node) {
                        node.style.opacity = 0;
                        setTimeout(() => {
                            if (node) {
                                node.textContent = m.txt;
                                node.style.opacity = 1;
                            }
                        }, 180);
                    }
                }, m.t);
                this._timersLoading.push(id);
            }

            // Contador de tiempo (cada segundo)
            const t0 = Date.now();
            const intervalId = setInterval(() => {
                const node = $('#fb-loading-tiempo');
                if (!node) return clearInterval(intervalId);
                const segs = Math.floor((Date.now() - t0) / 1000);
                node.textContent = `${segs}s`;
            }, 1000);
            // Guardamos el id del interval junto a los timers para limpieza
            this._timersLoading.push(intervalId);
        },

        _limpiarTimersLoading() {
            for (const id of this._timersLoading) {
                clearTimeout(id);
                clearInterval(id);
            }
            this._timersLoading = [];
        },


        /* ======== RENDER FEEDBACK ======== */

        _renderFeedback(data, obsoleto) {
            // Cabecera meta
            const ts = data.generado_at ? this._formatearFecha(data.generado_at) : '';
            const versionPrompt = data.version_prompt || '';
            this._headMeta.textContent = [ts && `Generado: ${ts}`, versionPrompt && `· ${versionPrompt}`]
                .filter(Boolean).join(' ');

            // Cuerpo
            this._bodyNode.innerHTML = '';

            // Aviso de obsoleto si aplica
            if (obsoleto) {
                this._bodyNode.appendChild(el('div', { class: 'fb-aviso-obsoleto' },
                    el('span', { class: 'fb-aviso-obsoleto-icon' }, '⚠'),
                    el('span', null,
                        'Tu dictamen ha cambiado desde este consejo. Considera actualizarlo para reflejar el contenido actual.'
                    )
                ));
            }

            // Bloque 1 · Diagnóstico general
            this._bodyNode.appendChild(this._bloqueDiagnostico(data.diagnostico_general));

            // Bloque 2 · Fortalezas (oculto si vacío)
            if (Array.isArray(data.fortalezas) && data.fortalezas.length > 0) {
                this._bodyNode.appendChild(this._bloqueLista(
                    'Fortalezas detectadas', 'color-fortalezas', data.fortalezas));
            }

            // Bloque 3 · Aspectos a mejorar (oculto si vacío)
            if (Array.isArray(data.aspectos_a_mejorar) && data.aspectos_a_mejorar.length > 0) {
                this._bodyNode.appendChild(this._bloqueLista(
                    'Aspectos a mejorar', 'color-mejorar', data.aspectos_a_mejorar));
            }

            // Bloque 4 · Recomendaciones (oculto si vacío)
            if (Array.isArray(data.recomendaciones) && data.recomendaciones.length > 0) {
                this._bodyNode.appendChild(this._bloqueLista(
                    'Recomendaciones', 'color-recomendar', data.recomendaciones));
            }

            // Disclaimer
            this._bodyNode.appendChild(el('div', { class: 'fb-disclaimer' },
                'Este consejo es orientativo. La evaluación oficial corresponde al profesorado.'
            ));

            // Pie con botones
            this._footNode.innerHTML = '';
            this._footNode.appendChild(el('div', { class: 'fb-foot-meta' },
                obsoleto ? 'Consejo desactualizado' : 'Consejo actualizado'
            ));
            this._footNode.appendChild(el('div', { class: 'fb-foot-actions' },
                el('button', {
                    class: 'btn btn-ghost',
                    type: 'button',
                    onclick: () => this.cerrar()
                }, 'Cerrar'),
                el('button', {
                    class: 'btn btn-primary',
                    type: 'button',
                    onclick: () => this._solicitarYRenderizar()
                }, 'Actualizar consejo')
            ));
        },

        _bloqueDiagnostico(texto) {
            return el('div', { class: 'fb-bloque' },
                el('div', { class: 'fb-bloque-titulo' }, 'Diagnóstico general'),
                el('div', { class: 'fb-diagnostico' }, texto || '(sin diagnóstico)')
            );
        },

        _bloqueLista(titulo, colorClass, items) {
            const ul = el('ul', { class: 'fb-lista' });
            for (const item of items) {
                ul.appendChild(el('li', null, item));
            }
            return el('div', { class: 'fb-bloque' },
                el('div', { class: 'fb-bloque-titulo ' + colorClass }, titulo),
                ul
            );
        },


        /* ======== RENDER ERROR ======== */

        _renderError(err, reintentable) {
            this._headMeta.textContent = '';
            this._bodyNode.innerHTML = '';
            this._footNode.innerHTML = '';

            const codigo = err.codigo || 'ERROR';
            const mensaje = err.mensaje || err.message || 'Error desconocido.';

            // Mensaje humanizado por código (sobreescribe el mensaje crudo del backend)
            const mensajesHumanos = {
                NADA_QUE_EVALUAR:         'Escribe al menos un párrafo antes de consultar a Honás Darabia.',
                SIN_CONSULTAS_DISPONIBLES:'Has consumido las 2 consultas con Honás Darabia. El cierre técnico se generará al pedir el PDF.',
                LIMITE_CUOTA:             'El servicio está saturado. Espera 1-2 minutos y reintenta.',
                SIN_SALDO:                'La cuenta de la API está sin saldo. Avisa a tu profesor.',
                TIMEOUT_API:              'Honás Darabia tarda demasiado en responder. Reintenta en unos segundos.',
                RESPUESTA_INVALIDA:       'Honás Darabia ha devuelto una respuesta mal formada. Reintenta.',
                RED_ERROR:                'Error de red. Comprueba tu conexión y reintenta.',
                DICTAMEN_DEMASIADO_LARGO: 'Tu dictamen es demasiado extenso. Reduce su longitud antes de pedir consejo.',
                API_ERROR:                'Ha ocurrido un error inesperado al contactar con Honás Darabia.'
            };
            const textoFinal = mensajesHumanos[codigo] || mensaje;

            this._bodyNode.appendChild(
                el('div', { class: 'fb-error' },
                    el('div', { class: 'fb-error-icon' }, '✕'),
                    el('div', { class: 'fb-error-codigo' }, codigo),
                    el('div', { class: 'fb-error-mensaje' }, textoFinal)
                )
            );

            // Pie con botones según si es reintentable
            this._footNode.appendChild(el('div', { class: 'fb-foot-meta' }));
            const acciones = el('div', { class: 'fb-foot-actions' });
            acciones.appendChild(el('button', {
                class: 'btn btn-ghost',
                type: 'button',
                onclick: () => this.cerrar()
            }, 'Cerrar'));

            if (reintentable) {
                acciones.appendChild(el('button', {
                    class: 'btn btn-primary',
                    type: 'button',
                    onclick: () => this._solicitarYRenderizar()
                }, 'Reintentar'));
            }
            this._footNode.appendChild(acciones);
        },


        /* ======== UTILIDADES ======== */

        _formatearFecha(iso) {
            try {
                const d = new Date(iso);
                const pad = n => n.toString().padStart(2, '0');
                return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
            } catch {
                return iso;
            }
        }
    };



    /* ======================================================================
       8 · INDICADOR DE GUARDADO (la 3C lo refrescará al editar)
       ====================================================================== */

    /**
     * Pone la barra de estado en modo "Guardando..." o "Guardado · HH:MM:SS".
     * Pública vía window.DarabiaUI.marcarGuardado(estado).
     */
    function marcarGuardado(estado) {
        const dot = $('#save-dot');
        const txt = $('#save-text');
        if (!dot || !txt) return;

        dot.classList.remove('is-saving', 'is-error');
        if (estado === 'saving') {
            dot.classList.add('is-saving');
            txt.textContent = 'Guardando...';
        } else if (estado === 'error') {
            dot.classList.add('is-error');
            txt.textContent = 'Error al guardar';
        } else {
            const t = new Date();
            const pad = n => n.toString().padStart(2, '0');
            txt.textContent = `Guardado · ${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`;
        }
    }


    /* ======================================================================
       9 · BOOT
       ====================================================================== */

    function boot() {
        // Verificación mínima: el motor debe estar listo.
        if (!window.Darabia?.caso) {
            console.error('[UI v6] Darabia.caso no está disponible. ¿Se llamó a Darabia.iniciar() primero?');
            return;
        }

        montarShell();
        renderPanelIzquierdo();
        renderEditor();
        marcarGuardado('idle');

        console.log('[UI v6 · capa 3C] Shell + expediente + editor montados.');
    }


    /* ======================================================================
       10 · API PÚBLICA (window.DarabiaUI)
       ====================================================================== */

    window.__darabiaUIBoot = boot;

    window.DarabiaUI = {
        /** Re-renderiza el panel izquierdo (útil tras cambios externos). */
        rerenderExpediente: renderPanelIzquierdo,
        /** Re-renderiza el editor del dictamen completo. */
        rerenderEditor: renderEditor,
        /** Marca estado de guardado en el footer. */
        marcarGuardado,
        /** Stub legacy: el motor v6 no debería invocar esto. */
        render() {
            console.warn('[UI v6] DarabiaUI.render llamado — el motor v6 no debería invocar esto.');
        }
    };

})();
