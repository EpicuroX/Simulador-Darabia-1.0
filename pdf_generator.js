/* ============================================================================
 * pdf_generator.js · Capa 7 · Generación del PDF del dictamen
 * ============================================================================
 *
 * Estrategia: window.print() del navegador.
 *
 * Por qué NO usamos html2pdf / html2canvas:
 *   - html2canvas tiene quirks con elementos off-screen.
 *   - El PDF resultante es una imagen, no texto seleccionable.
 *   - Más bugs por fuentes, scale, viewport.
 *
 * Lo que hace este módulo:
 *   1. Construye el HTML completo del dictamen.
 *   2. Abre una ventana nueva con ese HTML y estilos inline.
 *   3. Espera al load completo de la ventana.
 *   4. Lanza window.print() en la ventana nueva.
 *   5. El navegador ofrece "Guardar como PDF" en el diálogo de impresión.
 *
 * Estructura del documento (sin cambios respecto a versión anterior):
 *   - Cabecera profesional con expediente
 *   - Aviso técnico breve
 *   - Dictamen (secciones 1-6) con la tabla del plan
 *   - Firma del técnico
 *   - ANEXO Cierre técnico (solo si existe en gameState)
 *   - Footer estático profesional
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

    /* ====================================================================
     *  HELPERS DE LIMPIEZA Y FORMATO
     *  ==================================================================== */

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

    function _esc(texto) {
        const limpio = _limpiarEmojis(texto);
        return String(limpio || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function _textoMultilinea(texto) {
        if (!texto || !texto.trim()) {
            return '<p class="pdf-vacia">[Sección no redactada]</p>';
        }
        return _esc(texto)
            .split(/\n\n+/)
            .map(p => '<p>' + p.replace(/\n/g, '<br>') + '</p>')
            .join('');
    }

    function _formatearFecha(d = new Date()) {
        const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
                       'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
        return `${d.getDate()} de ${meses[d.getMonth()]} de ${d.getFullYear()}`;
    }

    /* ====================================================================
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
        <section class="pdf-anexo">
            <h2>ANEXO &middot; Cierre t&eacute;cnico</h2>
            <p class="pdf-anexo-meta">
                Revisi&oacute;n t&eacute;cnica realizada en el simulador Darabia
                con fines formativos. Car&aacute;cter orientativo.
            </p>

            <div class="pdf-anexo-bloque">
                <h4>Diagn&oacute;stico general</h4>
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
            ${TEC_NOMBRE} &middot; T&eacute;c. PRL n&ordm; ${TEC_NUMERO} &middot;
            ${CENTRO} &middot; ${CURSO}
        </footer>`;
    }

    /* ====================================================================
     *  CSS DEL DOCUMENTO (inyectado en la ventana de impresión)
     *  ==================================================================== */

    function _construirEstilos() {
        return `
        <style>
            * { box-sizing: border-box; }

            body {
                font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;
                font-size: 11pt;
                line-height: 1.5;
                color: #1a1a1a;
                background: #ffffff;
                margin: 0;
                padding: 0;
            }

            .pdf-document {
                max-width: 180mm;
                margin: 0 auto;
                padding: 18mm 0;
            }

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
            .pdf-seccion { margin-bottom: 22px; }
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

            .pdf-vacia {
                color: #aaaaaa;
                font-style: italic;
                font-size: 10pt;
            }

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

            .pdf-anexo {
                margin-top: 8px;
                padding: 22px 24px;
                background: #f7f7f9;
                border-left: 4px solid #888;
                border-radius: 2px;
                page-break-before: always;
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

            .pdf-footer {
                margin-top: 28px;
                padding-top: 10px;
                border-top: 1px solid #e0e0e0;
                font-size: 9pt;
                color: #777;
                text-align: center;
                letter-spacing: 0.02em;
            }

            @page {
                size: A4;
                margin: 18mm 16mm;
            }

            @media print {
                body { background: white; }
                .pdf-document {
                    max-width: none;
                    padding: 0;
                }
                .pdf-anexo { page-break-before: always; }
                .pdf-tabla-plan tr { page-break-inside: avoid; }
                .pdf-anexo-bloque { page-break-inside: avoid; }
                .pdf-aviso-pantalla { display: none !important; }
            }

            /* Aviso visible solo en pantalla (no en el PDF impreso) */
            .pdf-aviso-pantalla {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                background: #1f2a3a;
                color: white;
                padding: 12px 20px;
                font-size: 13px;
                font-family: system-ui, sans-serif;
                z-index: 9999;
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 12px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.2);
            }
            .pdf-aviso-pantalla button {
                background: #10d98a;
                color: #0a0f1a;
                border: 0;
                padding: 8px 16px;
                font-weight: 600;
                font-size: 13px;
                border-radius: 4px;
                cursor: pointer;
                font-family: inherit;
                white-space: nowrap;
            }
            .pdf-aviso-pantalla button:hover { background: #0bbd75; }
        </style>`;
    }

    /* ====================================================================
     *  ENSAMBLAJE DE LA VENTANA DE IMPRESIÓN
     *  ==================================================================== */

    function _seccion(estado, id) {
        return estado?.dictamen?.secciones?.[id] || null;
    }

    function _textoSeccion(estado, id) {
        const s = _seccion(estado, id);
        return s?.contenido || '';
    }

    function _partirArgumentacion(texto) {
        if (!texto || !texto.trim()) return { legal: '', economico: '' };

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

    function _construirCuerpoHTML(estado) {
        const alumno = estado?.alumno || {};
        const cierre = estado?.dictamen?.cierre_tecnico || null;
        const arg = _partirArgumentacion(_textoSeccion(estado, '06_argumentacion'));

        return `
            ${_construirCabecera(alumno)}
            ${_construirAviso()}

            <main class="pdf-cuerpo">
                <h1>DICTAMEN T&Eacute;CNICO PSICOSOCIAL</h1>
                <h2 class="pdf-empresa">Gestor&iacute;a Moreno &amp; Asociados S.L.</h2>

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

            ${_construirFooter()}`;
    }

    function _construirDocumentoCompleto(estado) {
        const alumno = estado?.alumno || {};
        const titulo = `Dictamen ${EXPEDIENTE} - ${alumno.nombre || 'Alumno'}`;

        return `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${_esc(titulo)}</title>
    ${_construirEstilos()}
</head>
<body>
    <div class="pdf-aviso-pantalla">
        <span>Para guardar como PDF, pulsa el bot&oacute;n o usa Ctrl/Cmd + P y elige &laquo;Guardar como PDF&raquo;.</span>
        <button type="button" onclick="window.print();">Imprimir / Guardar PDF</button>
    </div>

    <div class="pdf-document" style="padding-top: 60px;">
        ${_construirCuerpoHTML(estado)}
    </div>

    <script>
        // Lanza el diálogo de impresión automáticamente al cargar.
        window.addEventListener('load', function() {
            setTimeout(function() {
                try { window.print(); } catch (e) { /* ignorar */ }
            }, 300);
        });
    </script>
</body>
</html>`;
    }

    /* ====================================================================
     *  PUNTO DE ENTRADA · GENERAR
     *  ==================================================================== */

    /**
     * Genera el PDF abriendo una ventana nueva con el dictamen y disparando
     * window.print() en ella. El usuario verá el diálogo nativo de impresión
     * del navegador y podrá elegir "Guardar como PDF".
     *
     * @returns {Promise<void>}
     * @throws si el navegador bloquea la ventana popup.
     */
    async function generar() {
        const D = window.Darabia;
        if (!D || !D.estado) {
            throw new Error('Estado del simulador no disponible.');
        }
        const estado = D.estado;

        const html = _construirDocumentoCompleto(estado);

        // Abrir ventana nueva. Si el navegador bloquea popups, fallará.
        // Esta llamada DEBE venir de un click directo del usuario para
        // que el navegador permita la apertura.
        const ventana = window.open('', '_blank', 'width=900,height=1100');
        if (!ventana) {
            throw new Error(
                'El navegador ha bloqueado la ventana de impresión. ' +
                'Permite las ventanas emergentes para este sitio y reintenta.'
            );
        }

        // Inyectar el documento completo y cerrar el flujo de escritura
        // para que el navegador procese el contenido y dispare el evento load.
        ventana.document.open();
        ventana.document.write(html);
        ventana.document.close();

        // Persistir timestamp tras lanzar la ventana de impresión.
        if (estado?.dictamen) {
            estado.dictamen.pdf_generado_at = new Date().toISOString();
            if (D.Persistencia?.guardar) {
                try { D.Persistencia.guardar(); } catch (_) { /* ignorar */ }
            }
        }
    }

    /* ====================================================================
     *  EXPORTAR
     *  ==================================================================== */

    window.Darabia = window.Darabia || {};
    window.Darabia.PDFGenerator = {
        generar: generar
    };

})();
