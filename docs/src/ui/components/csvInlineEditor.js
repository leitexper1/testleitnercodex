/**
 * Inline CSV editor rendering a content editable table backed by a textarea to
 * preserve compatibility with copy/paste workflows.
 */

const CSV_FIELDS = [
    { key: 'question', label: 'Question', header: 'question_content' },
    { key: 'questionImage', label: 'Image question', header: 'question_content_image' },
    { key: 'answer', label: 'Réponse', header: 'answer_content' },
    { key: 'answerImage', label: 'Image réponse', header: 'answer_content_image' },
    { key: 'box', label: 'Boîte', header: 'box_number' },
    { key: 'lastReview', label: 'Dernière révision', header: 'last_reviewed' }
];

function escapeCsvValue(value) {
    if (value === null || value === undefined) {
        return '';
    }

    const stringValue = String(value);
    if (stringValue.includes('"') || stringValue.includes(',') || stringValue.includes(';') || stringValue.includes('\n')) {
        return `"${stringValue.replace(/"/g, '""')}"`;
    }
    return stringValue;
}

function parseCsvLine(line, delimiter = ',') {
    const values = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i += 1) {
        const char = line[i];

        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i += 1;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === delimiter && !inQuotes) {
            values.push(current);
            current = '';
        } else {
            current += char;
        }
    }

    values.push(current);
    return values.map((value) => value.trim());
}

function detectDelimiter(rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
        return ',';
    }

    const candidates = [',', ';'];
    const maxLines = Math.min(rows.length, 20);
    let bestDelimiter = ',';
    let bestScore = -1;
    let bestModeLength = 0;

    candidates.forEach((delimiter) => {
        const counts = new Map();
        let inspected = 0;

        for (let i = 0; i < maxLines; i += 1) {
            const line = rows[i];
            if (!line || !line.trim()) {
                continue;
            }

            inspected += 1;
            const values = parseCsvLine(line, delimiter);
            const length = values.length;
            counts.set(length, (counts.get(length) || 0) + 1);
        }

        if (!inspected) {
            return;
        }

        let modeCount = 0;
        let modeLength = 0;

        counts.forEach((occurrences, length) => {
            if (occurrences > modeCount || (occurrences === modeCount && length > modeLength)) {
                modeCount = occurrences;
                modeLength = length;
            }
        });

        if (modeCount > bestScore || (modeCount === bestScore && modeLength > bestModeLength)) {
            bestScore = modeCount;
            bestModeLength = modeLength;
            bestDelimiter = delimiter;
        }
    });

    return bestDelimiter;
}

function formatLastReview(dateValue) {
    if (!dateValue) {
        return '';
    }

    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) {
        return '';
    }

    return date.toISOString().split('T')[0];
}
export class CSVInlineEditor {
    /**
     * @param {Object} options - Component options.
     * @param {HTMLElement} options.container - Root container receiving the markup.
     * @param {import('../keyboardManager.js').KeyboardManager} [options.keyboardManager] - Optional shortcut manager.
     */
    constructor({ container, keyboardManager } = {}) {
        this.container = container;
        this.keyboardManager = keyboardManager || null;
        this.data = [];

        this.handleTableInput = this.handleTableInput.bind(this);
        this.handleAddRow = this.handleAddRow.bind(this);
        this.handleExport = this.handleExport.bind(this);
        this.handleImport = this.handleImport.bind(this);
    }

    /**
     * Render initial DOM structure.
     *
     * @returns {void}
     */
    init() {
        if (!this.container) {
            console.warn('CSVInlineEditor requires a container element.');
            return;
        }

        this.container.classList.add('csv-inline-editor');
        this.container.innerHTML = `
            <div class="csv-inline-editor__header">
                <h2 class="csv-inline-editor__title">Éditeur CSV inline</h2>
                <p class="csv-inline-editor__description">
                    Modifiez directement les cellules ci-dessous. Les modifications sont synchronisées avec la zone CSV.
                </p>
            </div>
            <div class="csv-inline-editor__toolbar">
                <button type="button" class="csv-inline-editor__action" data-action="load">
                    Charger les cartes actuelles
                </button>
                <button type="button" class="csv-inline-editor__action" data-action="add">
                    Ajouter une ligne
                </button>
                <button type="button" class="csv-inline-editor__action" data-action="export">
                    Exporter en CSV
                </button>
                <span class="csv-inline-editor__status" aria-live="polite"></span>
            </div>
            <div class="csv-inline-editor__content" role="region" aria-label="Tableau d'édition CSV">
                <table class="csv-inline-editor__table">
                    <thead>
                        <tr>
                            ${CSV_FIELDS.map(field => `<th scope="col">${field.label}</th>`).join('')}
                        </tr>
                    </thead>
                    <tbody></tbody>
                </table>
            </div>
            <label class="csv-inline-editor__textarea-label" for="csv-inline-editor-textarea">
                Représentation brute (pour copier-coller)
            </label>
            <textarea id="csv-inline-editor-textarea" class="csv-inline-editor__textarea" rows="6"></textarea>
        `;

        this.elements = {
            tableBody: this.container.querySelector('tbody'),
            textarea: this.container.querySelector('textarea'),
            status: this.container.querySelector('.csv-inline-editor__status'),
            loadButton: this.container.querySelector('[data-action="load"]'),
            addButton: this.container.querySelector('[data-action="add"]'),
            exportButton: this.container.querySelector('[data-action="export"]')
        };

        this.elements.tableBody.addEventListener('input', this.handleTableInput);
        this.elements.loadButton.addEventListener('click', this.handleImport);
        this.elements.addButton.addEventListener('click', this.handleAddRow);
        this.elements.exportButton.addEventListener('click', this.handleExport);
        this.elements.textarea.addEventListener('input', () => this.importFromText());

        if (this.keyboardManager) {
            this.keyboardManager.registerShortcut('ctrl+e', () => this.handleExport(), {
                description: 'Exporter le CSV inline',
                element: this.elements.exportButton
            });
        }

        this.renderRows();
    }

    /**
     * Connect the editor to a Leitner app instance.
     *
     * @param {import('../../core/leitnerApp.js').LeitnerApp} app - App instance exposing flashcards.
     * @returns {void}
     */
    bindToApp(app) {
        this.app = app;
        this.loadFromApp();

        window.addEventListener('leitner:card-reviewed', () => this.loadFromApp(), { passive: true });
        window.addEventListener('leitner:session-recorded', () => this.loadFromApp(), { passive: true });
        window.addEventListener('leitner:cards-updated', () => this.loadFromApp(), { passive: true });
    }

    /**
     * Load flashcards from the connected app.
     *
     * @returns {void}
     */
    loadFromApp() {
        if (!this.app) {
            return;
        }

        const cards = Array.isArray(this.app.flashcards) ? this.app.flashcards : [];
        this.data = cards.map(card => ({
            question: card.question || '',
            questionImage: card.questionImage || '',
            answer: card.answer || '',
            answerImage: card.answerImage || '',
            box: card.box || 1,
            lastReview: formatLastReview(card.lastReview)
        }));
        this.renderRows();
        this.syncTextarea();
        this.setStatus(`${this.data.length} lignes chargées depuis l'application.`);
    }

    /**
     * Import data from the textarea content.
     *
     * @returns {void}
     */
    importFromText() {
        const text = this.elements.textarea.value.trim();
        if (!text) {
            this.data = [];
            this.renderRows();
            this.setStatus('Zone CSV vide.');
            return;
        }

        const rows = text.split(/\r?\n/).filter((line) => line.trim() !== '');
        if (!rows.length) {
            this.data = [];
            this.renderRows();
            this.setStatus('Zone CSV vide.');
            return;
        }

        const delimiter = detectDelimiter(rows);
        const headers = parseCsvLine(rows[0], delimiter);
        const hasHeaders = headers.length === CSV_FIELDS.length && CSV_FIELDS.every((field, index) => headers[index] === field.header);
        const dataRows = hasHeaders ? rows.slice(1) : rows;

        this.data = dataRows.map((row) => {
            const values = parseCsvLine(row, delimiter);
            const mapped = {};
            CSV_FIELDS.forEach((field, index) => {
                const rawValue = values[index] ?? '';
                if (field.key === 'box') {
                    mapped[field.key] = Number(rawValue) || 1;
                } else {
                    mapped[field.key] = rawValue;
                }
            });
            return mapped;
        });

        this.renderRows();
        const importMessage = hasHeaders
            ? `${this.data.length} lignes importées (en-têtes reconnus).`
            : `${this.data.length} lignes importées sans en-têtes.`;
        this.setStatus(importMessage);
    }

    /**
     * Handle edits performed inside the table.
     *
     * @param {Event} event - Input event triggered by contentEditable cells.
     * @returns {void}
     */
    handleTableInput(event) {
        const cell = event.target;
        if (!cell.dataset?.rowIndex || !cell.dataset?.field) {
            return;
        }

        const index = Number(cell.dataset.rowIndex);
        const field = cell.dataset.field;
        this.data[index][field] = field === 'box'
            ? Number(cell.textContent.trim()) || 1
            : cell.textContent.trim();

        this.syncTextarea();
    }

    /**
     * Append an empty row to the dataset.
     *
     * @returns {void}
     */
    handleAddRow() {
        this.data.push({
            question: '',
            questionImage: '',
            answer: '',
            answerImage: '',
            box: 1,
            lastReview: ''
        });
        this.renderRows();
        this.syncTextarea();
        this.setStatus('Nouvelle ligne ajoutée.');
    }

    /**
     * Export the current dataset as a downloadable CSV file.
     *
     * @returns {void}
     */
    handleExport() {
        const headerLine = CSV_FIELDS.map(field => field.header).join(',');
        const contentLines = this.data.map((row) => {
            const values = CSV_FIELDS.map((field) => {
                if (field.key === 'box') {
                    return escapeCsvValue(Number(row[field.key]) || 1);
                }
                return escapeCsvValue(row[field.key] ?? '');
            });
            return values.join(',');
        });
        const content = [headerLine, ...contentLines].join('\n');
        const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = 'flashcards-inline.csv';
        anchor.click();
        URL.revokeObjectURL(url);
        this.setStatus('Export CSV généré.');
    }

    /**
     * Import flashcards from the connected application.
     *
     * @returns {void}
     */
    handleImport() {
        this.loadFromApp();
    }

    /**
     * Synchronise textarea content with the table data.
     *
     * @returns {void}
     */
    syncTextarea() {
        if (!this.elements) {
            return;
        }

        const headerLine = CSV_FIELDS.map(field => field.header).join(',');
        const dataLines = this.data.map((row) => {
            const values = CSV_FIELDS.map((field) => {
                if (field.key === 'box') {
                    return escapeCsvValue(Number(row[field.key]) || 1);
                }
                return escapeCsvValue(row[field.key] ?? '');
            });
            return values.join(',');
        });
        this.elements.textarea.value = [headerLine, ...dataLines].join('\n');
    }

    /**
     * Render table rows from the dataset.
     *
     * @returns {void}
     */
    renderRows() {
        if (!this.elements) {
            return;
        }

        const body = this.elements.tableBody;
        body.innerHTML = '';

        if (!this.data.length) {
            const emptyRow = document.createElement('tr');
            const cell = document.createElement('td');
            cell.colSpan = CSV_FIELDS.length;
            cell.textContent = 'Aucune donnée. Ajoutez une ligne pour commencer.';
            emptyRow.appendChild(cell);
            body.appendChild(emptyRow);
            return;
        }

        this.data.forEach((row, index) => {
            const tr = document.createElement('tr');
            CSV_FIELDS.forEach((field) => {
                const td = document.createElement('td');
                td.contentEditable = 'true';
                td.dataset.rowIndex = String(index);
                td.dataset.field = field.key;
                td.className = 'csv-inline-editor__cell';
                td.textContent = row[field.key] ?? '';
                tr.appendChild(td);
            });
            body.appendChild(tr);
        });
    }

    /**
     * Display a status message in the toolbar.
     *
     * @param {string} message - Text to display.
     * @returns {void}
     */
    setStatus(message) {
        if (this.elements?.status) {
            this.elements.status.textContent = message;
        }
    }
}
