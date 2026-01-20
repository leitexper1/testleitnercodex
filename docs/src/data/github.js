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
        this.localBaseUrl = null;
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

                const resolvedBranch = branch || this.config.repoBranch || 'main';
                this.csvFiles = contents
                    .filter(item => item.type === 'file' && item.name && item.name.toLowerCase().endsWith('.csv'))
                    .map(item => {
                        const rawPath = item.path || item.name || '';
                        const encodedPath = rawPath
                            .split('/')
                            .map(segment => encodeURIComponent(segment))
                            .join('/');
                        const publicPath = rawPath.replace(/^docs\//i, '');

                        return {
                            ...item,
                            publicPath,
                            download_url: item.download_url
                                || `https://raw.githubusercontent.com/${this.config.repoOwner}/${this.config.repoName}/${resolvedBranch}/${encodedPath}`
                        };
                    });

                this.localBaseUrl = null;

                const csvList = this.csvFiles.map(file => file.name);
                if (typeof window !== 'undefined' && window.localStorage) {
                    window.localStorage.setItem('leitnerCSVList', JSON.stringify(csvList));
                }

                if (this.csvFiles.length > 0 || branch === '') {
                    return this.csvFiles;
                }
            } catch (error) {
                lastError = error;
                if (error?.status && error.status !== 404) {
                    break;
                }
            }
        }

        try {
            const localFiles = await this.loadLocalCSVList();
            if (localFiles.length > 0) {
                this.csvFiles = localFiles;
                return this.csvFiles;
            }
        } catch (error) {
            lastError = lastError || error;
        }

        console.error('Erreur de chargement de la liste CSV:', lastError);
        throw lastError || new Error('Impossible de récupérer la liste des fichiers CSV.');
    }

    buildLocalFileEntry(rawPath, baseUrl) {
        if (!rawPath) {
            return null;
        }

        try {
            const url = new URL(rawPath, baseUrl);
            const pathname = url.pathname || '';
            const filename = decodeURIComponent(pathname.split('/').pop() || '');

            if (!filename || !filename.toLowerCase().endsWith('.csv')) {
                return null;
            }

            return {
                name: filename,
                download_url: url.href,
                publicPath: url.pathname.replace(/^\//, '')
            };
        } catch (error) {
            console.warn('Échec de la normalisation du chemin CSV local', rawPath, error);
            return null;
        }
    }

    async loadLocalCSVList() {
        if (typeof window === 'undefined' || typeof fetch === 'undefined') {
            return [];
        }

        const baseUrl = new URL('.', window.location.href);
        const manifestCandidates = ['csv-files.json', 'csv_manifest.json', '__csv_manifest.json'];

        for (const manifestName of manifestCandidates) {
            try {
                const manifestUrl = new URL(manifestName, baseUrl);
                const response = await fetch(manifestUrl, { cache: 'no-store' });
                if (!response.ok) {
                    continue;
                }

                const payload = await response.json();
                const entries = Array.isArray(payload)
                    ? payload
                    : Array.isArray(payload?.files)
                        ? payload.files
                        : [];

                const files = entries
                    .map(entry => (typeof entry === 'string' ? entry : entry?.name))
                    .filter(Boolean)
                    .map(name => this.buildLocalFileEntry(name, baseUrl))
                    .filter(Boolean);

                if (files.length > 0) {
                    this.localBaseUrl = baseUrl.href;
                    return files;
                }
            } catch (error) {
                console.warn('Lecture du manifeste CSV local échouée', manifestName, error);
            }
        }

        try {
            const response = await fetch(baseUrl.href, { cache: 'no-store' });
            if (!response.ok) {
                return [];
            }

            const contentType = response.headers.get('content-type') || '';
            if (!/text\//i.test(contentType)) {
                return [];
            }

            const body = await response.text();
            const candidates = new Set();
            const linkRegex = /href=["']?([^"'>\s]+\.(?:csv))["'\s>]/gi;
            let match;
            while ((match = linkRegex.exec(body)) !== null) {
                candidates.add(match[1]);
            }

            body.split(/\s+/).forEach((token) => {
                if (/\.csv$/i.test(token)) {
                    candidates.add(token.replace(/["'>]/g, ''));
                }
            });

            const files = Array.from(candidates)
                .map(candidate => this.buildLocalFileEntry(candidate, baseUrl))
                .filter(Boolean);

            if (files.length > 0) {
                this.localBaseUrl = baseUrl.href;
                return files;
            }
        } catch (error) {
            console.warn('Découverte des CSV locaux échouée', error);
        }

        return [];
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
        const normalised = imagePath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '');

        if (this.localBaseUrl) {
            let relativePath = normalised;
            if (!relativePath.startsWith('images_questions/') && !relativePath.startsWith('images_reponses/')) {
                const directory = imageType === 'answer' ? 'images_reponses' : 'images_questions';
                relativePath = `${directory}/${relativePath}`;
            }
            return new URL(relativePath, this.localBaseUrl).toString();
        }

        const branch = this.config.repoBranch || 'main';
        const baseUrl = `https://raw.githubusercontent.com/${this.config.repoOwner}/${this.config.repoName}/${branch}/`;

        let fullPath = this.config.repoPath || '';

        if (fullPath && !fullPath.endsWith('/')) {
            fullPath += '/';
        }

        if (normalised.startsWith('images_questions/')) {
            fullPath += normalised;
        } else if (normalised.startsWith('images_reponses/')) {
            fullPath += normalised;
        } else {
            if (imageType === 'question') {
                fullPath += 'images_questions/';
            } else if (imageType === 'answer') {
                fullPath += 'images_reponses/';
            }

            fullPath += normalised;
        }

        return baseUrl + fullPath;
    }

    sanitizeFileName(fileName) {
        if (!fileName) {
            return '';
        }
        return fileName
            .trim()
            .replace(/[\s]+/g, '_')
            .replace(/[^a-zA-Z0-9_.-]/g, '_');
    }

    buildRelativeImagePath(fileName, imageType = 'question') {
        const safeName = this.sanitizeFileName(fileName);
        if (!safeName) {
            return '';
        }
        const directory = imageType === 'answer' ? 'images_reponses' : 'images_questions';
        return `${directory}/${safeName}`;
    }

    ensureRepositoryImagePath(value, imageType = 'question') {
        if (!value) {
            return '';
        }

        const trimmed = value.trim();
        if (!trimmed || trimmed.startsWith('data:')) {
            return '';
        }

        const simplified = this.simplifyImagePath(trimmed, imageType);
        const withoutPrefix = simplified.replace(/^(\.\/|\/)/, '');

        if (withoutPrefix.startsWith('images_questions/') || withoutPrefix.startsWith('images_reponses/')) {
            const parts = withoutPrefix.split('/');
            const directory = parts.shift();
            const filename = this.sanitizeFileName(parts.join('/'));
            return filename ? `${directory}/${filename}` : directory;
        }

        return this.buildRelativeImagePath(withoutPrefix, imageType);
    }

    simplifyImagePath(imageUrl, imageType = 'question') {
        if (!imageUrl) return '';

        if (this.localBaseUrl && imageUrl.startsWith(this.localBaseUrl)) {
            return imageUrl.slice(this.localBaseUrl.length).replace(/^\//, '');
        }

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
