export class GitHubManager {
    constructor() {
        this.config = {
            repoOwner: 'leitexper1',
            repoName: 'leitexp',
            repoPath: 'docs/',
            repoBranch: 'main',
            githubToken: ''
        };
        this.csvFiles = [];
    }

    setConfig(config) {
        this.config = { ...this.config, ...config };
    }

    normaliseRepoPath(path) {
        if (!path) {
            return '';
        }
        const trimmed = path
            .trim()
            .replace(/\\/g, '/')
            .replace(/\/{2,}/g, '/');
        if (!trimmed) {
            return '';
        }
        const withoutLeading = trimmed.replace(/^\/+/, '');
        const withoutTrailing = withoutLeading.replace(/\/+$/, '');
        return withoutTrailing ? `/${withoutTrailing}` : '';
    }

    buildBranchFallbacks() {
        const uniqueBranches = new Set();
        if (this.config.repoBranch) {
            uniqueBranches.add(this.config.repoBranch);
        }
        uniqueBranches.add('main');
        uniqueBranches.add('master');
        uniqueBranches.add('gh-pages');
        uniqueBranches.add('');
        return Array.from(uniqueBranches);
    }

    resolveEffectiveBranch(requestedBranch, contents) {
        if (requestedBranch) {
            return requestedBranch;
        }

        if (!Array.isArray(contents)) {
            return null;
        }

        const fileWithDownloadUrl = contents.find(item => typeof item?.download_url === 'string');
        if (!fileWithDownloadUrl) {
            return null;
        }

        try {
            const downloadUrl = new URL(fileWithDownloadUrl.download_url);
            const segments = downloadUrl.pathname.split('/').filter(Boolean);
            if (segments.length >= 3) {
                return decodeURIComponent(segments[2]);
            }
        } catch (error) {
            console.warn('Impossible de déterminer la branche GitHub effective:', error);
        }

        return null;
    }

    persistResolvedBranch(branch) {
        if (!branch || branch === this.config.repoBranch) {
            return;
        }

        this.setConfig({ repoBranch: branch });

        if (typeof window === 'undefined' || !window.localStorage) {
            return;
        }

        try {
            const storedConfig = window.localStorage.getItem('leitnerConfig');
            const parsedConfig = storedConfig ? JSON.parse(storedConfig) : {};
            window.localStorage.setItem('leitnerConfig', JSON.stringify({
                ...parsedConfig,
                repoBranch: branch
            }));
        } catch (error) {
            console.warn('Impossible de persister la branche GitHub détectée:', error);
        }
    }

    async apiRequest(endpoint, options = {}) {
        const { branch = null, headers: customHeaders = {}, ...fetchOptions } = options;
        let url = `https://api.github.com/repos/${this.config.repoOwner}/${this.config.repoName}${endpoint}`;
        if (branch) {
            url += (endpoint.includes('?') ? '&' : '?') + `ref=${encodeURIComponent(branch)}`;
        }
        const headers = {
            'Accept': 'application/vnd.github.v3+json',
            ...customHeaders
        };

        if (this.config.githubToken) {
            headers['Authorization'] = `token ${this.config.githubToken}`;
        }

        const response = await fetch(url, {
            ...fetchOptions,
            headers
        });

        if (!response.ok) {
            const error = new Error(`Erreur GitHub: ${response.status} ${response.statusText}`);
            error.status = response.status;
            throw error;
        }

        return response.json();
    }

    async loadCSVList() {
        const repoPath = this.normaliseRepoPath(this.config.repoPath || '');
        const baseEndpoint = `/contents${repoPath || ''}`;
        const branches = this.buildBranchFallbacks();
        let lastError = null;

        for (const branch of branches) {
            try {
                const contents = await this.apiRequest(baseEndpoint, { branch: branch || null });

                if (!Array.isArray(contents)) {
                    continue;
                }

                this.csvFiles = contents.filter(item =>
                    item.type === 'file' && item.name && item.name.toLowerCase().endsWith('.csv')
                );

                const csvList = this.csvFiles.map(file => file.name);
                if (typeof window !== 'undefined' && window.localStorage) {
                    window.localStorage.setItem('leitnerCSVList', JSON.stringify(csvList));
                }

                if (this.csvFiles.length > 0 || branch === '') {
                    const effectiveBranch = this.resolveEffectiveBranch(branch, contents);
                    if (effectiveBranch) {
                        this.persistResolvedBranch(effectiveBranch);
                    }
                    return this.csvFiles;
                }
            } catch (error) {
                lastError = error;
                if (error?.status && error.status !== 404) {
                    break;
                }
            }
        }

        console.error('Erreur de chargement de la liste CSV:', lastError);
        throw lastError || new Error('Impossible de récupérer la liste des fichiers CSV.');
    }
    
    async loadCSVContent(url) {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Erreur HTTP: ${response.status}`);
            }
            return await response.text();
        } catch (error) {
            console.error('Erreur de chargement du contenu CSV:', error);
            throw error;
        }
    }
    
    parseCSV(csvContent) {
        const lines = csvContent.split('\n').filter(line => line.trim() !== '');
        
        if (lines.length < 2) {
            throw new Error('Fichier CSV vide ou mal formaté');
        }
        
        // Vérifier l'en-tête
        const headers = lines[0].split(',').map(h => h.trim());
        const expectedHeaders = [
            'question_content',
            'question_content_image',
            'answer_content',
            'answer_content_image',
            'box_number',
            'last_reviewed'
        ];
        
        if (headers.length !== expectedHeaders.length || !expectedHeaders.every((h, i) => headers[i] === h)) {
            throw new Error('Format de fichier CSV invalide. Les en-têtes doivent être: ' + expectedHeaders.join(', '));
        }
        
        // Parser les données
        const importedCards = [];
        for (let i = 1; i < lines.length; i++) {
            const values = this.parseCSVLine(lines[i]);
            if (values.length < 6) continue;
            
            importedCards.push({
                id: Date.now() + i, // ID unique
                question: values[0].replace(/^"|"$/g, ''),
                questionImage: values[1].replace(/^"|"$/g, ''),
                answer: values[2].replace(/^"|"$/g, ''),
                answerImage: values[3].replace(/^"|"$/g, ''),
                box: parseInt(values[4]) || 1,
                lastReview: new Date(values[5].replace(/^"|"$/g, '')).getTime() || Date.now()
            });
        }
        
        return importedCards;
    }
    
    parseCSVLine(line) {
        const values = [];
        let current = '';
        let inQuotes = false;
        
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                values.push(current);
                current = '';
            } else {
                current += char;
            }
        }
        
        values.push(current);
        return values.map(v => v.trim());
    }

    getImageUrl(imagePath, imageType = 'question') {
        if (!imagePath) return null;
        
        // Si c'est déjà une URL complète, la retourner telle quelle
        if (imagePath.startsWith('http')) return imagePath;
        
        // Si c'est une image encodée en base64 (data URL), la retourner
        if (imagePath.startsWith('data:')) return imagePath;
        
        // Construire l'URL GitHub pour l'image
        const branch = this.config.repoBranch || 'main';
        const baseUrl = `https://raw.githubusercontent.com/${this.config.repoOwner}/${this.config.repoName}/${branch}/`;
        
        // Utiliser le chemin du dépôt comme base
        let fullPath = this.config.repoPath || '';
        
        // Ajouter un slash si nécessaire
        if (fullPath && !fullPath.endsWith('/')) {
            fullPath += '/';
        }
        
        // Si le chemin commence déjà par images_questions ou images_reponses
        if (imagePath.startsWith('images_questions/')) {
            fullPath += imagePath;
        } 
        else if (imagePath.startsWith('images_reponses/')) {
            fullPath += imagePath;
        }
        else {
            // Déterminer le répertoire en fonction du type d'image
            if (imageType === 'question') {
                fullPath += 'images_questions/';
            } else if (imageType === 'answer') {
                fullPath += 'images_reponses/';
            }
            
            // Ajouter le nom du fichier image
            fullPath += imagePath;
        }
        
        return baseUrl + fullPath;
    }
    simplifyImagePath(imageUrl, imageType = 'question') {
        if (!imageUrl) return '';
        
        // Si c'est une URL GitHub, extraire juste le nom du fichier
        if (imageUrl.includes('raw.githubusercontent.com')) {
            const parts = imageUrl.split('/');
            const filename = parts[parts.length - 1];
            
            // Pour les images questions
            if (imageUrl.includes('images_questions')) {
                return `images_questions/${filename}`;
            }
            // Pour les images réponses
            else if (imageUrl.includes('images_reponses')) {
                return `images_reponses/${filename}`;
            }
            // Pour les autres cas, retourner juste le nom du fichier
            else {
                return filename;
            }
        }
        
        // Pour les autres types d'URL, les retourner telles quelles
        return imageUrl;
    }
}
