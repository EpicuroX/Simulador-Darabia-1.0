/* ============================================================================
 * pdf_generator.js · Capa 7 · Generación del PDF del dictamen
 * ============================================================================
 *
 * Genera un PDF profesional siguiendo la estructura del DOCX de plantilla:
 *   - Cabecera profesional con expediente
 *   - Aviso técnico breve
 *   - Dictamen (secciones 1 a 6)
 *   - Firma del técnico
 *   - ANEXO Cierre técnico (solo si existe en gameState)
 *   - Footer estático profesional
 *
 * Dependencia: html2pdf.js (cargada vía CDN en index.html).
 * Estado: window.html2pdf disponible globalmente.
 *
 * Punto de entrada: window.Darabia.PDFGenerator.generar()
 * ============================================================================ */

(function() {
    'use strict';

    const EXPEDIENTE = 'VA-2026-PSI-047';
    const CENTRO     = 'IES Virgen del Pilar';
    const CURSO      = '2025-2026';
    const TEC_NUMERO = '0847';
    const TEC_NOMBRE = 'Honás Darabia';

    /** Limpia emojis del texto del alumno (no se renderizan bien en PDF). */
    function _limpiarEmojis(texto) {
        if (!texto) return '';
        return String(texto)
            .replace(/[\u{1F600}-\u{1F64F}]/gu, '')
            .replace(/[\u{1F300}-\u{1F5FF}]/gu, '')
            .replace(/[\u{1F680}-\u{1F6FF}]/gu, '')
            .replace(/[\u{1F700}-\u{1F77F}]/gu, '')
            .replace(/[\u{1F780}-\u{1F7FF}]/gu, '')
            .replace(/[\u{1F800}-\u{1F8FF}]/gu, '')
            .replace(/[\u{1F900}-\u{1F9FF}]/gu, '')
            .replace(/[\u{1FA00}-\u{1FA6F}]/gu, '')
            .replace(/[\u{1FA70}-\u{1FAFF}]/gu, '')
            .replace(/[\u{2600}-\u{26FF}]/gu, '')
            .replace(/[\u{2700}-\u{27BF}]/gu, '');
    }

    /** Escapa HTML para seguridad y consistencia visual. */
    function _esc(texto) {
        const limpio = _limpiarEmojis(texto);
        return String(limpio || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /** Convierte texto plano con saltos de línea a HTML con <br>. */
    function _textoMultilinea(texto) {
        if (!texto || !texto.trim()) {
            return '<p class="pdf-vacia">[Sección no redactada]</p>';
        }
        return _esc(texto)
            .split(/\n\n+/)
            .map(p => '<p>' + p.replace(/\n/g, '<br>') + '</p>')
            .join('');
    }

    /** Formato de fecha legible: "27 de abril de 2026". */
    function _formatearFecha(d = new Date()) {
        const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
                       'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
        return `${d.getDate()} de ${meses[d.getMonth()]} de ${d.getFullYear()}`;
    }

    /** Devuelve "Apellido_Nombre" sin caracteres problemáticos. */
    function _slugNombre(nombre) {
        if (!nombre) return 'Alumno';
        return String(nombre)
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/\s+/g, '_')
            .replace(/[^a-zA-Z0-9_]/g, '');
    }

    /** ====================================================================
     *  CONSTRUCCIÓN DE BLOQUES HTML
     *  ==================================================================== */

    function _construirCabecera(alumno) {
        const fecha = _formatearFecha();
        return `
        <header class="pdf-cabecera">
            <table class="pdf-cabecera-tabla">
                <tr>
                    <td class="pdf-cab-label">EXPEDIENTE</td>
                    <td class="pdf-cab-valor">${EXPEDIENTE}</td>
                </tr>
                <tr>
                    <td class="pdf-cab-label">EMPRESA EVALUADA</td>
                    <td class="pdf-cab-valor">Gestoría Moreno &amp; Asociados S.L.</td>
                </tr>
                <tr>
                    <td class="pdf-cab-label">FECHA DEL DICTAMEN</td>
                    <td class="pdf-cab-valor">${fecha}</td>
                </tr>
                <tr>
                    <td class="pdf-cab-label">TÉCNICO REDACTOR</td>
                    <td class="pdf-cab-valor">${_esc(alumno?.nombre || '—')}</td>
                </tr>
                <tr>
                    <td class="pdf-cab-label">GRUPO</td>
                    <td class="pdf-cab-valor">${_esc(alumno?.grupo || '—')}</td>
                </tr>
                <tr>
                    <td class="pdf-cab-label">CENTRO</td>
                    <td class="pdf-cab-valor">${CENTRO}</td>
                </tr>
            </table>
        </header>`;
    }

    function _construirAviso() {
        return `
        <div class="pdf-aviso">
            Documento elaborado a partir del expediente ${EXPEDIENTE} remitido
            por la Mutua Prevalia. El presente dictamen sirve como base técnica
            para la actualización de la evaluación psicosocial requerida por el
            Art. 16 LPRL.
        </div>`;
    }

    function _construirSeccionTexto(numero, titulo, contenido) {
        return `
        <section class="pdf-seccion">
            <h3>${numero}. ${_esc(titulo)}</h3>
            ${_textoMultilinea(contenido)}
        </section>`;
    }

    function _construirTablaPlan(seccion) {
        const filas = (seccion?.filas || []).filter(f => {
            // Filtrar filas completamente vacías
            const valores = Object.entries(f).filter(([k]) => k !== 'id');
            return valores.some(([_, v]) => String(v || '').trim().length > 0);
        });

        let tablaHTML = `
        <section class="pdf-seccion pdf-seccion-plan">
            <h3>5. Plan de acción preventivo</h3>`;

        if (filas.length === 0) {
            tablaHTML += '<p class="pdf-vacia">[Sección no redactada]</p>';
        } else {
            tablaHTML += `
            <table class="pdf-tabla-plan">
                <thead>
                    <tr>
                        <th class="col-num">Nº</th>
                        <th>Factor de riesgo</th>
                        <th>Nivel prev.</th>
                        <th>Indicador / KPI</th>
                        <th>Plazo</th>
                        <th>Responsable</th>
                    </tr>
                </thead>
                <tbody>`;
            filas.forEach((f, i) => {
                tablaHTML += `
                    <tr>
                        <td class="col-num">${i + 1}</td>
                        <td>${_esc(f.factor || '')}</td>
                        <td>${_esc(f.nivel || '')}</td>
                        <td>${_esc(f.indicador || '')}</td>
                        <td>${_esc(f.plazo || '')}</td>
                        <td>${_esc(f.responsable || '')}</td>
                    </tr>`;
            });
            tablaHTML += `
                </tbody>
            </table>`;
        }

        tablaHTML += '</section>';
        return tablaHTML;
    }

    function _construirSeccionArgumentacion(contenidoLegal, contenidoEconomico) {
        // Si la sección 06 está unificada en un solo texto, intentamos
        // partir por el patrón típico "6.1" / "6.2" / "Económica". Si no,
        // se imprime como texto único y bajo "6.1".
        return `
        <section class="pdf-seccion">
            <h3>6. Argumentación ante la dirección</h3>
            <h4>6.1 Argumentación legal</h4>
            ${_textoMultilinea(contenidoLegal)}
            <h4>6.2 Argumentación económica</h4>
            ${_textoMultilinea(contenidoEconomico)}
        </section>`;
    }

    function _construirFirma(alumno) {
        const fecha = _formatearFecha();
        return `
        <div class="pdf-firma">
            <div class="pdf-firma-titulo">FIRMA DEL TÉCNICO REDACTOR</div>
            <div class="pdf-firma-linea">Nombre y apellidos: ${_esc(alumno?.nombre || '')}</div>
            <div class="pdf-firma-linea">Grupo: ${_esc(alumno?.grupo || '')}</div>
            <div class="pdf-firma-linea">Fecha: ${fecha}</div>
            <div class="pdf-firma-linea pdf-firma-firma">Firma:</div>
        </div>`;
    }

    function _bloqueListaAnexo(titulo, items) {
        if (!Array.isArray(items) || items.length === 0) return '';
        const li = items.map(it => `<li>${_esc(it)}</li>`).join('');
        return `
            <div class="pdf-anexo-bloque">
                <h4>${_esc(titulo)}</h4>
                <ul>${li}</ul>
            </div>`;
    }

    function _construirAnexoCierre(cierre) {
        if (!cierre) return '';

        return `
        <div class="html2pdf__page-break"></div>
        <section class="pdf-anexo">
            <h2>ANEXO · Cierre técnico</h2>
            <p class="pdf-anexo-meta">
                Revisión técnica realizada en el simulador Darabia con fines
                formativos. Carácter orientativo.
            </p>

            <div class="pdf-anexo-bloque">
                <h4>Diagnóstico general</h4>
                <p>${_esc(cierre.diagnostico_general || '')}</p>
            </div>

            ${_bloqueListaAnexo('Fortalezas', cierre.fortalezas)}
            ${_bloqueListaAnexo('Aspectos a mejorar', cierre.aspectos_a_mejorar)}
            ${_bloqueListaAnexo('Recomendaciones', cierre.recomendaciones)}
        </section>`;
    }

    function _construirFooter() {
        return `
        <footer class="pdf-footer">
            ${TEC_NOMBRE} · Téc. PRL nº ${TEC_NUMERO} ·
            ${CENTRO} · ${CURSO}
        </footer>`;
    }

    /** ====================================================================
     *  CSS DEL PDF (inline para que html2pdf lo capture sin dudas)
     *  ==================================================================== */

    function _construirEstilosInline() {
        return `
        <style>
            * { box-sizing: border-box; }

            .pdf-document {
                font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;
                font-size: 11pt;
                line-height: 1.5;
                color: #1a1a1a;
                background: #ffffff;
                padding: 28mm 22mm 22mm 22mm;
                width: 210mm;
            }

            /* Cabecera */
            .pdf-cabecera-tabla {
                width: 100%;
                border-collapse: collapse;
                margin-bottom: 18px;
                border: 1px solid #d0d0d0;
            }
            .pdf-cabecera-tabla td {
                padding: 6px 10px;
                border: 1px solid #d0d0d0;
                vertical-align: middle;
            }
            .pdf-cab-label {
                width: 38%;
                background: #f5f5f7;
                font-weight: 600;
                font-size: 9.5pt;
                letter-spacing: 0.02em;
                color: #444;
            }
            .pdf-cab-valor { font-size: 10.5pt; }

            /* Aviso técnico */
            .pdf-aviso {
                font-style: italic;
                color: #555;
                font-size: 10pt;
                line-height: 1.5;
                padding: 10px 14px;
                border-left: 3px solid #cccccc;
                background: #fafafa;
                margin-bottom: 28px;
            }

            /* Cuerpo del dictamen */
            .pdf-cuerpo h1 {
                font-size: 18pt;
                font-weight: 700;
                margin: 0 0 4px 0;
                letter-spacing: -0.01em;
            }
            .pdf-empresa {
                font-size: 13pt;
                font-weight: 500;
                color: #555;
                margin: 0 0 24px 0;
            }
            .pdf-seccion { margin-bottom: 22px; page-break-inside: auto; }
            .pdf-seccion h3 {
                font-size: 12.5pt;
                font-weight: 700;
                margin: 0 0 8px 0;
                padding-bottom: 4px;
                border-bottom: 1px solid #e0e0e0;
            }
            .pdf-seccion h4 {
                font-size: 11pt;
                font-weight: 600;
                margin: 14px 0 6px 0;
                color: #333;
            }
            .pdf-seccion p { margin: 0 0 8px 0; }

            /* Sección vacía */
            .pdf-vacia {
                color: #aaaaaa;
                font-style: italic;
                font-size: 10pt;
            }

            /* Tabla del plan */
            .pdf-tabla-plan {
                width: 100%;
                border-collapse: collapse;
                font-size: 9.5pt;
                margin: 6px 0 12px 0;
            }
            .pdf-tabla-plan th {
                background: #f0f0f2;
                color: #333;
                text-align: left;
                font-weight: 600;
                padding: 6px 8px;
                border: 1px solid #c8c8c8;
            }
            .pdf-tabla-plan td {
                padding: 6px 8px;
                border: 1px solid #d8d8d8;
                vertical-align: top;
                word-break: break-word;
            }
            .pdf-tabla-plan tr { page-break-inside: avoid; }
            .pdf-tabla-plan .col-num {
                width: 28px;
                text-align: center;
                color: #666;
            }

            /* Firma */
            .pdf-firma {
                margin-top: 32px;
                padding-top: 14px;
                border-top: 1px solid #d0d0d0;
            }
            .pdf-firma-titulo {
                font-size: 10pt;
                font-weight: 700;
                letter-spacing: 0.04em;
                margin-bottom: 10px;
                color: #444;
            }
            .pdf-firma-linea {
                font-size: 10.5pt;
                margin-bottom: 6px;
            }
            .pdf-firma-firma { margin-top: 22px; }

            /* Anexo Cierre técnico */
            .pdf-anexo {
                margin-top: 8px;
                padding: 22px 24px;
                background: #f7f7f9;
                border-left: 4px solid #888;
                border-radius: 2px;
            }
            .pdf-anexo h2 {
                font-size: 14pt;
                font-weight: 700;
                margin: 0 0 4px 0;
                color: #222;
            }
            .pdf-anexo-meta {
                font-style: italic;
                color: #666;
                font-size: 9.5pt;
                margin: 0 0 18px 0;
            }
            .pdf-anexo-bloque {
                margin-bottom: 14px;
                page-break-inside: avoid;
            }
            .pdf-anexo-bloque h4 {
                font-size: 11pt;
                font-weight: 600;
                margin: 0 0 6px 0;
                color: #333;
            }
            .pdf-anexo-bloque p { margin: 0; font-size: 10.5pt; }
            .pdf-anexo-bloque ul {
                margin: 0;
                padding-left: 20px;
            }
            .pdf-anexo-bloque li {
                margin-bottom: 4px;
                font-size: 10.5pt;
                line-height: 1.45;
            }

            /* Footer */
            .pdf-footer {
                margin-top: 28px;
                padding-top: 10px;
                border-top: 1px solid #e0e0e0;
                font-size: 9pt;
                color: #777;
                text-align: center;
                letter-spacing: 0.02em;
            }
        </style>`;
    }

    /** ====================================================================
     *  ENSAMBLAJE COMPLETO + GENERACIÓN
     *  ==================================================================== */

    /**
     * Localiza el contenido de una sección por id en gameState.dictamen.secciones.
     * Las secciones se almacenan como objeto indexado por id.
     */
    function _seccion(estado, id) {
        return estado?.dictamen?.secciones?.[id] || null;
    }

    function _textoSeccion(estado, id) {
        const s = _seccion(estado, id);
        return s?.contenido || '';
    }

    /**
     * La sección 06 (argumentación) se almacena como un solo bloque de texto
     * libre. Para presentarla con subsecciones 6.1 y 6.2 en el PDF, intentamos
     * partir por marcadores típicos. Si no encontramos partición, todo va a 6.1.
     */
    function _partirArgumentacion(texto) {
        if (!texto || !texto.trim()) return { legal: '', economico: '' };

        // Patrones típicos del alumno
        const patrones = [
            /\n\s*6\.2[^\n]*\n/i,
            /\n\s*Econ[oó]mic[ao][^\n]*\n/i,
            /\n\s*Argumentaci[oó]n\s+econ[oó]mic[ao][^\n]*\n/i
        ];

        for (const re of patrones) {
            const m = texto.match(re);
            if (m && m.index > 0) {
                const idx = m.index;
                const finMarcador = idx + m[0].length;
                return {
                    legal: texto.slice(0, idx).trim(),
                    economico: texto.slice(finMarcador).trim()
                };
            }
        }
        return { legal: texto.trim(), economico: '' };
    }

    function _construirHTML(estado) {
        const alumno = estado?.alumno || {};
        const cierre = estado?.dictamen?.cierre_tecnico || null;

        const arg = _partirArgumentacion(_textoSeccion(estado, '06_argumentacion'));

        return `
        ${_construirEstilosInline()}
        <div class="pdf-document">
            ${_construirCabecera(alumno)}
            ${_construirAviso()}

            <main class="pdf-cuerpo">
                <h1>DICTAMEN TÉCNICO PSICOSOCIAL</h1>
                <h2 class="pdf-empresa">Gestoría Moreno &amp; Asociados S.L.</h2>

                ${_construirSeccionTexto(1, 'Unidades de análisis',
                    _textoSeccion(estado, '01_unidades_analisis'))}

                ${_construirSeccionTexto(2, 'Triangulación de evidencias',
                    _textoSeccion(estado, '02_triangulacion'))}

                ${_construirSeccionTexto(3, 'Aplicación de modelos teóricos',
                    _textoSeccion(estado, '03_modelos_teoricos'))}

                ${_construirSeccionTexto(4, 'Hipótesis diagnóstica',
                    _textoSeccion(estado, '04_hipotesis'))}

                ${_construirTablaPlan(_seccion(estado, '05_plan_accion'))}

                ${_construirSeccionArgumentacion(arg.legal, arg.economico)}

                ${_construirFirma(alumno)}
            </main>

            ${_construirAnexoCierre(cierre)}

            ${_construirFooter()}
        </div>`;
    }

    /** ====================================================================
     *  PUNTO DE ENTRADA · GENERAR PDF
     *  ==================================================================== */

    /**
     * Genera el PDF del dictamen y lanza la descarga en el navegador.
     * Marca timestamp en gameState.dictamen.pdf_generado_at tras éxito.
     *
     * @returns {Promise<void>}
     * @throws si html2pdf no está cargado o si la generación falla.
     */
    async function generar() {
        if (typeof window.html2pdf !== 'function') {
            throw new Error('html2pdf.js no está cargado. Verifica el CDN en index.html.');
        }

        const D = window.Darabia;
        if (!D || !D.estado) {
            throw new Error('Estado del simulador no disponible.');
        }
        const estado = D.estado;

        // Construir HTML del documento
        const html = _construirHTML(estado);

        // Contenedor temporal off-screen para que html2pdf renderice
        contenedor.style.left = '0';
        contenedor.style.opacity = '0';
        contenedor.style.position = 'absolute';
        contenedor.style.left = '-9999px';
        contenedor.style.top = '0';
        contenedor.innerHTML = html;
        document.body.appendChild(contenedor);

        const slug = _slugNombre(estado?.alumno?.nombre);
        const filename = `Dictamen_${slug}.pdf`;

        const opciones = {
            margin:       0,
            filename:     filename,
            image:        { type: 'jpeg', quality: 0.96 },
            html2canvas:  {
                scale: 1,
                useCORS: true,
                letterRendering: true,
                logging: false
            },
            jsPDF:        {
                unit: 'mm',
                format: 'a4',
                orientation: 'portrait'
            },
            pagebreak:    { mode: ['css', 'legacy'] }
        };

        try {
            await window.html2pdf().set(opciones).from(contenedor).save();

            // Persistir timestamp tras éxito
            if (estado?.dictamen) {
                estado.dictamen.pdf_generado_at = new Date().toISOString();
                if (D.Persistencia?.guardar) {
                    D.Persistencia.guardar();
                }
            }
        } finally {
            // Limpiar contenedor temporal SIEMPRE (éxito o error)
            if (contenedor.parentElement) {
                contenedor.parentElement.removeChild(contenedor);
            }
        }
    }

    /** ====================================================================
     *  EXPORTAR
     *  ==================================================================== */

    window.Darabia = window.Darabia || {};
    window.Darabia.PDFGenerator = {
        generar: generar
    };

})();
