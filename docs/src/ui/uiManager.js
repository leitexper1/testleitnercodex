export class UIManager {
    init(app) {
        this.app = app;
        this.boxClickHandler = null;
        this.keyboardManager = app?.keyboardManager || null;
        this.imageFieldControllers = {};
        this.bindEvents();
        this.registerKeyboardShortcuts();
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
            setStatus(label);
            setAppImageState({ file: null, data: dataUrl });
        };

        const useExternalPath = (value) => {
            const trimmed = value.trim();
            if (!trimmed) {
                clear({ silent: true });
                return;
            }

            const resolvedUrl = this.app.github.getImageUrl(trimmed, type);
            showPreview(resolvedUrl);
            setStatus('Chemin personnalisé appliqué.');
            setAppImageState({ file: null, data: null });
        };

        const handleFileSelection = async (file, originLabel) => {
            if (!file) {
                return;
            }
            try {
                const dataUrl = await this.readFileAsDataURL(file);
                showPreview(dataUrl);
                textInput.value = file.name;
                const origin = originLabel || 'importée';
                setStatus(`Image ${origin} et prête à être sauvegardée.`);
                setAppImageState({ file, data: dataUrl });
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
                useDataUrl(value, { label: 'Image intégrée (collée ou importée).' });
            } else {
                const simplified = this.app.github.simplifyImagePath(value, type);
                textInput.value = simplified;
                useExternalPath(simplified);
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

        // Garder l'option par défaut
        selector.innerHTML = '<option value="default">Sélectionner un fichier CSV</option>';

        // Ajouter les fichiers CSV du dépôt GitHub
        csvFiles.forEach((file, index) => {
            const option = document.createElement('option');
            option.value = file.name;
            option.textContent = file.name;
            if (file.download_url) {
                option.dataset.downloadUrl = file.download_url;
            }

            if (selectedName) {
                option.selected = file.name === selectedName;
            } else if (index === 0) {
                option.selected = true;
            }
            selector.appendChild(option);
        });

        if (selectedName) {
            selector.value = selectedName;
        } else if (csvFiles.length > 0) {
            selector.value = csvFiles[0].name;
        }
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
    }

    hideCardViewer() {
        const container = document.getElementById('flashcard-container');
        container.classList.add('hidden');
        container.setAttribute('aria-hidden', 'true');
    }
    
    // Dans ui.js, modifiez la méthode showCardEditor
    showCardEditor(card = null) {
        const form = document.getElementById('card-form');
        const title = document.getElementById('editor-title');
        
        if (card) {
            title.textContent = 'Modifier la carte';
            document.getElementById('card-id').value = card.id;
            document.getElementById('card-question').value = card.question;
            document.getElementById('card-answer').value = card.answer;

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
        document.getElementById('csv-selector').addEventListener('change', (e) => {
            const selectedOption = e.target.options[e.target.selectedIndex];
            if (selectedOption.dataset.downloadUrl) {
                if (confirm(`Voulez-vous charger le fichier ${selectedOption.value} depuis GitHub?`)) {
                    this.app.loadCSVFromURL(selectedOption.dataset.downloadUrl, selectedOption.value);
                }
            }
        });
        
        // Bouton nouvelle carte
        document.getElementById('add-card-btn').addEventListener('click', () => {
            if (this.app.currentCSV === 'default') {
                alert('Veuillez d\'abord sélectionner ou créer un fichier CSV');
                return;
            }
            this.showCardEditor();
        });
        
        // Soumission du formulaire
        document.getElementById('card-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.app.crud.saveCard({
                id: document.getElementById('card-id').value,
                question: document.getElementById('card-question').value,
                questionImage: document.getElementById('card-question-image').value,
                answer: document.getElementById('card-answer').value,
                answerImage: document.getElementById('card-answer-image').value
            });
        });
        
        // Charger un CSV
        document.getElementById('load-csv').addEventListener('click', () => {
            const selectedCSV = document.getElementById('csv-selector').value;
            if (selectedCSV && selectedCSV !== 'default') {
                if (this.app.crud.loadFlashcards(selectedCSV)) {
                    alert(`Fichier "${selectedCSV}" chargé avec ${this.app.flashcards.length} cartes`);
                } else {
                    alert(`Création d'un nouveau fichier "${selectedCSV}"`);
                    this.app.setCurrentCSV(selectedCSV);
                    this.app.flashcards = [];
                    this.app.saveFlashcards();
                }
            } else {
                alert('Veuillez sélectionner un fichier CSV');
            }
        });
        
        // Créer un nouveau CSV
        document.getElementById('create-csv').addEventListener('click', () => {
            document.getElementById('new-csv-form').classList.remove('hidden');
        });
        
        // Sauvegarder un nouveau CSV
        document.getElementById('save-new-csv').addEventListener('click', () => {
            const newName = document.getElementById('new-csv-name').value.trim();
            if (newName) {
                const csvName = newName.endsWith('.csv') ? newName : `${newName}.csv`;
                
                // Ajouter au sélecteur
                const selector = document.getElementById('csv-selector');
                const option = document.createElement('option');
                option.value = csvName;
                option.textContent = csvName;
                selector.appendChild(option);
                selector.value = csvName;
                
                // Sauvegarder la liste
                this.app.crud.saveCSVList();
                
                // Cacher le formulaire
                document.getElementById('new-csv-form').classList.add('hidden');
                document.getElementById('new-csv-name').value = '';
                
                // Charger le nouveau CSV
                this.app.setCurrentCSV(csvName);
                this.app.flashcards = [];
                this.app.saveFlashcards();
                
                alert(`Fichier "${csvName}" créé avec succès!`);
            } else {
                alert('Veuillez entrer un nom valide');
            }
        });
        
        // Exporter en CSV
        document.getElementById('download-csv').addEventListener('click', () => {
            if (this.app.currentCSV === 'default') {
                alert('Veuillez d\'abord sélectionner ou créer un fichier CSV');
                return;
            }
            this.app.crud.exportToCSV();
        });
        
        // Importer un CSV
        document.getElementById('import-csv').addEventListener('click', () => {
            document.getElementById('csv-file').click();
        });
        
        document.getElementById('csv-file').addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                // Demander le nom du fichier
                const fileName = prompt('Entrez un nom pour ce fichier CSV:', 
                    e.target.files[0].name.endsWith('.csv') 
                        ? e.target.files[0].name 
                        : `${e.target.files[0].name}.csv`);
                
                if (fileName) {
                    // Ajouter au sélecteur
                    const selector = document.getElementById('csv-selector');
                    const option = document.createElement('option');
                    option.value = fileName;
                    option.textContent = fileName;
                    selector.appendChild(option);
                    selector.value = fileName;
                    
                    // Sauvegarder la liste
                    this.app.crud.saveCSVList();
                    
                    // Importer les données
                    this.app.crud.importFromCSV(e.target.files[0]);
                }
            }
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
