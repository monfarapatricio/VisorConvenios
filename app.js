// DOM Elements
const btnUpdateData = document.getElementById('btnUpdateData');
const btnEmptyUpdate = document.getElementById('btnEmptyUpdate');
const folderInput = document.getElementById('folderInput');

const emptyState = document.getElementById('emptyState');
const loadingState = document.getElementById('loadingState');
const dashboard = document.getElementById('dashboard');

const providerSelect = document.getElementById('providerSelect');
const searchInput = document.getElementById('searchInput');
const tableBody = document.getElementById('tableBody');
const noResults = document.getElementById('noResults');

const normasModal = document.getElementById('normasModal');
const btnCloseModal = document.getElementById('btnCloseModal');
const btnModalOk = document.getElementById('btnModalOk');
const modalTitle = document.getElementById('modalTitle');
const modalSubtitle = document.querySelector('#modalSubtitle span');
const modalBody = document.getElementById('modalBody');

// Application State
let db = {
    providers: [],    // Nombres de los prestadores (carpetas)
    practices: {},    // practices[providerName] = array of practices
    normas: {},       // normas[providerName][normalizedCode] = norma object
    currentSort: { column: 'deno', direction: 'asc' } // Orden por defecto
};

let currentProvider = '';

// Iniciar aplicación
document.addEventListener('DOMContentLoaded', async () => {
    // Intentar cargar desde IndexedDB
    try {
        const savedData = await localforage.getItem('convenios_db');
        if (savedData && savedData.providers.length > 0) {
            db = savedData;
            initDashboard();
        } else {
            showEmptyState();
        }
    } catch (e) {
        console.error("Error loading local data", e);
        showEmptyState();
    }
});

// Event Listeners
btnUpdateData.addEventListener('click', () => folderInput.click());
btnEmptyUpdate.addEventListener('click', () => folderInput.click());

folderInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    showLoadingState();
    
    // Resetear base de datos
    db = { providers: [], practices: {}, normas: {} };
    
    try {
        // Encontrar las carpetas (Prestadores)
        // El path webkitRelativePath suele ser "CONVENIOS/Arauz/IQ.csv"
        const foldersMap = new Map();
        
        for (const file of files) {
            if (!file.name.toLowerCase().endsWith('.csv')) continue;
            
            const pathParts = file.webkitRelativePath.split('/');
            // Asegurarse de que el archivo esté dentro de un subdirectorio
            if (pathParts.length >= 3) {
                const providerName = pathParts[pathParts.length - 2];
                
                if (!foldersMap.has(providerName)) {
                    foldersMap.set(providerName, []);
                }
                foldersMap.get(providerName).push(file);
            }
        }

        db.providers = Array.from(foldersMap.keys()).sort();

        // Helper para obtener valores sin problemas de BOM
        const getVal = (row, key) => {
            const actualKey = Object.keys(row).find(k => k.trim().replace(/^\uFEFF/, '').toLowerCase() === key.toLowerCase());
            return actualKey ? row[actualKey] : undefined;
        };

        // Procesar archivos por prestador
        for (const [providerName, providerFiles] of foldersMap) {
            const practicesMap = new Map();
            db.normas[providerName] = {};

            for (const file of providerFiles) {
                const isNorma = file.name.toUpperCase().includes('NORMAS');
                
                // Parsear CSV
                const results = await parseCSV(file);
                if (!results || results.length === 0) continue;

                if (isNorma) {
                    // Procesar NORMAS
                    results.forEach(row => {
                        const prestac = getVal(row, 'prestac');
                        if (!prestac) return;
                        const code = normalizeCode(prestac);
                        
                        // Limpiar todas las keys para evitar problemas en el modal
                        const cleanRow = {};
                        Object.keys(row).forEach(k => {
                            const cleanK = k.trim().replace(/^\uFEFF/, '').toLowerCase();
                            cleanRow[cleanK] = row[k];
                        });
                        
                        db.normas[providerName][code] = cleanRow;
                    });
                } else {
                    // Procesar Prácticas
                    results.forEach(row => {
                        const prestac = getVal(row, 'prestac');
                        const deno = getVal(row, 'deno');
                        const ambuInter = (getVal(row, 'ambu_inter') || '').trim().toUpperCase();

                        if (prestac && deno) { 
                            row.prestac = prestac; // Set limpio por si tenía BOM
                            row.deno = deno;
                            row.ambu_inter_clean = ambuInter;
                            
                            const existing = practicesMap.get(prestac);
                            if (existing) {
                                // Si ya existe y el nuevo es 'I', lo reemplazamos (priorizamos Internación)
                                if (ambuInter === 'I' && existing.ambu_inter_clean !== 'I') {
                                    practicesMap.set(prestac, row);
                                }
                            } else {
                                practicesMap.set(prestac, row);
                            }
                        }
                    });
                }
            }
            // Guardar el array final sin duplicados
            db.practices[providerName] = Array.from(practicesMap.values());
        }

        // Guardar en IndexedDB para futuras visitas
        await localforage.setItem('convenios_db', db);
        
        initDashboard();

    } catch (error) {
        console.error("Error procesando archivos:", error);
        alert("Hubo un error al procesar los archivos. Asegúrese de seleccionar la carpeta correcta.");
        showEmptyState();
    }
    
    // Limpiar el input para permitir volver a seleccionar la misma carpeta
    folderInput.value = '';
});

// UI State Functions
function showEmptyState() {
    emptyState.classList.remove('hidden');
    dashboard.classList.add('hidden');
    loadingState.classList.add('hidden');
}

function showLoadingState() {
    emptyState.classList.add('hidden');
    dashboard.classList.add('hidden');
    loadingState.classList.remove('hidden');
}

function initDashboard() {
    emptyState.classList.add('hidden');
    loadingState.classList.add('hidden');
    dashboard.classList.remove('hidden');

    // Poblar Select
    providerSelect.innerHTML = '<option value="">Seleccione un prestador...</option>';
    db.providers.forEach(provider => {
        const option = document.createElement('option');
        option.value = provider;
        option.textContent = provider;
        providerSelect.appendChild(option);
    });

    // Reset UI
    providerSelect.value = '';
    searchInput.value = '';
    tableBody.innerHTML = '';
    noResults.classList.add('hidden');
    
    // Si hay solo un prestador, seleccionarlo por defecto
    if (db.providers.length === 1) {
        providerSelect.value = db.providers[0];
        handleProviderChange();
    }
}

// Logic & Interaction
providerSelect.addEventListener('change', handleProviderChange);
searchInput.addEventListener('input', handleSearch);

// Event listeners para ordenamiento de tabla
document.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
        const column = th.dataset.column;
        if (db.currentSort.column === column) {
            db.currentSort.direction = db.currentSort.direction === 'asc' ? 'desc' : 'asc';
        } else {
            db.currentSort.column = column;
            db.currentSort.direction = 'asc';
        }
        renderTable();
    });
});

function handleProviderChange() {
    currentProvider = providerSelect.value;
    searchInput.value = ''; // Reset search on provider change
    renderTable();
}

function handleSearch() {
    if (!currentProvider) return;
    renderTable();
}

function renderTable() {
    if (!currentProvider) {
        tableBody.innerHTML = '';
        noResults.classList.add('hidden');
        return;
    }

    const searchTerm = removeAccents(searchInput.value.toLowerCase().trim());
    const practices = db.practices[currentProvider] || [];
    
    let filtered = practices;
    if (searchTerm) {
        filtered = practices.filter(p => {
            const code = String(p.prestac || '').toLowerCase();
            const deno = removeAccents(String(p.deno || '').toLowerCase());
            return code.includes(searchTerm) || deno.includes(searchTerm);
        });
    }

    // Ordenamiento dinámico
    const { column, direction } = db.currentSort;
    if (column) {
        filtered.sort((a, b) => {
            let valA = a[column];
            let valB = b[column];

            // Manejo especial para valores numéricos
            if (column === 'valor') {
                valA = parseFloat(valA) || 0;
                valB = parseFloat(valB) || 0;
                return direction === 'asc' ? valA - valB : valB - valA;
            } 
            
            // Caso general (strings)
            valA = removeAccents(String(valA || '').toLowerCase());
            valB = removeAccents(String(valB || '').toLowerCase());
            
            if (valA < valB) return direction === 'asc' ? -1 : 1;
            if (valA > valB) return direction === 'asc' ? 1 : -1;
            return 0;
        });
    }

    // Actualizar UI de los encabezados (iconos de flecha)
    document.querySelectorAll('th.sortable').forEach(th => {
        const col = th.dataset.column;
        const icon = th.querySelector('.sort-icon');
        th.classList.remove('sort-asc', 'sort-desc');
        
        if (col === column) {
            th.classList.add(direction === 'asc' ? 'sort-asc' : 'sort-desc');
            icon.textContent = direction === 'asc' ? 'expand_less' : 'expand_more';
        } else {
            icon.textContent = 'unfold_more';
        }
    });

    tableBody.innerHTML = '';

    if (filtered.length === 0) {
        noResults.classList.remove('hidden');
        document.querySelector('.table-container').style.display = 'none';
        return;
    }

    noResults.classList.add('hidden');
    document.querySelector('.table-container').style.display = 'block';

    const fragment = document.createDocumentFragment();

    filtered.forEach(p => {
        const tr = document.createElement('tr');
        
        // Formatear Valor
        let valor = p.valor;
        if (!isNaN(parseFloat(valor))) {
            valor = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(valor);
        }

        // Tipo (Ambulatorio / Internacion)
        let tipo = '';
        if (p.ambu_inter === 'A') tipo = 'Ambulatorio';
        else if (p.ambu_inter === 'I') tipo = 'Internación';
        else tipo = p.ambu_inter || '-';

        // Check Normas
        const codeNorm = normalizeCode(p.prestac);
        const norma = db.normas[currentProvider]?.[codeNorm];

        tr.innerHTML = `
            <td><strong>${p.prestac}</strong></td>
            <td>${p.deno}</td>
            <td class="text-right font-medium">${valor || '-'}</td>
            <td>${tipo}</td>
            <td class="text-center">
                ${norma ? `
                    <button class="badge-norma" onclick="openNormaModal('${codeNorm}')" title="Ver Normas">
                        <span class="material-symbols-outlined">info</span>
                        Ver Normas
                    </button>
                ` : '<span class="text-muted" style="font-size:0.8rem">-</span>'}
            </td>
        `;
        fragment.appendChild(tr);
    });

    tableBody.appendChild(fragment);
}

// Normas Modal
window.openNormaModal = function(code) {
    if (!currentProvider) return;
    const norma = db.normas[currentProvider]?.[code];
    if (!norma) return;

    modalSubtitle.textContent = norma.prestac;
    
    // Construir contenido de la norma
    // Campos posibles: inclu, inclu2, inclu3, inclu4, inclu5, inclu6, exclu, exclu2...
    let inclusiones = [];
    let exclusiones = [];

    for (let i = 1; i <= 6; i++) {
        const keyInc = i === 1 ? 'inclu' : `inclu${i}`;
        const keyExc = i === 1 ? 'exclu' : `exclu${i}`;
        
        if (norma[keyInc] && norma[keyInc].trim() !== '') inclusiones.push(norma[keyInc].trim());
        if (norma[keyExc] && norma[keyExc].trim() !== '') exclusiones.push(norma[keyExc].trim());
    }

    let html = '';
    
    // A veces la norma viene en el campo "deno" o no tiene inclusiones específicas pero tiene observaciones.
    // Si no hay inclusiones ni exclusiones, mostrar todas las propiedades como tabla plana o raw data.
    if (inclusiones.length === 0 && exclusiones.length === 0) {
        // Intenta buscar otras keys si las hay
        html = `<div class="norma-section">
            <div class="norma-title"><span class="material-symbols-outlined">description</span> Observaciones Generales</div>
            <div class="norma-content">${norma.deno || 'Sin información detallada.'}</div>
        </div>`;
    } else {
        if (inclusiones.length > 0) {
            html += `<div class="norma-section">
                <div class="norma-title" style="color: #2e7d32"><span class="material-symbols-outlined">check_circle</span> Incluye / Observaciones</div>
                <div class="norma-content">${inclusiones.join('\n\n')}</div>
            </div>`;
        }
        if (exclusiones.length > 0) {
            html += `<div class="norma-section">
                <div class="norma-title" style="color: var(--primary)"><span class="material-symbols-outlined">cancel</span> Excluye</div>
                <div class="norma-content">${exclusiones.join('\n\n')}</div>
            </div>`;
        }
    }

    modalBody.innerHTML = html;
    normasModal.classList.remove('hidden');
}

// Cerrar Modal
function closeModal() {
    normasModal.classList.add('hidden');
}
btnCloseModal.addEventListener('click', closeModal);
btnModalOk.addEventListener('click', closeModal);
normasModal.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-backdrop')) closeModal();
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
});


// Utils
function parseCSV(file) {
    return new Promise((resolve, reject) => {
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
                resolve(results.data);
            },
            error: (error) => {
                reject(error);
            }
        });
    });
}

function normalizeCode(code) {
    if (!code) return '';
    // Remover espacios y ceros a la izquierda para comparar ' 030202' y '30202' igual
    return String(code).trim().replace(/^0+/, '').trim();
}

function removeAccents(str) {
    if (!str) return '';
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
