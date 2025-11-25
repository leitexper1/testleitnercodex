export class UIManager {
    init(app) {
        this.app = app;
        this.boxClickHandler = null;
        this.keyboardManager = app?.keyboardManager || null;
        this.imageFieldControllers = {};
        this.csvStatusElement = document.getElementById('csv-load-status');
        this.csvStatusTimeout = null;
        this.bindEvents();
        this.registerKeyboardShortcuts();
    }

    cancelScheduledCSVStatusClear() {
        if (this.csvStatusTimeout) {
            clearTimeout(this.csvStatusTimeout);
            this.csvStatusTimeout = null;
        }
    }

    scheduleCSVStatusClear(delay = 4000) {
        this.cancelScheduledCSVStatusClear();
        this.csvStatusTimeout = window.setTimeout(() => {
            this.updateCSVStatus('');
        }, delay);
    }

    updateCSVStatus(message, tone = 'neutral') {
        if (!this.csvStatusElement) {
            return;
        }

        const toneClasses = ['text-green-600', 'text-red-600', 'text-gray-600'];

        if (!message) {
            this.csvStatusElement.textContent = '';
            this.csvStatusElement.classList.add('hidden');
            toneClasses.forEach(cls => this.csvStatusElement.classList.remove(cls));
            this.cancelScheduledCSVStatusClear();
            return;
        }

        const toneClass = tone === 'error'
            ? 'text-red-600'
            : tone === 'success'
                ? 'text-green-600'
                : 'text-gray-600';

        this.csvStatusElement.classList.remove('hidden');
        toneClasses.forEach(cls => this.csvStatusElement.classList.remove(cls));
        this.csvStatusElement.classList.add(toneClass);
        this.csvStatusElement.textContent = message;
    }

    announceCSVLoaded(csvName) {
        this.updateCSVStatus(`Le fichier CSV « ${csvName} » a été chargé avec succès.`, 'success');
        this.scheduleCSVStatusClear();
    }

    announceCSVLoadError(csvName, detail = '') {
        const suffix = detail ? ` : ${detail}` : '';
        this.updateCSVStatus(`Impossible de charger le fichier CSV « ${csvName} »${suffix}.`, 'error');
        this.scheduleCSVStatusClear(6000);
    }

    async loadSelectedCSV(option) {
        const csvName = option?.value;

        if (!option || option.disabled || !csvName) {
            this.app.setCurrentCSV('default');
            this.app.flashcards = [];
            this.app.refreshBoxes();
            this.updateCSVStatus('');
            return false;
        }

        const isSwitchingDeck = csvName !== this.app.currentCSV;
        if (isSwitchingDeck) {
            this.app.persistCurrentProgress();
        }

        if (csvName === this.app.currentCSV && this.app.flashcards.length > 0) {
            this.updateCSVStatus('');
            return true;
        }

        const downloadUrl = option.dataset.downloadUrl;

        try {
            let loaded = false;

            if (downloadUrl) {
                loaded = await this.app.loadCSVFromURL(downloadUrl, csvName);
            } else {
                loaded = this.app.crud.loadFlashcards(csvName);

                if (!loaded) {
                    this.app.setCurrentCSV(csvName);
                    this.app.flashcards = [];
                    this.app.saveFlashcards();
                    loaded = true;
                }
            }

            if (!loaded) {
                this.announceCSVLoadError(csvName);
                return false;
            }

            if (isSwitchingDeck) {
                this.app.resetBoxOneForCSV(csvName);
            }

            this.announceCSVLoaded(csvName);
            return true;
        } catch (error) {
            console.error('Erreur lors du chargement du CSV sélectionné', error);
            this.announceCSVLoadError(csvName, error?.message);
            alert(`Erreur de chargement du fichier "${csvName}": ${error.message}`);
            return false;
        }
    }

    readFileAsDataURL(file) {
        return new Promise((resolve, reject) => {
            if (!file) {
                resolve(null);
                return;
            }

            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
        });
    }

    setupImageField(type) {
        const prefix = type === 'question' ? 'question' : 'answer';
        const textInput = document.getElementById(`card-${prefix}-image`);
        const fileInput = document.getElementById(`${prefix}-image-upload`);
        const browseButton = document.getElementById(`browse-${prefix}-image`);
        const dropzone = document.getElementById(`${prefix}-image-dropzone`);
        const preview = document.getElementById(`${prefix}-image-preview`);
        const status = document.getElementById(`${prefix}-image-status`);
        const clearButton = document.getElementById(`clear-${prefix}-image`);

        if (!textInput) {
            return {
                updateFromValue: () => {},
                clear: () => {}
            };
        }

        const resolveImageType = () => (type === 'answer' ? 'answer' : 'question');

        const normaliseToRepositoryPath = (rawValue) => {
            const trimmed = (rawValue || '').trim();
            if (!trimmed) {
                return '';
            }
            if (this.app?.github?.ensureRepositoryImagePath) {
                return this.app.github.ensureRepositoryImagePath(trimmed, resolveImageType());
            }
            const withoutPrefix = trimmed.replace(/^\.\/+/, '').replace(/^\/+/, '');
            if (withoutPrefix.startsWith('images_questions/') || withoutPrefix.startsWith('images_reponses/')) {
                return withoutPrefix;
            }
            const directory = resolveImageType() === 'answer' ? 'images_reponses' : 'images_questions';
            return `${directory}/${withoutPrefix}`;
        };

        const buildRelativePathFromFile = (fileName) => {
            const trimmed = (fileName || '').trim();
            if (!trimmed) {
                return '';
            }
            if (this.app?.github?.buildRelativeImagePath) {
                return this.app.github.buildRelativeImagePath(trimmed, resolveImageType());
            }
            const safeName = trimmed
                .replace(/\s+/g, '_')
                .replace(/[^a-zA-Z0-9_.-]/g, '_');
            const directory = resolveImageType() === 'answer' ? 'images_reponses' : 'images_questions';
            return `${directory}/${safeName}`;
        };

        const setAppImageState = ({ file = null, data = null } = {}) => {
            if (type === 'question') {
                this.app.currentQuestionImageFile = file;
                this.app.currentQuestionImageData = data;
            } else {
                this.app.currentAnswerImageFile = file;
                this.app.currentAnswerImageData = data;
            }
        };

        const setStatus = (message) => {
            if (status) {
                status.textContent = message || '';
            }
        };

        const hidePreview = () => {
            if (!preview) {
                return;
            }
            preview.removeAttribute('src');
            preview.style.display = 'none';
            preview.setAttribute('aria-hidden', 'true');
        };

        const showPreview = (src) => {
            if (!preview || !src) {
                hidePreview();
                return;
            }
            preview.onerror = () => {
                hidePreview();
                setStatus('Impossible de charger l\'image fournie.');
            };
            preview.src = src;
            preview.style.display = 'block';
            preview.setAttribute('aria-hidden', 'false');
        };

        const clear = (options = {}) => {
            textInput.value = '';
            setAppImageState({ file: null, data: null });
            hidePreview();
            if (!options.silent) {
                setStatus('Aucune image sélectionnée.');
            } else {
                setStatus('');
            }
        };

        const useDataUrl = (dataUrl, { label = 'Image intégrée.' } = {}) => {
            if (!dataUrl) {
                clear({ silent: true });
                return;
            }
            showPreview(dataUrl);
            textInput.value = '';
            setStatus(`${label} Fournissez un fichier ou un lien pour l'export.`);
            setAppImageState({ file: null, data: null });
        };

        const useExternalPath = (value) => {
            const trimmed = value.trim();
            if (!trimmed) {
                clear({ silent: true });
                return;
            }

            const repositoryPath = normaliseToRepositoryPath(trimmed);
            const resolvedUrl = this.app.github.getImageUrl(repositoryPath, resolveImageType());
            showPreview(resolvedUrl);
            textInput.value = repositoryPath;
            setStatus('Chemin référencé pour le dépôt.');
            setAppImageState({ file: null, data: null });
        };

        const handleFileSelection = async (file, originLabel) => {
            if (!file) {
                return;
            }
            try {
                const dataUrl = await this.readFileAsDataURL(file);
                const repositoryPath = normaliseToRepositoryPath(buildRelativePathFromFile(file.name));
                showPreview(dataUrl);
                textInput.value = repositoryPath;
                const origin = originLabel || 'importée';
                setStatus(`Image ${origin} et référencée sous ${repositoryPath}.`);
                setAppImageState({ file: null, data: null });
            } catch (error) {
                console.error('Impossible de lire le fichier image sélectionné', error);
                setStatus('Échec de la lecture du fichier image.');
            }
            if (fileInput) {
                fileInput.value = '';
            }
        };

        browseButton?.addEventListener('click', (event) => {
            event.preventDefault();
            fileInput?.click();
        });

        fileInput?.addEventListener('change', (event) => {
            const file = event.target.files && event.target.files[0];
            if (file) {
                handleFileSelection(file, 'importée');
            }
        });

        if (dropzone) {
            const deactivateDropzone = () => dropzone.classList.remove('image-dropzone--active');

            dropzone.addEventListener('click', () => fileInput?.click());
            dropzone.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    fileInput?.click();
                }
            });
            dropzone.addEventListener('dragover', (event) => {
                event.preventDefault();
                dropzone.classList.add('image-dropzone--active');
            });
            dropzone.addEventListener('dragleave', () => {
                deactivateDropzone();
            });
            dropzone.addEventListener('drop', (event) => {
                event.preventDefault();
                deactivateDropzone();
                const file = event.dataTransfer?.files?.[0];
                if (file) {
                    handleFileSelection(file, 'déposée');
                }
            });
            dropzone.addEventListener('paste', (event) => {
                const items = event.clipboardData?.items;
                if (!items) {
                    return;
                }
                for (let index = 0; index < items.length; index += 1) {
                    const item = items[index];
                    if (item && item.type && item.type.startsWith('image/')) {
                        const file = item.getAsFile();
                        if (file) {
                            event.preventDefault();
                            handleFileSelection(file, 'collée');
                            break;
                        }
                    }
                }
            });
        }

        clearButton?.addEventListener('click', (event) => {
            event.preventDefault();
            clear();
        });

        textInput.addEventListener('change', () => {
            const value = textInput.value.trim();
            if (!value) {
                clear({ silent: true });
                return;
            }

            if (value.startsWith('data:')) {
                useDataUrl(value, { label: 'Image intégrée depuis le champ.' });
            } else {
                useExternalPath(value);
            }
        });

        textInput.addEventListener('input', () => {
            if (textInput.value.trim()) {
                setAppImageState({ file: null, data: null });
            }
        });

        const updateFromValue = (value) => {
            if (!value) {
                clear();
                return;
            }

            if (typeof value === 'string' && value.startsWith('data:')) {
                useDataUrl(value, { label: 'Aperçu d\'une image intégrée.' });
            } else {
                const repositoryPath = normaliseToRepositoryPath(value);
                textInput.value = repositoryPath;
                useExternalPath(repositoryPath);
            }
        };

        return {
            updateFromValue,
            clear
        };
    }

    resetImageControllers(options = {}) {
        const { silent = true } = options;
        if (this.imageFieldControllers?.question?.clear) {
            this.imageFieldControllers.question.clear({ silent });
        }
        if (this.imageFieldControllers?.answer?.clear) {
            this.imageFieldControllers.answer.clear({ silent });
        }
        this.app.currentQuestionImageFile = null;
        this.app.currentAnswerImageFile = null;
        this.app.currentQuestionImageData = null;
        this.app.currentAnswerImageData = null;
    }

    renderBoxes(boxSummaries, { onSelectBox } = {}) {
        const boxesContainer = document.getElementById('leitner-boxes');
        if (!boxesContainer) {
            console.warn('Leitner boxes container not found in DOM.');
            return;
        }

        const existingBoxes = boxesContainer.querySelectorAll('.box');
        if (existingBoxes.length === 0) {
            boxesContainer.innerHTML = '';

            boxSummaries.forEach(summary => {
                const box = document.createElement('div');
                box.className = `box box-border-${summary.box} bg-white rounded-lg shadow-md p-4 text-center cursor-pointer hover:-translate-y-1 transition-transform`;
                box.dataset.boxNumber = summary.box;
                box.dataset.dueCount = summary.due ?? 0;

                const colorClass = `text-box${summary.box}`;

                box.innerHTML = `
                    <h2 class="text-xl font-bold mb-2 ${colorClass}">Boîte ${summary.box}</h2>
                    <div class="box-counter text-sm text-gray-600">0 carte(s)</div>
                    <div class="box-due text-xs text-amber-600 mt-1"></div>
                    <div class="box-next-review text-xs text-gray-400 mt-1"></div>
                `;

                box.addEventListener('click', () => {
                    if (typeof onSelectBox === 'function') {
                        onSelectBox(summary.box);
                    }
                });

                boxesContainer.appendChild(box);
            });

            this.boxClickHandler = onSelectBox;
        }

        this.updateBoxSummaries(boxSummaries);

        if (onSelectBox && onSelectBox !== this.boxClickHandler) {
            this.boxClickHandler = onSelectBox;
            boxesContainer.querySelectorAll('.box').forEach((element) => {
                element.replaceWith(element.cloneNode(true));
            });
            boxesContainer.querySelectorAll('.box').forEach((element) => {
                element.addEventListener('click', () => {
                    if (typeof this.boxClickHandler === 'function') {
                        this.boxClickHandler(Number(element.dataset.boxNumber));
                    }
                });
            });
        }
    }

    updateBoxSummaries(boxSummaries) {
        boxSummaries.forEach(summary => {
            const boxElement = document.querySelector(`.box[data-box-number="${summary.box}"]`);
            if (!boxElement) {
                return;
            }

            const counter = boxElement.querySelector('.box-counter');
            const dueIndicator = boxElement.querySelector('.box-due');
            const nextReview = boxElement.querySelector('.box-next-review');

            boxElement.dataset.boxNumber = summary.box;
            boxElement.dataset.dueCount = summary.due ?? 0;
            counter.textContent = `${summary.count} carte(s)`;
            if (dueIndicator) {
                dueIndicator.textContent = summary.due > 0
                    ? `${summary.due} prête(s)`
                    : '';
            }
            nextReview.textContent = summary.count > 0
                ? `Prochaine rev.: ${this.formatTime(summary.nextReview)}`
                : '';
        });
    }
    
    populateCSVSelector(csvFiles, { selectedName = null } = {}) {
        const selector = document.getElementById('csv-selector');

        if (!selector) {
            return;
        }

        selector.innerHTML = '';

        if (!Array.isArray(csvFiles) || csvFiles.length === 0) {
            const emptyOption = document.createElement('option');
            emptyOption.value = '';
            emptyOption.textContent = 'Aucun fichier .csv trouvé';
            emptyOption.disabled = true;
            selector.appendChild(emptyOption);
            selector.value = '';
            selector.dataset.hasFiles = 'false';
            selector.disabled = true;
            return;
        }

        selector.disabled = false;

        const preferredName = selectedName
            || (this.app?.currentCSV && csvFiles.some(file => file.name === this.app.currentCSV)
                ? this.app.currentCSV
                : null);

        csvFiles.forEach((file) => {
            const option = document.createElement('option');
            option.value = file.name;
            option.textContent = file.name;

            if (file.download_url) {
                option.dataset.downloadUrl = file.download_url;
            }
            if (file.publicPath) {
                option.dataset.publicPath = file.publicPath;
            }
            if (file.source) {
                option.dataset.source = file.source;
            }

            if (preferredName) {
                option.selected = file.name === preferredName;
            }

            selector.appendChild(option);
        });

        const fallbackName = preferredName && csvFiles.some(file => file.name === preferredName)
            ? preferredName
            : csvFiles[0].name;

        selector.value = fallbackName;
        selector.dataset.hasFiles = 'true';
    }
    
    showCardsList(boxNumber, cards = []) {
        this.app.currentBoxNumber = boxNumber;
        const cardsList = document.getElementById('cards-list');
        cardsList.innerHTML = '';

        if (!Array.isArray(cards) || cards.length === 0) {
            cardsList.innerHTML = '<p class="text-gray-500">Aucune carte</p>';
        } else {
            cards.forEach(card => {
                const cardElement = this.createCardElement(card);
                cardsList.appendChild(cardElement);
            });
        }

        document.getElementById('current-box-number').textContent = boxNumber;
        document.getElementById('cards-list-container').classList.remove('hidden');
        
        // Scroll to the list
        setTimeout(() => {
            document.getElementById('cards-list-container').scrollIntoView({ 
                behavior: 'smooth', 
                block: 'start' 
            });
        }, 100);
    }
    
    // Dans ui.js, modifiez la méthode createCardElement
    createCardElement(card) {
        const element = document.createElement('div');
        element.className = 'card-item flex items-start gap-3 p-3 hover:bg-gray-100 rounded-lg cursor-pointer';
        element.dataset.cardId = card.id;
        
        let thumbnailHtml = '';
        if (card.questionImage) {
            const imageUrl = this.app.github.getImageUrl(card.questionImage, 'question');
            thumbnailHtml = `
                <div class="thumbnail-container flex-shrink-0">
                    <img src="${imageUrl}" 
                        alt="Miniature" 
                        class="thumbnail-image w-12 h-12 object-cover rounded border border-gray-200"
                        onerror="this.style.display='none'">
                </div>
            `;
        }
        
        const displayText = card.question || (card.questionImage ? 'Carte avec image' : 'Carte sans texte');
        element.innerHTML = `
            ${thumbnailHtml}
            <div class="flex-1 min-w-0">
                <div class="text-sm font-medium text-gray-900 truncate">${displayText}</div>
                <div class="card-next-review text-xs text-gray-500 mt-1">
                    Rev.: ${this.formatTime(card.nextReview || this.app.getCardNextReview(card))}
                </div>
            </div>
        `;
        
        element.addEventListener('click', () => {
            this.showCardViewer(card);
        });
        
        return element;
    }
    
    // Dans ui.js, modifiez la méthode showCardViewer
    showCardViewer(card) {
        this.app.currentCard = card;
        
        document.getElementById('question-content').innerHTML = '';
        document.getElementById('answer-content').innerHTML = '';
        
        // Afficher la question
        if (card.question) {
            const textElement = document.createElement('div');
            textElement.textContent = card.question;
            document.getElementById('question-content').appendChild(textElement);
        }
        
        if (card.questionImage) {
            const imgElement = document.createElement('img');
            const imageUrl = this.app.github.getImageUrl(card.questionImage, 'question');
            imgElement.src = imageUrl;
            imgElement.alt = 'Image question';
            imgElement.className = 'mx-auto my-3 max-w-full max-h-[300px] w-auto h-auto object-scale-down';
            imgElement.onerror = "this.style.display='none'";
            document.getElementById('question-content').appendChild(imgElement);
        }
        
        // Préparer la réponse
        if (card.answer) {
            const textElement = document.createElement('div');
            textElement.textContent = card.answer;
            document.getElementById('answer-content').appendChild(textElement);
        }
        
        if (card.answerImage) {
            const imgElement = document.createElement('img');
            const imageUrl = this.app.github.getImageUrl(card.answerImage, 'answer');
            imgElement.src = imageUrl;
            imgElement.alt = 'Image réponse';
            imgElement.className = 'mx-auto my-3 max-w-full max-h-[300px] w-auto h-auto object-scale-down';
            imgElement.onerror = "this.style.display='none'";
            document.getElementById('answer-content').appendChild(imgElement);
        }

        document.getElementById('last-reviewed').textContent =
            `Dernière révision: ${new Date(card.lastReview).toLocaleString('fr-FR')}`;

        const difficultySelect = document.getElementById('answer-difficulty');
        if (difficultySelect) {
            difficultySelect.value = card.difficulty || this.app.userConfig.defaultDifficulty || 'normal';
        }

        document.getElementById('answer-section').classList.add('hidden');
        document.getElementById('show-answer-btn').style.display = 'block';
        const container = document.getElementById('flashcard-container');
        container.classList.remove('hidden');
        container.setAttribute('aria-hidden', 'false');

        if (typeof this.app?.persistSessionSnapshot === 'function') {
            this.app.persistSessionSnapshot();
        }
    }

    hideCardViewer() {
        const container = document.getElementById('flashcard-container');
        container.classList.add('hidden');
        container.setAttribute('aria-hidden', 'true');
        if (this.app) {
            this.app.currentCard = null;
            if (typeof this.app.persistSessionSnapshot === 'function') {
                this.app.persistSessionSnapshot();
            }
        }
    }

    // Dans ui.js, modifiez la méthode showCardEditor
    showCardEditor(card = null) {
        const form = document.getElementById('card-form');
        const title = document.getElementById('editor-title');
        const boxInput = document.getElementById('card-box');
        const lastReviewInput = document.getElementById('card-last-reviewed');

        const formatDateInputValue = (value) => {
            if (!value) {
                return '';
            }

            const source = value instanceof Date ? new Date(value.getTime()) : new Date(value);
            if (Number.isNaN(source.getTime())) {
                return '';
            }

            const year = source.getFullYear();
            const month = String(source.getMonth() + 1).padStart(2, '0');
            const day = String(source.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        };

        if (card) {
            title.textContent = 'Modifier la carte';
            document.getElementById('card-id').value = card.id;
            document.getElementById('card-question').value = card.question;
            document.getElementById('card-answer').value = card.answer;

            if (boxInput) {
                boxInput.value = Number.isFinite(Number(card.box)) ? String(card.box) : '1';
            }

            if (lastReviewInput) {
                lastReviewInput.value = formatDateInputValue(card.lastReview);
            }

            if (this.imageFieldControllers?.question) {
                this.imageFieldControllers.question.updateFromValue(card.questionImage || '');
            }
            if (this.imageFieldControllers?.answer) {
                this.imageFieldControllers.answer.updateFromValue(card.answerImage || '');
            }
        } else {
            title.textContent = 'Nouvelle carte';
            form.reset();
            document.getElementById('card-id').value = '';
            if (boxInput) {
                boxInput.value = '1';
            }
            if (lastReviewInput) {
                lastReviewInput.value = formatDateInputValue(new Date());
            }
            if (this.imageFieldControllers?.question) {
                this.imageFieldControllers.question.clear();
            }
            if (this.imageFieldControllers?.answer) {
                this.imageFieldControllers.answer.clear();
            }
        }
        
        const editor = document.getElementById('card-editor');
        editor.classList.remove('hidden');
        editor.setAttribute('aria-hidden', 'false');
        editor.querySelector('textarea, input, button')?.focus();
    }

    hideCardEditor() {
        const editor = document.getElementById('card-editor');
        editor.classList.add('hidden');
        editor.setAttribute('aria-hidden', 'true');
        this.resetImageControllers({ silent: true });
    }
    
    formatTime(timestamp) {
        if (!timestamp) return '';
        
        const now = Date.now();
        const date = new Date(timestamp);
        
        if (timestamp <= now) {
            return 'Maintenant';
        }
        
        const today = new Date();
        if (date.getDate() === today.getDate() && 
            date.getMonth() === today.getMonth() && 
            date.getFullYear() === today.getFullYear()) {
            return date.toLocaleTimeString('fr-FR', {hour: '2-digit', minute:'2-digit'});
        }
        
        return date.toLocaleString('fr-FR', {
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute:'2-digit'
        });
    }
    
    bindEvents() {
        // Fermer la liste des cartes
        document.getElementById('close-cards-list').addEventListener('click', () => {
            document.getElementById('cards-list-container').classList.add('hidden');
        });
        
        // Annuler l'édition
        document.getElementById('cancel-edit').addEventListener('click', () => {
            this.hideCardEditor();
        });
        
        // Bouton voir la réponse
        document.getElementById('show-answer-btn').addEventListener('click', () => {
            document.getElementById('answer-section').classList.remove('hidden');
            document.getElementById('show-answer-btn').style.display = 'none';
        });
        
        // Gestion des réponses
        document.getElementById('wrong-answer').addEventListener('click', () => {
            this.app.processAnswer(false);
        });
        
        document.getElementById('right-answer').addEventListener('click', () => {
            this.app.processAnswer(true);
        });
        
        // Boutons dans le visualisateur de carte
        document.getElementById('edit-card-btn').addEventListener('click', () => {
            this.hideCardViewer();
            this.showCardEditor(this.app.currentCard);
        });
        
        document.getElementById('delete-card-btn').addEventListener('click', () => {
            if (confirm('Êtes-vous sûr de vouloir supprimer cette carte?')) {
                this.app.crud.deleteCard(this.app.currentCard.id);
                this.hideCardViewer();
            }
        });
        
        // Sélection d'un fichier CSV
        const csvSelector = document.getElementById('csv-selector');
        if (csvSelector) {
            csvSelector.addEventListener('change', async (e) => {
                const selectedOption = e.target.options[e.target.selectedIndex];
                await this.loadSelectedCSV(selectedOption);
            });
        }
        
        // Lien Import/Export vers l'éditeur plein écran
        const importExportTrigger = document.getElementById('import-export-trigger');
        if (importExportTrigger && importExportTrigger.tagName !== 'A') {
            importExportTrigger.addEventListener('click', (event) => {
                event.preventDefault();
                window.open('inline-editor.html', '_blank', 'noopener');
            });
        }

        // Soumission du formulaire
        document.getElementById('card-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.app.crud.saveCard({
                id: document.getElementById('card-id').value,
                question: document.getElementById('card-question').value,
                questionImage: document.getElementById('card-question-image').value,
                answer: document.getElementById('card-answer').value,
                answerImage: document.getElementById('card-answer-image').value,
                box: document.getElementById('card-box')?.value,
                lastReview: document.getElementById('card-last-reviewed')?.value
            });
        });
        
        this.imageFieldControllers.question = this.setupImageField('question');
        this.imageFieldControllers.answer = this.setupImageField('answer');

        const difficultySelect = document.getElementById('answer-difficulty');
        if (difficultySelect) {
            difficultySelect.addEventListener('change', () => {
                this.app.onDifficultyChanged(difficultySelect.value);
            });
        }

        const saveDifficultiesButton = document.getElementById('save-difficulties');
        if (saveDifficultiesButton) {
            saveDifficultiesButton.addEventListener('click', () => {
                this.app.saveDifficulties();
            });
        }
    }

    registerKeyboardShortcuts() {
        if (!this.keyboardManager) {
            return;
        }

        const addButton = document.getElementById('add-card-btn');
        if (addButton) {
            this.keyboardManager.registerShortcut('ctrl+n', () => {
                addButton.click();
            }, {
                description: 'Ajouter une nouvelle carte',
                element: addButton
            });
        }

        const showAnswerButton = document.getElementById('show-answer-btn');
        if (showAnswerButton) {
            this.keyboardManager.registerShortcut('ctrl+shift+space', () => {
                const viewer = document.getElementById('flashcard-container');
                if (!viewer.classList.contains('hidden')) {
                    showAnswerButton.click();
                }
            }, {
                description: 'Afficher la réponse courante',
                element: showAnswerButton
            });
        }

        const closeViewerButton = document.getElementById('wrong-answer');
        if (closeViewerButton) {
            this.keyboardManager.registerShortcut('ctrl+shift+w', () => {
                const viewer = document.getElementById('flashcard-container');
                if (!viewer.classList.contains('hidden')) {
                    this.hideCardViewer();
                }
            }, {
                description: 'Fermer la carte affichée',
                element: closeViewerButton
            });
        }

        const csvSelector = document.getElementById('csv-selector');
        if (csvSelector) {
            this.keyboardManager.registerShortcut('ctrl+shift+l', () => {
                csvSelector.focus();
            }, {
                description: 'Focus sur la liste des CSV',
                element: csvSelector,
                global: true
            });
        }
    }

    applyUserConfig(config) {
        const curve = config?.curves?.[config.defaultCurve];
        if (curve && Array.isArray(curve)) {
            curve.forEach((value, index) => {
                const input = document.getElementById(`interval-${index + 1}`);
                if (input) {
                    input.value = value;
                }
            });
        }

        const difficultyFields = {
            easy: document.getElementById('difficulty-easy'),
            normal: document.getElementById('difficulty-normal'),
            hard: document.getElementById('difficulty-hard')
        };

        Object.entries(difficultyFields).forEach(([key, element]) => {
            if (element && config?.difficulties?.[key] !== undefined) {
                element.value = config.difficulties[key];
            }
        });

        const defaultDifficulty = document.getElementById('default-difficulty');
        if (defaultDifficulty && config?.defaultDifficulty) {
            defaultDifficulty.value = config.defaultDifficulty;
        }

        const answerDifficulty = document.getElementById('answer-difficulty');
        if (answerDifficulty && config?.defaultDifficulty) {
            answerDifficulty.value = config.defaultDifficulty;
        }
    }

    getSelectedDifficulty() {
        const select = document.getElementById('answer-difficulty');
        return select ? select.value : 'normal';
    }
}
