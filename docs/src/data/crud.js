export class CRUDManager {
    init(app) {
        this.app = app;
        this.storage = app.storage;
    }
    
    saveCard(cardData) {
        const readFileAsDataURL = (file) => new Promise((resolve, reject) => {
            if (!file) {
                resolve(null);
                return;
            }

            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
        });

        const normaliseImagePath = (value, imageType) => {
            if (!value) {
                return '';
            }
            const raw = typeof value === 'string' ? value.trim() : String(value).trim();
            if (!raw) {
                return '';
            }
            if (raw.startsWith('data:')) {
                return '';
            }
            if (this.app?.github?.ensureRepositoryImagePath) {
                return this.app.github.ensureRepositoryImagePath(raw, imageType);
            }
            const trimmed = raw.replace(/^(\.\/|\/)/, '');
            if (trimmed.startsWith('images_questions/') || trimmed.startsWith('images_reponses/')) {
                return trimmed;
            }
            const directory = imageType === 'answer' ? 'images_reponses' : 'images_questions';
            return `${directory}/${trimmed}`;
        };

        const processImageUpload = async ({ file, inlineData, fallback, type }) => {
            const repositoryPath = normaliseImagePath(fallback, type);
            if (repositoryPath) {
                return repositoryPath;
            }

            if (inlineData) {
                return inlineData;
            }

            if (file && this.app?.github) {
                return this.app.github.buildRelativeImagePath(file.name, type);
            }

            if (file) {
                try {
                    return await readFileAsDataURL(file);
                } catch (error) {
                    console.warn('Impossible de lire le fichier image sélectionné', error);
                }
            }

            return '';
        };

        const resolvedBox = Number.isFinite(Number(cardData.box))
            ? Math.max(1, Math.trunc(Number(cardData.box)))
            : 1;

        const existingCard = cardData.id
            ? this.app.flashcards.find(c => c.id == cardData.id)
            : null;

        const formatDateForInput = (value) => {
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

        const mergeWithExistingTime = (timestamp) => {
            if (!existingCard || !existingCard.lastReview) {
                return timestamp;
            }

            const reference = new Date(existingCard.lastReview);
            if (Number.isNaN(reference.getTime())) {
                return timestamp;
            }

            const merged = new Date(timestamp);
            merged.setHours(
                reference.getHours(),
                reference.getMinutes(),
                reference.getSeconds(),
                reference.getMilliseconds()
            );
            return merged.getTime();
        };

        const resolvedLastReview = (() => {
            const rawLastReview = typeof cardData.lastReview === 'string'
                ? cardData.lastReview.trim()
                : '';
            const hasInputValue = rawLastReview !== '';
            const parsed = hasInputValue ? Date.parse(rawLastReview) : NaN;

            if (existingCard) {
                const existingInputValue = formatDateForInput(existingCard.lastReview);
                if (hasInputValue && rawLastReview === existingInputValue) {
                    return existingCard.lastReview;
                }

                if (Number.isFinite(parsed)) {
                    return mergeWithExistingTime(parsed);
                }

                if (existingCard.lastReview) {
                    return existingCard.lastReview;
                }
            } else if (Number.isFinite(parsed)) {
                return parsed;
            }

            return Date.now();
        })();

        const pendingImages = [
            processImageUpload({
                file: this.app.currentQuestionImageFile,
                inlineData: this.app.currentQuestionImageData,
                fallback: cardData.questionImage,
                type: 'question'
            }),
            processImageUpload({
                file: this.app.currentAnswerImageFile,
                inlineData: this.app.currentAnswerImageData,
                fallback: cardData.answerImage,
                type: 'answer'
            })
        ];

        Promise.all(pendingImages).then(([questionImage, answerImage]) => {
            cardData.questionImage = questionImage;
            cardData.answerImage = answerImage;

            this.app.currentQuestionImageFile = null;
            this.app.currentAnswerImageFile = null;
            this.app.currentQuestionImageData = null;
            this.app.currentAnswerImageData = null;

            if (cardData.id) {
                const targetIndex = this.app.flashcards.findIndex(c => c.id == cardData.id);
                if (targetIndex !== -1) {
                    const existing = this.app.flashcards[targetIndex];
                    this.app.flashcards[targetIndex] = this.app.normaliseCard({
                        ...existing,
                        question: cardData.question,
                        questionImage: cardData.questionImage,
                        answer: cardData.answer,
                        answerImage: cardData.answerImage,
                        box: resolvedBox,
                        lastReview: resolvedLastReview
                    });
                } else {
                    const newId = Date.now();
                    const newCard = this.app.normaliseCard({
                        id: newId,
                        question: cardData.question,
                        questionImage: cardData.questionImage,
                        answer: cardData.answer,
                        answerImage: cardData.answerImage,
                        box: resolvedBox,
                        lastReview: resolvedLastReview,
                        difficulty: this.app.userConfig.defaultDifficulty
                    });
                    this.app.flashcards.push(newCard);
                }
            } else {
                const newId = Date.now();
                const newCard = this.app.normaliseCard({
                    id: newId,
                    question: cardData.question,
                    questionImage: cardData.questionImage,
                    answer: cardData.answer,
                    answerImage: cardData.answerImage,
                    box: resolvedBox,
                    lastReview: resolvedLastReview,
                    difficulty: this.app.userConfig.defaultDifficulty
                });
                this.app.flashcards.push(newCard);
            }

            this.app.saveFlashcards();
            this.app.ui.hideCardEditor();
            this.app.onCardUpdated();
        }).catch((error) => {
            console.error('Échec lors du traitement des images de la carte', error);
            alert('Impossible de charger l\'image sélectionnée. Veuillez réessayer ou choisir un autre fichier.');
        });
    }
    deleteCard(cardId) {
        const index = this.app.flashcards.findIndex(c => c.id == cardId);
        if (index !== -1) {
            this.app.flashcards.splice(index, 1);
            this.app.saveFlashcards();
            this.app.ui.hideCardViewer();
            this.app.onCardUpdated();
        }
    }

    loadFlashcards(csvName) {
        const saved = this.storage.getJSON(`leitnerFlashcards_${csvName}`, null);
        if (Array.isArray(saved)) {
            this.app.flashcards = saved.map(card => this.app.normaliseCard(card));
            this.app.setCurrentCSV(csvName);
            this.app.updateBoxes();
            return true;
        }

        this.app.flashcards = [];
        return false;
    }
    
    saveCSVList() {
        const csvList = [];
        const selector = document.getElementById('csv-selector');
        
        for (let i = 1; i < selector.options.length; i++) {
            csvList.push(selector.options[i].value);
        }
        
        this.storage.setJSON('leitnerCSVList', csvList);
    }
    
    exportToCSV() {
        if (this.app.flashcards.length === 0) {
            alert('Aucune carte à exporter!');
            return;
        }
        
        // Entête CSV selon le format demandé
        let csvContent = "question_content,question_content_image,answer_content,answer_content_image,box_number,last_reviewed\n";
        
        const escapeValue = (text = '') => `"${String(text).replace(/"/g, '""')}"`;
        const formatImageValue = (value, type) => {
            if (!value) {
                return '';
            }

            const simplify = this.app.github?.simplifyImagePath
                ? this.app.github.simplifyImagePath(value, type)
                : value;

            return (simplify || '').replace(/^images_(?:questions|reponses)\//, '');
        };
        const formatLastReview = (value) => {
            if (!value) {
                return '';
            }
            const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
            if (Number.isNaN(date.getTime())) {
                return '';
            }
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        };

        // Données des cartes
        this.app.flashcards.forEach(card => {
            const row = [
                escapeValue(card.question || ''),
                escapeValue(formatImageValue(card.questionImage, 'question')),
                escapeValue(card.answer || ''),
                escapeValue(formatImageValue(card.answerImage, 'answer')),
                escapeValue(Number.isFinite(Number(card.box)) ? String(Math.trunc(Number(card.box))) : '1'),
                escapeValue(formatLastReview(card.lastReview))
            ];
            csvContent += row.join(',') + '\n';
        });
        
        // Créer un blob et un lien de téléchargement
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `${this.app.currentCSV}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
    
    importFromCSV(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const csvContent = e.target.result;
                this.app.parseAndLoadCSV(csvContent, file.name);
            } catch (error) {
                alert('Erreur lors de l\'importation: ' + error.message);
            }
        };
        reader.readAsText(file);
    }
}