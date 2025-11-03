import { GitHubManager } from '../data/github.js';
import { UIManager } from '../ui/uiManager.js';
import { CRUDManager } from '../data/crud.js';
import { LeitnerEngine } from './leitnerEngine.js';
import { HistoryService } from './historyService.js';
import { StorageService } from '../data/storageService.js';

const USER_CONFIG_KEY = 'leitnerUserConfig';
const LAST_CSV_KEY = 'leitnerLastCSV';
const DEFAULT_USER_CONFIG = {
    curves: {
        standard: [...LeitnerEngine.DEFAULT_CURVE]
    },
    defaultCurve: 'standard',
    difficulties: {
        easy: LeitnerEngine.DEFAULT_DIFFICULTIES.easy,
        normal: LeitnerEngine.DEFAULT_DIFFICULTIES.normal,
        hard: LeitnerEngine.DEFAULT_DIFFICULTIES.hard
    },
    defaultDifficulty: 'normal'
};

export class LeitnerApp {
    constructor(options = {}) {
        this.github = new GitHubManager();
        this.ui = new UIManager();
        this.crud = new CRUDManager();

        this.storage = new StorageService();
        this.history = new HistoryService(this.storage);

        this.keyboardManager = options.keyboardManager || null;

        this.tabRouter = options.tabRouter || null;

        this.flashcards = [];
        this.currentCSV = 'default';
        this.currentCard = null;
        this.currentBoxNumber = 1;
        this.currentDifficulty = null;

        this.reviewIntervals = [...LeitnerEngine.DEFAULT_CURVE];
        this.userConfig = { ...DEFAULT_USER_CONFIG };
        this.nextReviewCard = null;

        this.currentQuestionImageFile = null;
        this.currentAnswerImageFile = null;
        this.currentQuestionImageData = null;
        this.currentAnswerImageData = null;

        this.handleBoxSelection = this.handleBoxSelection.bind(this);

        this.init();
    }

    async init() {
        this.loadConfig();
        this.userConfig = this.loadUserConfig();
        this.reviewIntervals = [...this.getActiveCurve()];

        this.ui.init(this);
        this.crud.init(this);
        this.ui.applyUserConfig(this.userConfig);

        this.bootstrapFromCache();
        await this.loadCSVFromGitHub();
        this.refreshBoxes();
        this.bindEvents();
        this.setupGitHubGuidePlaceholders();

        this.history.startSession({ mode: 'review' });

        if (typeof window !== 'undefined') {
            window.addEventListener('beforeunload', () => {
                this.history.endSession({ reason: 'page-unload' });
            });
        }

        this.emit('leitner:app-ready', { flashcards: this.flashcards });
    }

    emit(eventName, detail = {}) {
        if (typeof window !== 'undefined' && window.dispatchEvent) {
            window.dispatchEvent(new CustomEvent(eventName, { detail }));
        }
    }

    loadConfig() {
        const defaultConfig = {
            repoOwner: 'leitexper1',
            repoName: 'leitexp',
            repoPath: 'docs/',
            githubToken: ''
        };

        const savedConfig = this.storage.getJSON('leitnerConfig', {});
        const config = { ...defaultConfig, ...savedConfig };

        document.getElementById('repo-owner').value = config.repoOwner;
        document.getElementById('repo-name').value = config.repoName;
        document.getElementById('repo-path').value = config.repoPath;
        document.getElementById('github-token').value = config.githubToken;

        this.storage.setJSON('leitnerConfig', config);
        this.github.setConfig(config);
    }

    saveConfig() {
        const config = {
            repoOwner: document.getElementById('repo-owner').value || 'leitexper1',
            repoName: document.getElementById('repo-name').value || 'leitexp',
            repoPath: document.getElementById('repo-path').value || 'docs/',
            githubToken: document.getElementById('github-token').value || ''
        };

        this.storage.setJSON('leitnerConfig', config);
        this.github.setConfig(config);
    }

    loadUserConfig() {
        const stored = this.storage.getJSON(USER_CONFIG_KEY, {});
        const merged = {
            ...DEFAULT_USER_CONFIG,
            ...stored,
            curves: {
                ...DEFAULT_USER_CONFIG.curves,
                ...(stored.curves || {})
            },
            difficulties: {
                ...DEFAULT_USER_CONFIG.difficulties,
                ...(stored.difficulties || {})
            }
        };

        const legacyIntervals = this.storage.getJSON('leitnerIntervals', null);
        if (Array.isArray(legacyIntervals) && legacyIntervals.length === DEFAULT_USER_CONFIG.curves.standard.length) {
            merged.curves[merged.defaultCurve] = legacyIntervals;
        }

        this.storage.setJSON(USER_CONFIG_KEY, merged);
        return merged;
    }

    persistUserConfig() {
        this.storage.setJSON(USER_CONFIG_KEY, this.userConfig);
    }

    getActiveCurve() {
        const curve = this.userConfig?.curves?.[this.userConfig.defaultCurve];
        return Array.isArray(curve) ? [...curve] : [...LeitnerEngine.DEFAULT_CURVE];
    }

    loadIntervals() {
        this.reviewIntervals = [...this.getActiveCurve()];
        this.ui.applyUserConfig(this.userConfig);
    }

    saveIntervals() {
        const intervalCount = this.getActiveCurve().length;
        const newIntervals = [];
        for (let i = 1; i <= intervalCount; i++) {
            const value = parseInt(document.getElementById(`interval-${i}`).value, 10);
            newIntervals.push(Number.isFinite(value) && value > 0 ? value : 1);
        }

        this.reviewIntervals = newIntervals;
        this.userConfig.curves[this.userConfig.defaultCurve] = [...newIntervals];
        this.persistUserConfig();
        this.storage.setJSON('leitnerIntervals', newIntervals);

        this.refreshBoxes();
        alert('Intervalles sauvegardés avec succès!');
    }

    saveDifficulties() {
        const easy = parseFloat(document.getElementById('difficulty-easy').value) || LeitnerEngine.DEFAULT_DIFFICULTIES.easy;
        const normal = parseFloat(document.getElementById('difficulty-normal').value) || LeitnerEngine.DEFAULT_DIFFICULTIES.normal;
        const hard = parseFloat(document.getElementById('difficulty-hard').value) || LeitnerEngine.DEFAULT_DIFFICULTIES.hard;
        const defaultDifficulty = document.getElementById('default-difficulty').value || 'normal';

        this.userConfig.difficulties = {
            easy: Math.max(0.1, easy),
            normal: Math.max(0.1, normal),
            hard: Math.max(0.1, hard)
        };
        this.userConfig.defaultDifficulty = defaultDifficulty;

        this.persistUserConfig();
        this.ui.applyUserConfig(this.userConfig);

        alert('Difficultés mises à jour avec succès!');
    }

    onDifficultyChanged(value) {
        this.currentDifficulty = value;
    }

    setCurrentCSV(csvName = 'default') {
        this.currentCSV = csvName || 'default';

        if (this.currentCSV === 'default') {
            this.storage.removeItem(LAST_CSV_KEY);
        } else {
            this.storage.setItem(LAST_CSV_KEY, this.currentCSV);
        }
    }

    getPreferredCSVName(defaultName = null) {
        const stored = this.storage.getItem(LAST_CSV_KEY);
        if (stored && typeof stored === 'string') {
            return stored;
        }
        return defaultName;
    }

    bootstrapFromCache() {
        const csvNames = this.storage.getJSON('leitnerCSVList', []);

        if (!Array.isArray(csvNames) || csvNames.length === 0) {
            this.ui.populateCSVSelector([]);
            return;
        }

        const offlineFiles = csvNames.map(name => ({ name }));
        this.github.csvFiles = offlineFiles;

        const preferredName = this.getPreferredCSVName(csvNames[0]);
        const selectedName = csvNames.includes(preferredName) ? preferredName : csvNames[0];
        this.ui.populateCSVSelector(offlineFiles, { selectedName });

        if (this.crud.loadFlashcards(selectedName)) {
            return;
        }

        this.setCurrentCSV(selectedName);
        this.flashcards = [];
        this.refreshBoxes();
    }

    async loadCSVFromGitHub() {
        try {
            await this.github.loadCSVList();
            const csvFiles = this.github.csvFiles;
            const csvNames = csvFiles.map(file => file.name);
            this.storage.setJSON('leitnerCSVList', csvNames);

            if (csvFiles.length === 0) {
                this.ui.populateCSVSelector([]);
                return;
            }

            const preferredName = this.getPreferredCSVName(csvFiles[0].name);
            const preferredFile = csvFiles.find(file => file.name === preferredName) || csvFiles[0];

            this.ui.populateCSVSelector(csvFiles, { selectedName: preferredFile.name });

            if (preferredFile.download_url) {
                await this.loadCSVFromURL(preferredFile.download_url, preferredFile.name);
            }
        } catch (error) {
            console.error('Erreur de chargement depuis GitHub:', error);
            this.loadCSVFromCache();
        }
    }

    loadCSVFromCache() {
        this.bootstrapFromCache();
        const csvNames = this.storage.getJSON('leitnerCSVList', []);

        if (!Array.isArray(csvNames) || csvNames.length === 0) {
            this.ui.populateCSVSelector([]);
            return;
        }

        const offlineFiles = csvNames.map(name => ({ name }));
        this.github.csvFiles = offlineFiles;

        const preferredName = this.getPreferredCSVName(csvNames[0]);
        const selectedName = csvNames.includes(preferredName) ? preferredName : csvNames[0];
        this.ui.populateCSVSelector(offlineFiles, { selectedName });

        if (this.crud.loadFlashcards(selectedName)) {
            return;
        }

        this.setCurrentCSV(selectedName);
        this.flashcards = [];
        this.refreshBoxes();
    }

    async loadCSVFromURL(url, csvName) {
        try {
            const csvContent = await this.github.loadCSVContent(url);
            this.parseAndLoadCSV(csvContent, csvName);
        } catch (error) {
            console.error('Erreur de chargement du CSV:', error);
            alert('Erreur de chargement: ' + error.message);
        }
    }

    parseAndLoadCSV(csvContent, csvName) {
        const importedCards = this.github.parseCSV(csvContent);

        if (importedCards.length > 0) {
            importedCards.forEach(card => {
                if (card.questionImage) {
                    card.questionImage = this.github.getImageUrl(card.questionImage, 'question');
                }
                if (card.answerImage) {
                    card.answerImage = this.github.getImageUrl(card.answerImage, 'answer');
                }
            });

            this.flashcards = importedCards.map(card => this.normaliseCard({
                ...card,
                id: card.id || Math.floor(Date.now() + Math.random() * 1000),
                box: card.box || 1,
                lastReview: card.lastReview || Date.now(),
                difficulty: card.difficulty || this.userConfig.defaultDifficulty
            }));
            this.setCurrentCSV(csvName);
            this.saveFlashcards();

            alert(`${importedCards.length} cartes chargées depuis ${csvName}`);
        } else {
            alert('Aucune carte valide trouvée dans le fichier CSV');
        }
    }

    refreshBoxes() {
        const now = Date.now();
        const context = this.getEngineContext(now);
        const summaries = LeitnerEngine.summariseBoxes(this.flashcards, context);
        const nextCard = this.getNextCardForReview(now, context);
        this.nextReviewCard = nextCard;

        this.ui.renderBoxes(summaries, {
            onSelectBox: this.handleBoxSelection
        });

        this.emit('leitner:next-card', { card: nextCard, csv: this.currentCSV });
    }

    updateBoxes() {
        this.refreshBoxes();
    }

    handleBoxSelection(boxNumber) {
        this.ui.showCardsList(boxNumber, this.getCardsForBox(boxNumber));
    }

    getCardNextReview(card, now = Date.now()) {
        const context = this.getEngineContext(now);
        if (card?.nextReview && Number.isFinite(Number(card.nextReview))) {
            return Number(card.nextReview);
        }
        return LeitnerEngine.computeCardNextReview(
            card,
            context.curve,
            context.difficulties,
            context.now
        );
    }

    getEngineContext(now = Date.now()) {
        return {
            curve: this.getActiveCurve(),
            difficulties: this.userConfig.difficulties,
            defaultDifficulty: this.userConfig.defaultDifficulty,
            now
        };
    }

    getCardsForBox(boxNumber, now = Date.now(), context = null) {
        const engineContext = context || this.getEngineContext(now);
        return LeitnerEngine.getCardsForBox(this.flashcards, boxNumber, engineContext);
    }

    getNextCardForReview(now = Date.now(), context = null) {
        const engineContext = context || this.getEngineContext(now);
        return LeitnerEngine.selectNextCard(this.flashcards, engineContext);
    }

    normaliseCard(card, now = Date.now()) {
        return LeitnerEngine.normaliseCard(card, this.getEngineContext(now));
    }

    saveFlashcards() {
        const now = Date.now();
        const normalized = this.flashcards.map(card => this.normaliseCard(card, now));
        this.flashcards = normalized;

        if (this.currentCSV && this.currentCSV !== 'default') {
            this.storage.setJSON(`leitnerFlashcards_${this.currentCSV}`, normalized);
        }

        this.refreshBoxes();
        this.emit('leitner:cards-updated', {
            cards: this.flashcards,
            csv: this.currentCSV,
            nextCard: this.nextReviewCard
        });
    }

    processAnswer(isCorrect) {
        if (!this.currentCard) return;

        const originalCard = this.currentCard;
        const difficulty = this.currentDifficulty || this.ui.getSelectedDifficulty() || this.userConfig.defaultDifficulty;
        const updatedCard = LeitnerEngine.evaluateAnswer(originalCard, {
            isCorrect,
            difficulty,
            curve: this.getActiveCurve(),
            difficulties: this.userConfig.difficulties,
            now: Date.now()
        });

        const normalizedCard = this.normaliseCard(updatedCard);
        const index = this.flashcards.findIndex(c => c.id === normalizedCard.id);
        if (index !== -1) {
            this.flashcards[index] = normalizedCard;
            this.currentCard = normalizedCard;
        }

        this.saveFlashcards();
        this.ui.hideCardViewer();

        this.history.recordReview({
            cardId: normalizedCard.id,
            isCorrect,
            difficulty,
            fromBox: originalCard.box,
            toBox: normalizedCard.box,
            nextReview: normalizedCard.nextReview
        });

        if (!document.getElementById('cards-list-container').classList.contains('hidden')) {
            this.ui.showCardsList(this.currentBoxNumber, this.getCardsForBox(this.currentBoxNumber));
        }

        this.currentDifficulty = null;
    }

    onCardUpdated() {
        if (!document.getElementById('cards-list-container').classList.contains('hidden')) {
            this.ui.showCardsList(this.currentBoxNumber, this.getCardsForBox(this.currentBoxNumber));
        }
        this.emit('leitner:cards-updated', {
            cards: this.flashcards,
            csv: this.currentCSV,
            nextCard: this.nextReviewCard
        });
    }

    resetAllData() {
        if (confirm('Êtes-vous sûr de vouloir réinitialiser toutes les données? Cette action est irréversible.')) {
            this.storage.clear();
            this.flashcards = [];
            this.setCurrentCSV('default');
            this.userConfig = this.loadUserConfig();
            this.reviewIntervals = [...this.getActiveCurve()];
            this.ui.applyUserConfig(this.userConfig);
            this.loadConfig();
            this.refreshBoxes();

            this.history.endSession({ reason: 'reset' });
            this.history.startSession({ mode: 'review' });

            alert('Toutes les données ont été réinitialisées.');
            this.emit('leitner:cards-updated', {
                cards: this.flashcards,
                csv: this.currentCSV,
                nextCard: this.nextReviewCard
            });
        }
    }

    exportAllData() {
        const allData = {};

        allData.config = this.storage.getJSON('leitnerConfig', {});
        allData.userConfig = this.storage.getJSON(USER_CONFIG_KEY, DEFAULT_USER_CONFIG);
        allData.intervals = allData.userConfig.curves?.[allData.userConfig.defaultCurve] || this.reviewIntervals;
        allData.csvList = this.storage.getJSON('leitnerCSVList', []);
        allData.history = this.history.getSessions();

        allData.flashcards = {};
        allData.csvList.forEach(csv => {
            const saved = this.storage.getJSON(`leitnerFlashcards_${csv}`, null);
            if (saved) {
                allData.flashcards[csv] = saved;
            }
        });

        const blob = new Blob([JSON.stringify(allData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `leitner-backup-${new Date().toISOString().split('T')[0]}.json`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    bindEvents() {
        document.getElementById('admin-button').addEventListener('click', () => {
            const panel = document.getElementById('admin-panel');
            panel.classList.remove('hidden');
            panel.setAttribute('aria-hidden', 'false');
            panel.focus();
        });

        document.getElementById('close-admin').addEventListener('click', () => {
            const panel = document.getElementById('admin-panel');
            panel.classList.add('hidden');
            panel.setAttribute('aria-hidden', 'true');
            document.getElementById('admin-button').focus();
        });

        document.getElementById('save-intervals').addEventListener('click', () => {
            this.saveIntervals();
        });

        document.getElementById('reset-all').addEventListener('click', () => {
            this.resetAllData();
        });

        document.getElementById('export-all').addEventListener('click', () => {
            this.exportAllData();
        });

        document.getElementById('load-github-csv').addEventListener('click', () => {
            this.loadCSVFromGitHub();
        });

        const githubGuideModal = document.getElementById('github-guide-modal');
        const openGithubGuide = document.getElementById('open-github-guide');
        const beginnerGithubGuide = document.getElementById('beginner-guide-btn');
        const closeGithubGuide = document.getElementById('close-github-guide');
        let lastGithubGuideTrigger = null;
        const closeGithubGuide = document.getElementById('close-github-guide');

        const hideGithubGuide = () => {
            if (!githubGuideModal) {
                return;
            }
            githubGuideModal.classList.add('hidden');
            githubGuideModal.setAttribute('aria-hidden', 'true');
            (lastGithubGuideTrigger || openGithubGuide || beginnerGithubGuide)?.focus();
            openGithubGuide?.focus();
        };

        const showGithubGuide = () => {
            if (!githubGuideModal) {
                return;
            }
            this.setupGitHubGuidePlaceholders();
            githubGuideModal.classList.remove('hidden');
            githubGuideModal.setAttribute('aria-hidden', 'false');
            closeGithubGuide?.focus();
        };

        openGithubGuide?.addEventListener('click', (event) => {
            event.preventDefault();
            this.saveConfig();
            lastGithubGuideTrigger = event.currentTarget;
            showGithubGuide();
        });

        beginnerGithubGuide?.addEventListener('click', (event) => {
            event.preventDefault();
            this.saveConfig();
            lastGithubGuideTrigger = event.currentTarget;
            showGithubGuide();
        });

        closeGithubGuide?.addEventListener('click', (event) => {
            event.preventDefault();
            hideGithubGuide();
        });

        githubGuideModal?.addEventListener('click', (event) => {
            if (event.target === githubGuideModal) {
                hideGithubGuide();
            }
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && githubGuideModal && !githubGuideModal.classList.contains('hidden')) {
                hideGithubGuide();
            }
        });
    }

    setupGitHubGuidePlaceholders() {
        const wrappers = document.querySelectorAll('[data-guide-image]');
        if (!wrappers.length) {
            return;
        }

        wrappers.forEach((wrapper) => {
            const imagePath = wrapper.dataset.guideImage;
            const altText = wrapper.dataset.guideAlt || '';
            const label = wrapper.dataset.guideLabel || imagePath || 'capture-guide.png';

            if (!imagePath) {
                wrapper.classList.add('github-guide__placeholder');
                wrapper.innerHTML = `<span>Ajoutez votre capture dans <code>${label}</code>.</span>`;
                return;
            }

            const image = new Image();
            image.alt = altText;
            image.className = 'github-guide__image';
            image.onload = () => {
                wrapper.classList.remove('github-guide__placeholder');
                wrapper.innerHTML = '';
                wrapper.appendChild(image);
            };
            image.onerror = () => {
                wrapper.classList.add('github-guide__placeholder');
                wrapper.innerHTML = [
                    `<span>Capture manquante&nbsp;: placez un fichier nommé <code>${label}</code></span>`,
                    `<span>Dans le dossier <code>docs/${imagePath}</code> pour l'afficher ici.</span>`
                ].join('');
            };
            image.src = imagePath;
        });
    }
}

// Bootstrap remains handled in src/main.js.
