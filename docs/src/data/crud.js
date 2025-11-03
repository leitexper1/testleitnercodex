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

        const processImageUpload = async ({ file, inlineData, fallback }) => {
            if (inlineData) {
                return inlineData;
            }
            if (file) {
                try {
                    return await readFileAsDataURL(file);
                } catch (error) {
                    console.warn('Impossible de lire le fichier image sélectionné', error);
                }
            }
            return fallback || '';
        };

        const pendingImages = [
            processImageUpload({
                file: this.app.currentQuestionImageFile,
                inlineData: this.app.currentQuestionImageData,
                fallback: cardData.questionImage
            }),
            processImageUpload({
                file: this.app.currentAnswerImageFile,
                inlineData: this.app.currentAnswerImageData,
                fallback: cardData.answerImage
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
                const index = this.app.flashcards.findIndex(c => c.id == cardData.id);
                if (index !== -1) {
                    const existing = this.app.flashcards[index];
                    this.app.flashcards[index] = this.app.normaliseCard({
                        ...existing,
                        question: cardData.question,
                        questionImage: cardData.questionImage,
                        answer: cardData.answer,
                        answerImage: cardData.answerImage
                    });
                }
            } else {
                const newId = Date.now();
                const newCard = this.app.normaliseCard({
                    id: newId,
                    question: cardData.question,
                    questionImage: cardData.questionImage,
                    answer: cardData.answer,
                    answerImage: cardData.answerImage,
                    box: 1,
                    lastReview: Date.now(),
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
        
        // Données des cartes
        this.app.flashcards.forEach(card => {
            const row = [
                `"${card.question.replace(/"/g, '""')}"`,
                card.questionImage ? `"${this.app.github.simplifyImagePath(card.questionImage, 'question').replace(/"/g, '""')}"` : '',
                `"${card.answer.replace(/"/g, '""')}"`,
                card.answerImage ? `"${this.app.github.simplifyImagePath(card.answerImage, 'answer').replace(/"/g, '""')}"` : '',
                card.box,
                `"${new Date(card.lastReview).toISOString().split('T')[0]}"`
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